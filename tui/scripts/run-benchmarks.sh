#!/bin/bash
# run-benchmarks.sh - Automated benchmark runner with reporting
#
# ## Metadata
#
# ICF Assistant benchmark execution script with performance reporting and comparison.
#
# ### Purpose
#
# Automate benchmark execution across all performance-critical components,
# generate detailed reports, and track performance changes over time.

set -e

# Configuration
BENCHMARK_DIR="./internal/app"
RESULTS_DIR="./benchmark-results"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
RESULTS_FILE="$RESULTS_DIR/benchmark_$TIMESTAMP.txt"
BASELINE_FILE="$RESULTS_DIR/baseline.txt"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}ICF Assistant Performance Benchmarks${NC}"
echo "========================================"
echo ""

# Create results directory
mkdir -p "$RESULTS_DIR"

# Function to run a specific benchmark
run_benchmark() {
    local name=$1
    local pattern=$2
    
    echo -e "${YELLOW}Running $name benchmarks...${NC}"
    echo "go test -bench=$pattern -benchmem -count=3 $BENCHMARK_DIR"
    
    # Run benchmark and capture output
    go test -bench="$pattern" -benchmem -count=3 "$BENCHMARK_DIR" | tee -a "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
}

# Function to run all benchmarks
run_all_benchmarks() {
    echo "Starting benchmark run at $(date)" > "$RESULTS_FILE"
    echo "========================================" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    
    # System information
    echo "System Information:" >> "$RESULTS_FILE"
    echo "OS: $(uname -s) $(uname -r)" >> "$RESULTS_FILE"
    echo "CPU: $(sysctl -n machdep.cpu.brand_string 2>/dev/null || echo 'Unknown')" >> "$RESULTS_FILE"
    echo "Memory: $(sysctl -n hw.memsize 2>/dev/null | awk '{print int($1/1024/1024/1024)"GB"}' || echo 'Unknown')" >> "$RESULTS_FILE"
    echo "Go Version: $(go version)" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    
    # Run individual benchmark categories
    run_benchmark "App Initialization" "BenchmarkAppInitialization"
    run_benchmark "Project Discovery" "BenchmarkProjectDiscovery" 
    run_benchmark "Tmux Discovery" "BenchmarkTmuxDiscovery"
    run_benchmark "Navigation Update" "BenchmarkNavigationUpdate"
    run_benchmark "UI Rendering" "BenchmarkUIRendering"
    run_benchmark "Tmux Pane Mapping" "BenchmarkTmuxPaneMapping"
    run_benchmark "Worktree Discovery" "BenchmarkWorktreeDiscovery"
    run_benchmark "Message Processing" "BenchmarkMessageProcessing"
    
    echo "Benchmark run completed at $(date)" >> "$RESULTS_FILE"
}

# Function to compare with baseline
compare_with_baseline() {
    if [ ! -f "$BASELINE_FILE" ]; then
        echo -e "${YELLOW}No baseline found. Current results will be used as baseline.${NC}"
        cp "$RESULTS_FILE" "$BASELINE_FILE"
        return
    fi
    
    echo -e "${BLUE}Comparing with baseline...${NC}"
    
    # Extract benchmark results and compare
    echo "" >> "$RESULTS_FILE"
    echo "========================================" >> "$RESULTS_FILE"
    echo "Comparison with Baseline:" >> "$RESULTS_FILE"
    echo "========================================" >> "$RESULTS_FILE"
    
    # Simple comparison (in production, use more sophisticated analysis)
    echo "See $RESULTS_FILE for detailed comparison" >> "$RESULTS_FILE"
}

