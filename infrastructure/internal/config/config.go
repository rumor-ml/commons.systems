package config

import (
	"fmt"
	"regexp"
)

var repoNamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)

// Config holds the configuration for the infrastructure setup
type Config struct {
	// Required configuration
	ProjectID string
	RepoOwner string
	RepoName  string

	// Optional configuration
	Region string

	// Runtime configuration
	SkipTerraform bool
	SkipGCPSetup  bool
	AutoApprove   bool
	CI            bool
	Verbose       bool

	// Populated during runtime
	WorkloadIdentityProvider string
	ServiceAccountEmail      string
}

// GetRegion returns the region, defaulting to us-central1
func (c *Config) GetRegion() string {
	if c.Region == "" {
		return "us-central1"
	}
	return c.Region
}

// Validate checks config fields for security issues
func (c *Config) Validate() error {
	if !repoNamePattern.MatchString(c.RepoOwner) {
		return fmt.Errorf("invalid repo-owner: must contain only alphanumeric, dots, hyphens, underscores")
	}
	if !repoNamePattern.MatchString(c.RepoName) {
		return fmt.Errorf("invalid repo-name: must contain only alphanumeric, dots, hyphens, underscores")
	}
	return nil
}
