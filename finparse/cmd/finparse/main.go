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
	"github.com/rumor-ml/commons.systems/finparse/internal/ui"
	"github.com/rumor-ml/commons.systems/finparse/internal/validate"
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
	// signal.NotifyContext to detect Ctrl+C. Graceful shutdown options:
	//   1. Stop accepting new files, wait for current parser to complete (if parser supports context)
	//   2. Save state with already-processed transactions before exiting
	// Note: State is currently saved once after all parsing completes but before output writing
	// (see state saving near line 536). Graceful shutdown would require incremental state saves during parsing loop.
	ctx := context.Background()

	// Create scanner
	s := scanner.New(*inputDir)

	// Scan for files
	if !*verbose {
		ui.Header("Parsing Financial Statements")
		ui.Step(1, 4, "Scanning directory")
	} else {
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
	} else {
		ui.Success(fmt.Sprintf("Found %d statement files", len(files)))
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

	// Return error if no files found (non-dry-run) - prevents silent failures in scripts/CI
	if len(files) == 0 {
		return fmt.Errorf("no statement files found in %s\n\nPlease check:\n  - Directory path is correct\n  - Files have supported extensions (.qfx, .ofx, .csv)\n  - You have read permissions on the directory and files\n\nRun with -verbose to see file discovery details", *inputDir)
	}

	// Show summary of scan results with per-institution breakdown
	fmt.Printf("Scan complete: found %d statement files", len(files))
	// Build institution breakdown for summary (shows file count per institution)
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

	// Phase 5: Load dedup state if provided
	if !*verbose && *stateFile != "" {
		ui.Step(2, 4, "Loading deduplication state")
	}
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
				// CRITICAL: State file exists but cannot be loaded. Return error to prevent:
				// 1. Overwriting the corrupt state file with empty state
				// 2. Reprocessing all transactions as new (creating duplicates in output)
				// Check if this is a permission error to provide specific guidance
				var pathErr *os.PathError
				if errors.As(err, &pathErr) && errors.Is(pathErr.Err, os.ErrPermission) {
					return fmt.Errorf("failed to load state file %q: permission denied: %w\n\nCRITICAL: The state file exists but cannot be read.\nDeleting it will cause all transactions to be reprocessed as NEW (losing deduplication history).\n\nOptions:\n  1. Check file permissions: ls -la %q\n  2. Check ownership: stat %q\n  3. Backup and reset (will reprocess ALL transactions): cp %q %q.backup && rm %q",
						*stateFile, err, *stateFile, *stateFile, *stateFile, *stateFile, *stateFile)
				}

				// Generic load failure (corruption, format error, etc)
				return fmt.Errorf("failed to load existing state file %q: %w\n\nCRITICAL: The state file exists but cannot be loaded.\nDeleting it will cause all transactions to be reprocessed as NEW (losing deduplication history).\n\nOptions:\n  1. Check file integrity: file %q\n  2. Backup the file: cp %q %q.backup\n  3. Try to recover: inspect JSON structure in %q\n  4. Reset (will reprocess ALL transactions): rm %q after backing up",
					*stateFile, err, *stateFile, *stateFile, *stateFile, *stateFile, *stateFile)
			}
		} else {
			state = loadedState

			// Validate loaded state integrity
			if err := state.Validate(); err != nil {
				return fmt.Errorf("state file %q failed validation: %w\n\nCRITICAL: Cannot proceed with parsing.\nParsing with invalid state would allow duplicate transactions and risk further corruption.\n\nThe state file exists but contains invalid data.\nDeleting it will cause all transactions to be reprocessed as NEW (losing deduplication history).\n\nRecovery options:\n  1. Restore from backup if available\n  2. Inspect state file: cat %q\n  3. Reset (will reprocess ALL transactions): rm %q after backing up",
					*stateFile, err, *stateFile, *stateFile)
			}

			if state.Version != dedup.CurrentVersion {
				return fmt.Errorf("state file version mismatch: got %d, expected %d",
					state.Version, dedup.CurrentVersion)
			}

			if state.TotalFingerprints() == 0 && !state.Metadata.LastUpdated.IsZero() {
				// State file has metadata but no fingerprints - likely corruption
				return fmt.Errorf("state file %q exists but is empty (has metadata, 0 fingerprints)\n\nCRITICAL: Parsing aborted due to suspicious empty state.\nContinuing would process all transactions without deduplication history.\n\nRecovery options:\n  1. Restore state from backup if available\n  2. Check filesystem integrity: fsck or disk utility\n  3. Delete state file to start fresh: rm %q\n\nCannot proceed until state is fixed or removed.",
					*stateFile, *stateFile)
			}

			if state.TotalFingerprints() == 0 {
				// Truly new state file with no history - OK for first run
				fmt.Fprintf(os.Stderr, "Creating new state file (first run) - all transactions will be processed as new\n")
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

	// Show deduplication status when enabled (regardless of verbose flag)
	if state != nil && *stateFile != "" {
		fmt.Fprintf(os.Stderr, "Deduplication enabled with state file: %s (%d existing fingerprints)\n",
			*stateFile, state.TotalFingerprints())
	}

	// Phase 5: Load rules engine
	if !*verbose {
		ui.Step(3, 4, "Loading category rules")
	}
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

	// Aggregate statistics across all statements
	var (
		totalDuplicatesSkipped            int
		totalRulesMatched                 int
		totalRulesUnmatched               int
		totalDuplicateInstitutionsSkipped int
		totalDuplicateAccountsSkipped     int
		closeErrorCount                   int
		closeErrors                       = make(map[string][]string) // error type -> file paths
	)
	unmatchedExamplesMap := make(map[string]bool) // Track unique unmatched descriptions
	duplicateExamplesMap := make(map[string]bool) // Track unique duplicate examples

	if *verbose {
		fmt.Fprintln(os.Stderr, "\nParsing and transforming statements...")
	} else {
		ui.Step(4, 4, "Parsing and transforming statements")
	}

	for i, file := range files {
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			return fmt.Errorf("failed to find parser for %s: %w", file.Path, err)
		}
		if parser == nil {
			return fmt.Errorf("INTERNAL ERROR: registry.FindParser returned nil without error for %s (scanner detected this as parseable)\n\nThis indicates a bug in the parser registry.\nPlease report this issue with:\n  - File extension: %s\n  - File path: %s",
				file.Path, filepath.Ext(file.Path), file.Path)
		}

		if *verbose {
			fmt.Fprintf(os.Stderr, "  Parsing %s with %s parser\n", file.Path, parser.Name())
		} else if len(files) > 0 {
			// Show simple progress indicator for non-verbose mode
			percentage := float64(i+1) / float64(len(files)) * 100
			fmt.Fprintf(os.Stderr, "\r  Progress: %d/%d files (%.0f%%)...", i+1, len(files), percentage)
		}

		f, err := os.Open(file.Path)
		if err != nil {
			return fmt.Errorf("failed to open %s: %w", file.Path, err)
		}

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)

		// Close file immediately after parsing instead of deferring to avoid file descriptor accumulation in loop
		closeErr := f.Close()
		if closeErr != nil {
			// Always log close errors immediately to detect filesystem issues early
			fmt.Fprintf(os.Stderr, "\nWARNING: Failed to close %s: %v\n", file.Path, closeErr)

			errStr := closeErr.Error()

			// Fail immediately on critical errors that indicate serious issues
			if strings.Contains(errStr, "permission") || strings.Contains(errStr, "denied") {
				return fmt.Errorf("failed to close file %s (critical permission error, stopping): %w", file.Path, closeErr)
			} else if strings.Contains(errStr, "no space") || strings.Contains(errStr, "disk full") {
				return fmt.Errorf("failed to close file %s (disk full, stopping): %w", file.Path, closeErr)
			} else if strings.Contains(errStr, "bad file") || strings.Contains(errStr, "stale") || strings.Contains(errStr, "filesystem") {
				return fmt.Errorf("failed to close file %s (filesystem corruption, stopping): %w", file.Path, closeErr)
			}

			// For non-critical errors, store both path and error message
			// All non-critical errors are tracked as "unknown" type
			closeErrors["unknown"] = append(closeErrors["unknown"], fmt.Sprintf("%s: %v", file.Path, closeErr))
			closeErrorCount++
		}

		if err != nil {
			return fmt.Errorf("parse failed for file %d of %d (%s): %w",
				i+1, len(files), file.Path, err)
		}

		// Verify parser contract (see internal/parser/parser.go): Parse() must return non-nil statement when error is nil.
		// This defensive check catches parser implementation bugs that could cause nil pointer panics downstream.
		// If triggered, this indicates a bug in the parser implementation that needs fixing.
		if rawStmt == nil {
			return fmt.Errorf("parser %s violated interface contract: returned nil statement without error for %s (parser bug)",
				parser.Name(), file.Path)
		}

		stats, err := transform.TransformStatement(rawStmt, budget, state, engine)
		if err != nil {
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
		for _, example := range stats.DuplicateExamples() {
			duplicateExamplesMap[example] = true
		}
	}

	// Clear progress indicator in non-verbose mode
	if !*verbose && len(files) > 0 {
		fmt.Fprintf(os.Stderr, "\r  Progress: %d/%d files (100%%) - Complete!\n", len(files), len(files))
	}

	// Check for close failures and provide detailed diagnostics
	if closeErrorCount > 0 {
		fmt.Fprintf(os.Stderr, "\nERROR: %d file(s) failed to close properly\n", closeErrorCount)

		// Show errors grouped by type
		for errType, errorDetails := range closeErrors {
			fmt.Fprintf(os.Stderr, "  %s errors: %d file(s)\n", errType, len(errorDetails))
			// Show first 3 examples of each type
			for i, detail := range errorDetails {
				if i >= 3 {
					fmt.Fprintf(os.Stderr, "    ... and %d more\n", len(errorDetails)-3)
					break
				}
				fmt.Fprintf(os.Stderr, "    - %s\n", detail)
			}
		}

		// Return error if ANY file failed to close - conservative approach to detect filesystem issues early
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
			if *verbose {
				fmt.Fprintf(os.Stderr, "\nRule matching statistics:\n")
				fmt.Fprintf(os.Stderr, "  Matched: %d (%.1f%%)\n", totalRulesMatched, coverage)
				fmt.Fprintf(os.Stderr, "  Unmatched: %d\n", totalRulesUnmatched)
			} else {
				fmt.Fprintf(os.Stderr, "\n")
				ui.Info(fmt.Sprintf("Rule coverage: %.1f%% (%d/%d matched)", coverage, totalRulesMatched, totalProcessed))
			}

			// Warn if coverage is low
			if coverage < 80.0 {
				if *verbose {
					fmt.Fprintf(os.Stderr, "  WARNING: Rule coverage is %.1f%% (below 80%% target)\n", coverage)
					fmt.Fprintf(os.Stderr, "           %d transactions categorized as 'other' need rules\n", totalRulesUnmatched)
				} else {
					ui.Warning(fmt.Sprintf("Rule coverage %.1f%% below 80%% target (%d unmatched)", coverage, totalRulesUnmatched))
				}
				if !*verbose {
					ui.Info("Run with -verbose to see example unmatched transactions")
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

	// Phase 6: Validate budget before saving
	if !*verbose {
		fmt.Fprintf(os.Stderr, "\n")
		ui.Info("Validating budget...")
	} else {
		fmt.Fprintf(os.Stderr, "\nValidating budget...\n")
	}

	validationResult := validate.ValidateBudget(budget)
	if len(validationResult.Errors) > 0 {
		if *verbose {
			fmt.Fprintf(os.Stderr, "\nValidation failed with %d errors:\n", len(validationResult.Errors))
			for _, e := range validationResult.Errors {
				fmt.Fprintf(os.Stderr, "  - %s %s [%s]: %s\n", e.Entity, e.ID, e.Field, e.Message)
			}
		} else {
			ui.Error(fmt.Sprintf("Validation failed with %d errors", len(validationResult.Errors)))
			ui.Info("Showing first 5 errors (run with -verbose to see all):")
			// Show first 5 errors
			for i, e := range validationResult.Errors {
				if i >= 5 {
					ui.Error(fmt.Sprintf("... and %d more errors", len(validationResult.Errors)-5))
					break
				}
				ui.Error(fmt.Sprintf("%s %s [%s]: %s", e.Entity, e.ID, e.Field, e.Message))
			}
			ui.Info("To fix: Review the errors above and check your statement files")
		}
		return fmt.Errorf("validation failed with %d errors", len(validationResult.Errors))
	}

	if len(validationResult.Warnings) > 0 {
		if *verbose {
			fmt.Fprintf(os.Stderr, "Validation warnings (%d):\n", len(validationResult.Warnings))
			for _, w := range validationResult.Warnings {
				fmt.Fprintf(os.Stderr, "  - %s %s [%s]: %s\n", w.Entity, w.ID, w.Field, w.Message)
			}
		} else {
			ui.Warning(fmt.Sprintf("Validation produced %d warnings", len(validationResult.Warnings)))
		}
	} else {
		if !*verbose {
			ui.Success("Validation passed")
		} else {
			fmt.Fprintf(os.Stderr, "Validation passed\n")
		}
	}

	// CRITICAL ORDERING: Save state before writing output to prevent reprocessing on retry.
	// This ordering provides retry safety:
	//   - If state saves but output fails: retry output without re-parsing
	//   - If state save fails: abort before output to maintain consistency
	//   - Never write output with unsaved state (would lose deduplication on retry)
	if state != nil && *stateFile != "" {
		if err := dedup.SaveState(state, *stateFile); err != nil {
			// State save failed - explain impact and provide recovery guidance
			fmt.Fprintf(os.Stderr, "\nERROR: Failed to save deduplication state: %v\n", err)
			fmt.Fprintf(os.Stderr, "\nThis means:\n")
			fmt.Fprintf(os.Stderr, "  - All parsing work for this run will be lost\n")
			fmt.Fprintf(os.Stderr, "  - Transactions will be reprocessed as NEW on next run\n")
			fmt.Fprintf(os.Stderr, "  - Output file will NOT be written to prevent inconsistency\n")

			// Provide actionable recovery steps for common error types (permission, disk space)
			if strings.Contains(err.Error(), "permission denied") {
				stateDir := filepath.Dir(*stateFile)
				fmt.Fprintf(os.Stderr, "\nPermission denied - check directory permissions:\n")
				fmt.Fprintf(os.Stderr, "  ls -la %q\n", stateDir)
			} else if strings.Contains(err.Error(), "no space left") {
				fmt.Fprintf(os.Stderr, "\nDisk full - check available space:\n")
				fmt.Fprintf(os.Stderr, "  df -h\n")
			}

			return fmt.Errorf("failed to save state file before writing output: %w", err)
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
		if *verbose {
			fmt.Printf("\nOutput written to %s\n", *outputFile)
		} else {
			fmt.Fprintf(os.Stderr, "\n")
			ui.Success(fmt.Sprintf("Output written to %s", *outputFile))
		}
	}

	return nil
}
