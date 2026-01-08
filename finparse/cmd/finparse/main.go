package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/rumor-ml/commons.systems/finparse/internal/registry"
	"github.com/rumor-ml/commons.systems/finparse/internal/scanner"
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

	// Future phase flags (Phase 2+, not yet implemented)
	outputFile        = flag.String("output", "", "Output JSON file (default: stdout)")
	stateFile         = flag.String("state", "", "Deduplication state file")
	rulesFile         = flag.String("rules", "", "Category rules file")
	mergeMode         = flag.Bool("merge", false, "Merge with existing output file")
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
	reg := registry.New()

	if *verbose {
		fmt.Printf("Registered parsers: %v\n", reg.ListParsers())
	}

	// Phase 1: Just scanning and detection (no actual parsing yet)
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

	// TODO(Phase 2): Implement parsing pipeline:
	//   1. For each file: parser := registry.FindParser(file.Path)
	//   2. Call parser.Parse(ctx, reader, file.Metadata) -> RawStatement
	//   3. Normalize RawStatement to domain types (Institution, Account, Statement, Transaction)
	//   4. Add to Budget struct using Budget.Add* methods (handles validation & dedup)
	//   5. Marshal Budget to JSON and write to output or stdout
	fmt.Println("Parsing not yet implemented. Phase 1 complete.")

	return nil
}
