package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/rumor-ml/commons.systems/finparse/internal/dedup"
	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/output"
	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/rules"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
	"github.com/rumor-ml/commons.systems/finparse/internal/transform"
)

const (
	version = "0.1.0"
)

var (
	// Global flags
	versionFlag = flag.Bool("version", false, "Show version")

	// Core CLI flags
	inputDir = flag.String("input", "", "Input directory containing statements (required)")
	dryRun   = flag.Bool("dry-run", false, "Show what would be parsed without writing")
	verbose  = flag.Bool("verbose", false, "Show detailed parsing logs")

	// Output and merge flags (Phase 4)
	outputFile = flag.String("output", "", "Output JSON file (default: stdout)")
	mergeMode  = flag.Bool("merge", false, "Merge with existing output file")

	// Phase 5 flags (deduplication and rules)
	stateFile         = flag.String("state", "", "Deduplication state file")
	rulesFile         = flag.String("rules", "", "Category rules file")
	formatFilter      = flag.String("format", "all", "Filter by format: ofx,csv,all")
	institutionFilter = flag.String("institution", "", "Filter by institution name")
)

func main() {
	// Custom usage message
	flag.Usage = func() {
		fmt.Fprint(os.Stderr, `finparse - Financial statement parser for budget prototype

Usage:
  finparse [flags]

Flags:
`)
		flag.PrintDefaults()
		fmt.Fprint(os.Stderr, `
Examples:
  # Parse all statements to stdout
  finparse -input ~/statements

  # Parse to file with state tracking
  finparse -input ~/statements -output budget.json -state state.json

  # Dry run with verbose output
  finparse -input ~/statements -dry-run -verbose

`)
	}

	flag.Parse()

	// Handle version flag
	if *versionFlag {
		fmt.Printf("finparse version %s\n", version)
		os.Exit(0)
	}

	// Validate required flags
	if *inputDir == "" {
		fmt.Fprintf(os.Stderr, "Error: -input flag is required\n\n")
		flag.Usage()
		os.Exit(1)
	}

	// Run parser
	if err := run(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
}

func run() error {
	// TODO(#1350): Add context cancellation support for graceful Ctrl+C handling.
	// Currently uses Background() which ignores cancellation signals. Should use
	// signal.NotifyContext to detect Ctrl+C, then finish parsing the current file
	// before exiting (allowing state file to be saved consistently). Files not yet
	// started should be skipped.
	ctx := context.Background()

	// Create scanner
	s := scanner.New(*inputDir)

	// Scan for files
	if *verbose {
		fmt.Fprintf(os.Stderr, "Scanning directory: %s\n", *inputDir)
	}

	files, err := s.Scan()
	if err != nil {
		return fmt.Errorf("failed to scan directory %s: %w", *inputDir, err)
	}

	if *verbose {
		fmt.Fprintf(os.Stderr, "Found %d statement files\n", len(files))
		for _, f := range files {
			fmt.Fprintf(os.Stderr, "  - %s (institution: %s, account: %s)\n",
				f.Path, f.Metadata.Institution(), f.Metadata.AccountNumber())
		}
	}

	// Create parser registry
	reg, err := registry.New()
	if err != nil {
		return fmt.Errorf("failed to create parser registry: %w", err)
	}

	if *verbose {
		fmt.Fprintf(os.Stderr, "Registered parsers: %v\n", reg.ListParsers())
	}

	// Dry run mode: stop after scanning, don't parse
	if *dryRun {
		fmt.Printf("Dry run complete. Would process %d files.\n", len(files))
		return nil
	}

	// Always show summary of scan results for user feedback
	fmt.Printf("Scan complete: found %d statement files", len(files))
	if len(files) > 0 {
		// Show institution/account breakdown in summary
		institutions := make(map[string]int)
		for _, f := range files {
			inst := f.Metadata.Institution()
			if inst == "" {
				inst = "<unknown>"
			}
			institutions[inst]++
		}
		fmt.Printf(" across %d institutions\n", len(institutions))
		for inst, count := range institutions {
			fmt.Printf("  - %s: %d files\n", inst, count)
		}
	} else {
		fmt.Printf(" in %s\n", *inputDir)
		fmt.Fprintf(os.Stderr, "Warning: No statement files found. Check directory path and ensure files have .qfx, .ofx, or .csv extensions.\n")
	}

	// Phase 5: Load dedup state if provided
	var state *dedup.State
	if *stateFile != "" {
		loadedState, err := dedup.LoadState(*stateFile)
		if err != nil {
			if os.IsNotExist(err) {
				// State file doesn't exist, create new
				state = dedup.NewState()
				if *verbose {
					fmt.Fprintf(os.Stderr, "State file not found, creating new state\n")
				}
			} else {
				// CRITICAL: State file exists but cannot be loaded. Return error to prevent data loss
				// and avoid overwriting the problematic file.
				// Check if this is a permission error to provide specific guidance
				var pathErr *os.PathError
				if errors.As(err, &pathErr) && errors.Is(pathErr.Err, os.ErrPermission) {
					return fmt.Errorf("failed to load state file %q: permission denied: %w\n\nCRITICAL: The state file exists but cannot be read.\nDeleting it will cause all transactions to be reprocessed as NEW (creating duplicates).\n\nOptions:\n  1. Check file permissions: ls -la %q\n  2. Check ownership: stat %q\n  3. Backup and reset (will reprocess ALL transactions): cp %q %q.backup && rm %q",
						*stateFile, err, *stateFile, *stateFile, *stateFile, *stateFile, *stateFile)
				}

				// Generic load failure (corruption, format error, etc)
				return fmt.Errorf("failed to load existing state file %q: %w\n\nCRITICAL: The state file exists but cannot be loaded.\nDeleting it will cause all transactions to be reprocessed as NEW (creating duplicates).\n\nOptions:\n  1. Check file integrity: file %q\n  2. Backup the file: cp %q %q.backup\n  3. Try to recover: inspect JSON structure in %q\n  4. Reset (will reprocess ALL transactions): rm %q after backing up",
					*stateFile, err, *stateFile, *stateFile, *stateFile, *stateFile, *stateFile)
			}
		} else {
			state = loadedState

			// Validate loaded state integrity
			if state.Version != dedup.CurrentVersion {
				return fmt.Errorf("state file version mismatch: got %d, expected %d",
					state.Version, dedup.CurrentVersion)
			}

			if state.TotalFingerprints() == 0 {
				fmt.Fprintf(os.Stderr, "WARNING: State file loaded but contains 0 fingerprints\n")
				if !state.Metadata.LastUpdated.IsZero() {
					timeSinceUpdate := time.Since(state.Metadata.LastUpdated)
					if timeSinceUpdate < 30*24*time.Hour {
						fmt.Fprintf(os.Stderr, "         State was last updated %v ago but is now empty!\n", timeSinceUpdate)
						fmt.Fprintf(os.Stderr, "         This likely indicates corruption or accidental reset.\n")
						fmt.Fprintf(os.Stderr, "         ALL transactions will be reprocessed as NEW.\n")
					} else {
						fmt.Fprintf(os.Stderr, "         This is normal for first run\n")
					}
				} else {
					fmt.Fprintf(os.Stderr, "         This is normal for first run\n")
				}
			}

			if *verbose {
				fmt.Fprintf(os.Stderr, "Loaded state with %d fingerprints\n",
					state.TotalFingerprints())
				if !state.Metadata.LastUpdated.IsZero() {
					fmt.Fprintf(os.Stderr, "  Last updated: %s\n",
						state.Metadata.LastUpdated.Format(time.RFC3339))
				}
			}
		}
	}

	// Show deduplication status (always, not just verbose)
	if state != nil && *stateFile != "" {
		fmt.Fprintf(os.Stderr, "Deduplication enabled with state file: %s (%d existing fingerprints)\n",
			*stateFile, state.TotalFingerprints())
	}

	// Phase 5: Load rules engine
	var engine *rules.Engine
	if *rulesFile != "" {
		// Custom rules from file
		loadedEngine, err := rules.LoadFromFile(*rulesFile)
		if err != nil {
			return fmt.Errorf("failed to load rules file: %w", err)
		}
		engine = loadedEngine
		if *verbose {
			fmt.Fprintf(os.Stderr, "Loaded %d custom rules from %s\n", len(engine.GetRules()), *rulesFile)
		}
	} else {
		// Use embedded rules
		loadedEngine, err := rules.LoadEmbedded()
		if err != nil {
			return fmt.Errorf("failed to load embedded rules: %w", err)
		}
		engine = loadedEngine
		if *verbose {
			fmt.Fprintf(os.Stderr, "Loaded %d embedded rules\n", len(engine.GetRules()))
		}
	}

	// Phase 4: Transform and output
	budget := domain.NewBudget()

	// Track state save failures for final output message
	var stateSaveFailed bool

	// Aggregate statistics across all statements
	var (
		totalDuplicatesSkipped            int
		totalRulesMatched                 int
		totalRulesUnmatched               int
		totalDuplicateInstitutionsSkipped int
		totalDuplicateAccountsSkipped     int
		totalStateRecordingErrors         int
		closeErrorCount                   int
		closeErrors                       = make(map[string][]string) // error type -> file paths
	)
	unmatchedExamplesMap := make(map[string]bool) // Track unique unmatched descriptions
	duplicateExamplesMap := make(map[string]bool) // Track unique duplicate examples

	if *verbose {
		fmt.Fprintln(os.Stderr, "\nParsing and transforming statements...")
	}

	for i, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			return fmt.Errorf("failed to find parser for %s: %w", file.Path, err)
		}
		if parser == nil {
			return fmt.Errorf("no parser found for %s", file.Path)
		}

		if *verbose {
			fmt.Fprintf(os.Stderr, "  Parsing %s with %s parser\n", file.Path, parser.Name())
		}

		f, err := os.Open(file.Path)
		if err != nil {
			return fmt.Errorf("failed to open %s: %w", file.Path, err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)

		// Close file immediately after parsing (not deferred) to avoid file descriptor accumulation
		closeErr := f.Close()
		if closeErr != nil {
			// Categorize error type for aggregation
			errType := "unknown"
			errStr := closeErr.Error()
			if strings.Contains(errStr, "permission") || strings.Contains(errStr, "denied") {
				errType = "permission_denied"
			} else if strings.Contains(errStr, "no space") || strings.Contains(errStr, "disk full") {
				errType = "disk_full"
			} else if strings.Contains(errStr, "bad file") || strings.Contains(errStr, "stale") {
				errType = "filesystem_corruption"
			}

			closeErrors[errType] = append(closeErrors[errType], file.Path)
			closeErrorCount++
		}

		if err != nil {
			return fmt.Errorf("parse failed for file %d of %d (%s): %w",
				i+1, len(files), file.Path, err)
		}

		// Verify parser contract: if no error, rawStmt must not be nil
		if rawStmt == nil {
			return fmt.Errorf("parser %s returned nil statement without error for %s (parser bug)",
				parser.Name(), file.Path)
		}

		stats, err := transform.TransformStatement(rawStmt, budget, state, engine)
		if err != nil {
			// Provide context about parsed data in error message
			return fmt.Errorf("transform failed for file %d of %d (%s) with %d transactions from %s to %s: %w",
				i+1, len(files), file.Path,
				len(rawStmt.Transactions),
				rawStmt.Period.Start().Format("2006-01-02"),
				rawStmt.Period.End().Format("2006-01-02"),
				err)
		}

		// Aggregate statistics
		totalDuplicatesSkipped += stats.DuplicatesSkipped
		totalRulesMatched += stats.RulesMatched
		totalRulesUnmatched += stats.RulesUnmatched
		for _, desc := range stats.UnmatchedExamples() {
			unmatchedExamplesMap[desc] = true
		}

		// Track duplicate statistics
		totalDuplicateInstitutionsSkipped += stats.DuplicateInstitutionsSkipped
		totalDuplicateAccountsSkipped += stats.DuplicateAccountsSkipped
		totalStateRecordingErrors += stats.StateRecordingErrors
		for _, example := range stats.DuplicateExamples() {
			duplicateExamplesMap[example] = true
		}
	}

	// Check for close failures and provide detailed diagnostics
	if closeErrorCount > 0 {
		fmt.Fprintf(os.Stderr, "\nERROR: %d file(s) failed to close properly\n", closeErrorCount)

		// Show errors grouped by type
		for errType, paths := range closeErrors {
			fmt.Fprintf(os.Stderr, "  %s errors: %d file(s)\n", errType, len(paths))
			// Show first 3 examples of each type
			for i, path := range paths {
				if i >= 3 {
					fmt.Fprintf(os.Stderr, "    ... and %d more\n", len(paths)-3)
					break
				}
				fmt.Fprintf(os.Stderr, "    - %s\n", path)
			}
		}

		// Always return error if ANY file failed to close (more conservative than 50% threshold)
		return fmt.Errorf("%d file(s) failed to close - check filesystem health", closeErrorCount)
	}

	if *verbose {
		institutions := budget.GetInstitutions()
		accounts := budget.GetAccounts()
		statements := budget.GetStatements()
		transactions := budget.GetTransactions()

		fmt.Fprintf(os.Stderr, "\nTransformation complete:\n")
		fmt.Fprintf(os.Stderr, "  Institutions: %d\n", len(institutions))
		fmt.Fprintf(os.Stderr, "  Accounts: %d\n", len(accounts))
		fmt.Fprintf(os.Stderr, "  Statements: %d\n", len(statements))
		fmt.Fprintf(os.Stderr, "  Transactions: %d\n", len(transactions))

	}

	// Show deduplication statistics (always, not just verbose)
	if state != nil && totalDuplicatesSkipped > 0 {
		fmt.Fprintf(os.Stderr, "\nDeduplication:\n")
		fmt.Fprintf(os.Stderr, "  Skipped %d duplicate transactions\n", totalDuplicatesSkipped)
	}

	// Example duplicates only in verbose mode
	if *verbose && state != nil && len(duplicateExamplesMap) > 0 {
		fmt.Fprintf(os.Stderr, "  Example duplicates:\n")
		count := 0
		for desc := range duplicateExamplesMap {
			if count >= 5 {
				break
			}
			fmt.Fprintf(os.Stderr, "    - %s\n", desc)
			count++
		}

		// Show duplicate institution/account statistics
		if totalDuplicateInstitutionsSkipped > 0 {
			fmt.Fprintf(os.Stderr, "  Skipped %d duplicate institution(s)\n", totalDuplicateInstitutionsSkipped)
		}
		if totalDuplicateAccountsSkipped > 0 {
			fmt.Fprintf(os.Stderr, "  Skipped %d duplicate account(s)\n", totalDuplicateAccountsSkipped)
		}

	}

	// Show rule matching statistics (always, not just verbose)
	if engine != nil {
		totalProcessed := totalRulesMatched + totalRulesUnmatched
		if totalProcessed > 0 {
			coverage := float64(totalRulesMatched) / float64(totalProcessed) * 100
			fmt.Fprintf(os.Stderr, "\nRule matching statistics:\n")
			fmt.Fprintf(os.Stderr, "  Matched: %d (%.1f%%)\n", totalRulesMatched, coverage)
			fmt.Fprintf(os.Stderr, "  Unmatched: %d\n", totalRulesUnmatched)

			// Warn if coverage is low
			if coverage < 80.0 {
				fmt.Fprintf(os.Stderr, "  WARNING: Rule coverage is %.1f%% (below 80%% target)\n", coverage)
				fmt.Fprintf(os.Stderr, "           %d transactions categorized as 'other' need rules\n", totalRulesUnmatched)
				if !*verbose {
					fmt.Fprintf(os.Stderr, "           Run with -verbose to see example unmatched transactions\n")
				}
			}
		}
	}

	// Show example unmatched transactions only in verbose mode
	if *verbose && len(unmatchedExamplesMap) > 0 {
		fmt.Fprintf(os.Stderr, "  Example unmatched transactions:\n")
		count := 0
		for desc := range unmatchedExamplesMap {
			if count >= 5 {
				break
			}
			fmt.Fprintf(os.Stderr, "    - %s\n", desc)
			count++
		}
	}

	// Show state recording errors if any occurred
	if state != nil && totalStateRecordingErrors > 0 {
		fmt.Fprintf(os.Stderr, "\nWARNING: %d transaction(s) failed state recording\n", totalStateRecordingErrors)
		fmt.Fprintf(os.Stderr, "         These transactions are in the output but will be reprocessed as duplicates on next run\n")
		fmt.Fprintf(os.Stderr, "         This may indicate filesystem issues or state corruption\n")
	}

	// Phase 5: Save state before writing output (transactional ordering)
	if state != nil && *stateFile != "" {
		if err := dedup.SaveState(state, *stateFile); err != nil {
			// State save failed - provide detailed diagnostics
			fmt.Fprintf(os.Stderr, "\nERROR: Failed to save deduplication state: %v\n", err)
			fmt.Fprintf(os.Stderr, "\nThis means:\n")
			fmt.Fprintf(os.Stderr, "  - All parsing work for this run will be lost\n")
			fmt.Fprintf(os.Stderr, "  - Transactions will be reprocessed as NEW on next run\n")
			fmt.Fprintf(os.Stderr, "  - Output file will NOT be written to prevent inconsistency\n")
			fmt.Fprintf(os.Stderr, "\nRecovery options:\n")
			fmt.Fprintf(os.Stderr, "  1. Fix the error and retry (recommended)\n")
			fmt.Fprintf(os.Stderr, "  2. Try different state file location: --state /different/path\n")
			fmt.Fprintf(os.Stderr, "  3. Write output without state: FINPARSE_SKIP_STATE_SAVE=1 finparse ...\n")
			fmt.Fprintf(os.Stderr, "     (WARNING: duplicates will be reprocessed on next run)\n\n")

			// Check for common errors
			if strings.Contains(err.Error(), "permission denied") {
				stateDir := filepath.Dir(*stateFile)
				fmt.Fprintf(os.Stderr, "Permission denied - check directory permissions:\n")
				fmt.Fprintf(os.Stderr, "  ls -la %q\n", stateDir)
			} else if strings.Contains(err.Error(), "no space left") {
				fmt.Fprintf(os.Stderr, "Disk full - check available space:\n")
				fmt.Fprintf(os.Stderr, "  df -h\n")
			}

			// Check for environment variable override
			if os.Getenv("FINPARSE_SKIP_STATE_SAVE") == "1" {
				fmt.Fprintf(os.Stderr, "\nWARNING: Continuing without saving state due to FINPARSE_SKIP_STATE_SAVE=1\n")
				fmt.Fprintf(os.Stderr, "         All transactions will be reprocessed on next run\n")
				fmt.Fprintf(os.Stderr, "         This environment variable should only be used for debugging\n\n")
				stateSaveFailed = true
			} else {
				return fmt.Errorf("failed to save state file %q before writing output: %w\n\nOutput not written to maintain consistency.\nUse FINPARSE_SKIP_STATE_SAVE=1 to write output anyway (will reprocess transactions on next run).",
					*stateFile, err)
			}
		} else if *verbose {
			fmt.Fprintf(os.Stderr, "Saved state with %d fingerprints to %s\n",
				state.TotalFingerprints(), *stateFile)
		}
	}

	opts := output.WriteOptions{
		MergeMode: *mergeMode,
		FilePath:  *outputFile,
	}

	if err := output.WriteBudgetToFile(budget, opts); err != nil {
		return fmt.Errorf("failed to write output: %w", err)
	}

	if *outputFile != "" {
		fmt.Printf("\nOutput written to %s\n", *outputFile)
	}

	// Always exit with error if state save failed (regardless of output destination)
	if stateSaveFailed {
		fmt.Fprintf(os.Stderr, "\n⚠️  WARNING: State file was NOT saved - duplicates will be reprocessed on next run\n")
		fmt.Fprintf(os.Stderr, "    Unset FINPARSE_SKIP_STATE_SAVE to restore normal operation\n")
		// Exit with non-zero to signal partial failure
		os.Exit(1)
	}

	return nil
}
