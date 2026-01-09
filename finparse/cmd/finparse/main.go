package main

import (
	"context"
	"flag"
	"fmt"
	"os"

	"github.com/rumor-ml/commons.systems/finparse/internal/domain"
	"github.com/rumor-ml/commons.systems/finparse/internal/output"
	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
	"github.com/rumor-ml/commons.systems/finparse/internal/transform"
)

const (
	version = "0.1.0"
)

var (
	// Global flags
	versionFlag = flag.Bool("version", false, "Show version")

	// Phase 1 flags (currently used)
	inputDir = flag.String("input", "", "Input directory containing statements (required)")
	dryRun   = flag.Bool("dry-run", false, "Show what would be parsed without writing")
	verbose  = flag.Bool("verbose", false, "Show detailed parsing logs")

	// Output and merge flags (Phase 4)
	outputFile = flag.String("output", "", "Output JSON file (default: stdout)")
	mergeMode  = flag.Bool("merge", false, "Merge with existing output file")

	// Future phase flags (Phase 5+, not yet implemented)
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
	// Create context for parsing operations
	ctx := context.Background()

	// Create scanner
	s := scanner.New(*inputDir)

	// Scan for files
	if *verbose {
		fmt.Printf("Scanning directory: %s\n", *inputDir)
	}

	files, err := s.Scan()
	if err != nil {
		return fmt.Errorf("failed to scan directory %s: %w", *inputDir, err)
	}

	if *verbose {
		fmt.Printf("Found %d statement files\n", len(files))
		for _, f := range files {
			fmt.Printf("  - %s (institution: %s, account: %s)\n",
				f.Path, f.Metadata.Institution(), f.Metadata.AccountNumber())
		}
	}

	// Create parser registry
	reg, err := registry.New()
	if err != nil {
		return fmt.Errorf("failed to create parser registry: %w", err)
	}

	if *verbose {
		fmt.Printf("Registered parsers: %v\n", reg.ListParsers())
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

	// Phase 4: Transform and output
	budget := domain.NewBudget()

	if *verbose {
		fmt.Println("\nParsing and transforming statements...")
	}

	for _, file := range files {
		// TODO(#1341): Consider removing numbered step comments in favor of descriptive prefixes
		// 1. Find parser
		parser, err := reg.FindParser(file.Path)
		if err != nil {
			return fmt.Errorf("failed to find parser for %s: %w", file.Path, err)
		}
		if parser == nil {
			return fmt.Errorf("no parser found for %s", file.Path)
		}

		if *verbose {
			fmt.Printf("  Parsing %s with %s parser\n", file.Path, parser.Name())
		}

		// 2. Open file and parse
		f, err := os.Open(file.Path)
		if err != nil {
			return fmt.Errorf("failed to open %s: %w", file.Path, err)
		}
		// TODO(#1340): Remove obvious inline comment
		defer func() {
			if closeErr := f.Close(); closeErr != nil {
				fmt.Fprintf(os.Stderr, "Warning: failed to close %s: %v\n", file.Path, closeErr)
			}
		}()

		rawStmt, err := parser.Parse(ctx, f, file.Metadata)
		if err != nil {
			return fmt.Errorf("parse failed for %s: %w", file.Path, err)
		}

		// 3. Transform to domain types
		if err := transform.TransformStatement(rawStmt, budget); err != nil {
			return fmt.Errorf("transform failed for %s: %w", file.Path, err)
		}
	}

	if *verbose {
		institutions := budget.GetInstitutions()
		accounts := budget.GetAccounts()
		statements := budget.GetStatements()
		transactions := budget.GetTransactions()

		fmt.Printf("\nTransformation complete:\n")
		fmt.Printf("  Institutions: %d\n", len(institutions))
		fmt.Printf("  Accounts: %d\n", len(accounts))
		fmt.Printf("  Statements: %d\n", len(statements))
		fmt.Printf("  Transactions: %d\n", len(transactions))
	}

	// 4. Write output
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
