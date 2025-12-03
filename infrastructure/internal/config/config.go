package config

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