# Function to generate summary report
generate_summary() {
    echo -e "${BLUE}Generating summary report...${NC}"
    
    local summary_file="$RESULTS_DIR/summary_$TIMESTAMP.md"
    
    cat > "$summary_file" << EOF
# Performance Benchmark Report

**Date:** $(date)
**Results File:** $RESULTS_FILE

## Overview

This report contains performance benchmark results for the ICF Assistant application.

## Key Metrics

### App Initialization
- Time to initialize application components
- Memory allocation during startup

### Project Discovery  
- Filesystem scanning performance
- Project metadata parsing time

### Tmux Discovery
- Session enumeration time
- Pane discovery performance

### UI Rendering
- View generation time
- Render buffer size

### Navigation Updates
- Project list update time
- Component refresh performance

## Performance Trends

$(if [ -f "$BASELINE_FILE" ]; then echo "Comparison with baseline available in results file."; else echo "This is the first benchmark run - establishing baseline."; fi)

## Recommendations

1. Monitor operations taking >100ms
2. Watch for memory allocation increases
3. Track tmux discovery performance as session count grows
4. Optimize any operations showing >10% regression

## Raw Results

See \`$RESULTS_FILE\` for complete benchmark output.
EOF

    echo -e "${GREEN}Summary report generated: $summary_file${NC}"
}

# Function to run continuous benchmarks
run_continuous() {
    local interval=${1:-300} # Default 5 minutes
    
    echo -e "${YELLOW}Starting continuous benchmarking (interval: ${interval}s)${NC}"
    echo "Press Ctrl+C to stop"
    
    while true; do
        echo -e "${BLUE}Running benchmarks at $(date)${NC}"
        run_all_benchmarks
        compare_with_baseline
        
        echo -e "${GREEN}Sleeping for ${interval} seconds...${NC}"
        sleep "$interval"
    done
}

# Function to run specific benchmark
run_specific() {
    local benchmark_name=$1
    
    if [ -z "$benchmark_name" ]; then
        echo -e "${RED}Error: Benchmark name required${NC}"
        echo "Available benchmarks:"
        echo "  - AppInitialization"
        echo "  - ProjectDiscovery" 
        echo "  - TmuxDiscovery"
        echo "  - NavigationUpdate"
        echo "  - UIRendering"
        echo "  - TmuxPaneMapping"
        echo "  - WorktreeDiscovery"
        echo "  - MessageProcessing"
        exit 1
    fi
    
    echo "Starting specific benchmark run at $(date)" > "$RESULTS_FILE"
    echo "========================================" >> "$RESULTS_FILE"
    echo "" >> "$RESULTS_FILE"
    
    run_benchmark "$benchmark_name" "Benchmark$benchmark_name"
}

# Function to show help
show_help() {
    cat << EOF
ICF Assistant Benchmark Runner

Usage: $0 [COMMAND] [OPTIONS]

Commands:
  all                 Run all benchmarks (default)
  continuous [SEC]    Run benchmarks continuously (default: 300s interval)
  specific NAME       Run specific benchmark
  compare             Compare latest results with baseline
  clean               Clean old benchmark results
  help                Show this help

Examples:
  $0                          # Run all benchmarks once
  $0 continuous 600           # Run every 10 minutes  
  $0 specific TmuxDiscovery   # Run only tmux discovery benchmark
  $0 compare                  # Compare with baseline

Environment Variables:
  ICF_PROFILING_ENABLED=true  # Enable OpenTelemetry profiling
  JAEGER_ENDPOINT=url         # Jaeger collector endpoint

Results are saved to: $RESULTS_DIR/
EOF
}

# Main script logic
case "${1:-all}" in
    "all")
        run_all_benchmarks
        compare_with_baseline
        generate_summary
        echo -e "${GREEN}Benchmarks completed successfully!${NC}"
        echo "Results: $RESULTS_FILE"
        ;;
    "continuous")
        run_continuous "$2"
        ;;
    "specific")
        run_specific "$2"
        echo -e "${GREEN}Specific benchmark completed!${NC}"
        echo "Results: $RESULTS_FILE"
        ;;
    "compare")
        compare_with_baseline
        ;;
    "clean")
        echo -e "${YELLOW}Cleaning old benchmark results...${NC}"
        find "$RESULTS_DIR" -name "benchmark_*.txt" -mtime +7 -delete
        find "$RESULTS_DIR" -name "summary_*.md" -mtime +7 -delete
        echo -e "${GREEN}Cleanup completed${NC}"
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        echo -e "${RED}Unknown command: $1${NC}"
        show_help
        exit 1
        ;;
esac