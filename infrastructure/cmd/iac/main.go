package main

import (
	"flag"
	"fmt"
	"os"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/config"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/runner"
)

func main() {
	// Define flags
	var (
		projectID     = flag.String("project-id", "", "GCP project ID (or GCP_PROJECT_ID env)")
		repoOwner     = flag.String("repo-owner", "rumor-ml", "GitHub repo owner")
		repoName      = flag.String("repo-name", "commons.systems", "GitHub repo name")
		skipTerraform = flag.Bool("skip-terraform", false, "Skip Terraform execution")
		skipGCPSetup  = flag.Bool("skip-gcp-setup", false, "Skip GCP setup (APIs, WIF, IAM)")
		autoApprove   = flag.Bool("auto-approve", false, "Auto-approve Terraform changes")
		ci            = flag.Bool("ci", false, "CI mode: implies --skip-gcp-setup --auto-approve")
		verbose       = flag.Bool("verbose", false, "Show detailed output")
	)

	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "Infrastructure Setup and IaC Management\n")
		fmt.Fprintf(os.Stderr, "========================================\n\n")
		fmt.Fprintf(os.Stderr, "Handles both prerequisites and infrastructure as code (Terraform).\n")
		fmt.Fprintf(os.Stderr, "Can run interactively for one-time setup or non-interactively in CI/CD.\n\n")
		fmt.Fprintf(os.Stderr, "This tool is fully idempotent - you can run it multiple times safely.\n\n")
		fmt.Fprintf(os.Stderr, "Options:\n")
		flag.PrintDefaults()
	}

	flag.Parse()

	// CI mode implies skip-gcp-setup and auto-approve
	if *ci {
		*skipGCPSetup = true
		*autoApprove = true
	}

	// Load configuration
	cfg := config.Config{
		ProjectID:     *projectID,
		RepoOwner:     *repoOwner,
		RepoName:      *repoName,
		SkipTerraform: *skipTerraform,
		SkipGCPSetup:  *skipGCPSetup,
		AutoApprove:   *autoApprove,
		CI:            *ci,
		Verbose:       *verbose,
	}

	// If project ID not provided via flag, check environment
	if cfg.ProjectID == "" {
		cfg.ProjectID = os.Getenv("GCP_PROJECT_ID")
	}

	// Run the infrastructure setup
	r := runner.New(cfg)
	if err := r.Run(); err != nil {
		output.Error(err.Error())
		os.Exit(1)
	}
}
