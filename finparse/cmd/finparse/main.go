package main

import (
	"context"
	"flag"
	"fmt"
	"os"

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
	// context.WithCancel and signal.NotifyContext to allow in-progress parsing to
	// complete when user presses Ctrl+C.
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
	// TODO(#1428): Use structured logging with error IDs instead of fmt.Fprintf
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
				// CRITICAL: State file exists but can't be loaded
				return fmt.Errorf("failed to load state file %q: %w (deduplication disabled, check file permissions and format)", *stateFile, err)
			}
		} else {
			state = loadedState
			if *verbose {
				fmt.Fprintf(os.Stderr, "Loaded state with %d fingerprints\n",
					state.TotalFingerprints())
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

	// Aggregate statistics across all statements
	var (
		totalDuplicatesSkipped            int
		totalRulesMatched                 int
		totalRulesUnmatched               int
		totalDuplicateInstitutionsSkipped int
		totalDuplicateAccountsSkipped     int
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

		// Close immediately after parsing
		closeErr := f.Close()
		if err != nil {
			// TODO(#1423): Comment about error message context will become outdated when error messages change
			// If parse failed AND close also failed, warn about the close error to prevent
			// masking potential file descriptor leaks (parse error is returned below)
			if closeErr != nil {
				// Both parse and close failed - this is critical for debugging.
				// Could indicate filesystem issues, not just parse errors.
				return fmt.Errorf("parse failed for file %d of %d (%s): %w (WARNING: file close also failed, possible file descriptor leak: %v)",
					i+1, len(files), file.Path, err, closeErr)
			}
			return fmt.Errorf("parse failed for file %d of %d (%s): %w",
				i+1, len(files), file.Path, err)
		}
		if closeErr != nil {
			return fmt.Errorf("failed to close %s after successful parse: %w", file.Path, closeErr)
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
		for _, example := range stats.DuplicateExamples() {
			duplicateExamplesMap[example] = true
		}
	}

	// Phase 5: Save state if modified
	// TODO(#1428): Use structured logging with error IDs instead of fmt.Fprintf
	if state != nil && *stateFile != "" {
		if err := dedup.SaveState(state, *stateFile); err != nil {
			return fmt.Errorf("failed to save state file: %w", err)
		}

		if *verbose {
			fmt.Fprintf(os.Stderr, "Saved state with %d fingerprints to %s\n",
				state.TotalFingerprints(), *stateFile)
		}
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
		if *verbose {
			if totalDuplicateInstitutionsSkipped > 0 {
				fmt.Fprintf(os.Stderr, "  Skipped %d duplicate institution(s)\n", totalDuplicateInstitutionsSkipped)
			}
			if totalDuplicateAccountsSkipped > 0 {
				fmt.Fprintf(os.Stderr, "  Skipped %d duplicate account(s)\n", totalDuplicateAccountsSkipped)
			}
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
				fmt.Fprintf(os.Stderr, "  WARNING: Rule coverage is below 80%%. Consider adding more rules.\n")
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

	// Phase 5: Save state before writing output (transactional ordering)
	if state != nil && *stateFile != "" {
		if err := dedup.SaveState(state, *stateFile); err != nil {
			return fmt.Errorf("failed to save state file %q before writing output (no data written): %w", *stateFile, err)
		}

		if *verbose {
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

	return nil
}
