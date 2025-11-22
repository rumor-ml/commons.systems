package devserver

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/rumor-ml/carriercommons/pkg/discovery"
	"github.com/rumor-ml/log/pkg/log"
)

// ValidationResult contains the results of module validation
type ValidationResult struct {
	Valid   []string
	Invalid []ModuleError
}

// ModuleError represents a module that failed validation
type ModuleError struct {
	Module string
	Error  string
}

// ModuleValidator handles module discovery and validation
type ModuleValidator struct {
	carriercommonsRoot string
	logger             log.Logger
}

// NewModuleValidator creates a new module validator
func NewModuleValidator(carriercommonsRoot string) *ModuleValidator {
	return &ModuleValidator{
		carriercommonsRoot: carriercommonsRoot,
		logger:             log.Get().WithComponent("devserver-validator"),
	}
}

// DiscoverModules finds all available modules in the carriercommons workspace
// Uses the discovery package to find projects, then filters for web modules
func (v *ModuleValidator) DiscoverModules() ([]string, error) {
	v.logger.Info("Discovering modules", "root", v.carriercommonsRoot)

	// Use discovery package to find all projects
	projects, err := discovery.DiscoverProjects(v.carriercommonsRoot)
	if err != nil {
		return nil, fmt.Errorf("failed to discover projects: %w", err)
	}

	v.logger.Info("Found projects", "count", len(projects))

	var modules []string

	// Filter for projects with pkg/web directory
	for _, project := range projects {
		// Skip infrastructure modules (server, store, log, tui)
		if project.Name == "server" || project.Name == "store" || project.Name == "log" || project.Name == "tui" {
			continue
		}

		// Check if project has a web package
		webPkgPath := filepath.Join(project.Path, "pkg", "web")
		if _, err := os.Stat(webPkgPath); err == nil {
			// Check if there are Go files in the web package
			goFiles, err := filepath.Glob(filepath.Join(webPkgPath, "*.go"))
			if err == nil && len(goFiles) > 0 {
				modules = append(modules, project.Name)
				v.logger.Debug("Found module with web package", "module", project.Name, "path", project.Path)
			}
		}
	}

	v.logger.Info("Discovered web modules", "count", len(modules), "modules", strings.Join(modules, ","))
	return modules, nil
}

// ValidateModule tests if a module can be built successfully
func (v *ModuleValidator) ValidateModule(module string) bool {
	// Use discovery to find the project
	projects, err := discovery.DiscoverProjects(v.carriercommonsRoot)
	if err != nil {
		v.logger.Error("Failed to discover projects", "error", err)
		return false
	}

	// Find the matching project
	var projectPath string
	for _, project := range projects {
		if project.Name == module {
			projectPath = project.Path
			break
		}
	}

	if projectPath == "" {
		v.logger.Warn("Module not found in discovered projects", "module", module)
		return false
	}

	// Check if project has a web package
	pkgDir := filepath.Join(projectPath, "pkg", "web")
	if _, err := os.Stat(pkgDir); err != nil {
		v.logger.Debug("Module package directory not found", "module", module, "pkgDir", pkgDir, "error", err)
		return false
	}

	// Check if there's at least one .go file in the package
	goFiles, err := filepath.Glob(filepath.Join(pkgDir, "*.go"))
	if err != nil || len(goFiles) == 0 {
		v.logger.Debug("No Go files found in module package", "module", module, "pkgDir", pkgDir)
		return false
	}

	v.logger.Info("Module validated successfully", "module", module, "path", projectPath)
	return true
}

// DiscoverAndValidate discovers all modules and returns only the valid ones
func (v *ModuleValidator) DiscoverAndValidate() []string {
	modules, err := v.DiscoverModules()
	if err != nil {
		v.logger.Error("Failed to discover modules", "error", err)
		return nil
	}

	var validModules []string
	for _, module := range modules {
		if v.ValidateModule(module) {
			validModules = append(validModules, module)
		}
	}

	v.logger.Info("Module validation complete",
		"total", len(modules),
		"valid", len(validModules),
		"modules", strings.Join(validModules, ","))

	return validModules
}

// ValidateModuleCompilation validates that a module compiles successfully
// This replicates the logic from ../server/scripts/validate-modules
func (v *ModuleValidator) ValidateModuleCompilation(ctx context.Context, module string) error {
	// Use discovery to find the project
	projects, err := discovery.DiscoverProjects(v.carriercommonsRoot)
	if err != nil {
		return fmt.Errorf("failed to discover projects: %w", err)
	}

	// Find the matching project
	var projectPath string
	for _, project := range projects {
		if project.Name == module {
			projectPath = project.Path
			break
		}
	}

	if projectPath == "" {
		return fmt.Errorf("module not found in discovered projects")
	}

	// Read module name from go.mod
	modPath := filepath.Join(projectPath, "go.mod")
	content, err := os.ReadFile(modPath)
	if err != nil {
		return fmt.Errorf("failed to read go.mod: %w", err)
	}

	// Extract module name from go.mod
	var packageName string
	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "module ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				packageName = parts[1] + "/pkg/web"
				break
			}
		}
	}

	if packageName == "" {
		return fmt.Errorf("could not determine package name")
	}

	// Create temporary build directory for output binary
	tempDir, err := os.MkdirTemp("", "module-validate-*")
	if err != nil {
		return fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tempDir)

	testBinary := filepath.Join(tempDir, "test")

	// Run go build with timeout - increased to 30s to handle modules with large dependency trees
	// (modules with GCP dependencies can take 11-12s even with go.sum optimization)
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	// Always use isolated temporary go.mod for validation
	// This prevents conflicts with other modules' replace directives in server/go.mod
	buildDir := tempDir

	// Convert to absolute path (Go requires replace paths to be absolute or start with ./ or ../)
	absModulePath, err := filepath.Abs(projectPath)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %w", err)
	}

	// Extract module name from package name (everything before /pkg/web)
	// packageName is like "github.com/rumor-ml/finance/pkg/web"
	// moduleName should be "github.com/rumor-ml/finance"
	moduleName := packageName
	if idx := strings.Index(packageName, "/pkg/web"); idx != -1 {
		moduleName = packageName[:idx]
	}

	// Also need to include common dependencies (log, store, object) that modules typically use
	logPath := filepath.Join(v.carriercommonsRoot, "log")
	storePath := filepath.Join(v.carriercommonsRoot, "store")
	objectPath := filepath.Join(v.carriercommonsRoot, "object")

	absLogPath, _ := filepath.Abs(logPath)
	absStorePath, _ := filepath.Abs(storePath)
	absObjectPath, _ := filepath.Abs(objectPath)

	// Create isolated go.mod with only this module's replace directive
	goModContent := fmt.Sprintf(`module testvalidation

go 1.24.1

toolchain go1.24.5

require (
	%s v0.0.0
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/object v0.0.0
	github.com/rumor-ml/store v0.0.0
)

replace %s => %s
replace github.com/rumor-ml/log => %s
replace github.com/rumor-ml/object => %s
replace github.com/rumor-ml/store => %s
`, moduleName, moduleName, absModulePath, absLogPath, absObjectPath, absStorePath)

	goModPath := filepath.Join(tempDir, "go.mod")
	if err := os.WriteFile(goModPath, []byte(goModContent), 0644); err != nil {
		return fmt.Errorf("failed to create test go.mod: %w", err)
	}

	// Copy the module's go.sum to avoid re-downloading and verifying all dependencies
	// Without go.sum, Go must download/verify 600+ packages which takes 30+ seconds
	// With go.sum, build completes in <1 second
	moduleGoSumPath := filepath.Join(projectPath, "go.sum")
	if _, err := os.Stat(moduleGoSumPath); err == nil {
		goSumContent, err := os.ReadFile(moduleGoSumPath)
		if err == nil {
			goSumPath := filepath.Join(tempDir, "go.sum")
			if err := os.WriteFile(goSumPath, goSumContent, 0644); err != nil {
				v.logger.Debug("Failed to copy go.sum", "module", module, "error", err)
				// Non-fatal - build will just take longer
			} else {
				v.logger.Debug("Copied go.sum for faster build", "module", module)
			}
		}
	}

	// Use -mod=mod flag to auto-update go.sum during build
	// Don't use go mod tidy because it removes unused requires (and we have no source code in temp dir)
	cmd := exec.CommandContext(ctx, "go", "build", "-mod=mod", "-o", testBinary, packageName)
	cmd.Dir = buildDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Extract meaningful error from output
		outputStr := strings.TrimSpace(string(output))
		if outputStr != "" {
			return fmt.Errorf("%s", outputStr)
		}
		return fmt.Errorf("compilation failed: %w", err)
	}

	return nil
}

// DiscoverAndValidateWithDetails discovers and validates modules with detailed results
func (v *ModuleValidator) DiscoverAndValidateWithDetails(ctx context.Context) (*ValidationResult, error) {
	modules, err := v.DiscoverModules()
	if err != nil {
		return nil, fmt.Errorf("failed to discover modules: %w", err)
	}

	if len(modules) == 0 {
		v.logger.Debug("No modules discovered")
		return &ValidationResult{
			Valid:   []string{},
			Invalid: []ModuleError{},
		}, nil
	}

	// Pre-warm Go build cache for CGO dependencies (especially go-sqlite3)
	// This prevents timeout failures when building modules from a cold cache
	// CGO compilation can take 15-20s from cold cache but <1s with warm cache
	v.logger.Debug("Warming Go build cache for CGO dependencies...")
	// Use a generous timeout for cache warming (60s) - separate from module validation timeout
	warmCtx, warmCancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer warmCancel()
	// Build the log package which depends on go-sqlite3, to warm the cache
	// Use the log module directory which has proper go.mod/go.sum
	logDir := filepath.Join(v.carriercommonsRoot, "log")
	warmCmd := exec.CommandContext(warmCtx, "go", "build", "github.com/rumor-ml/log/pkg/log")
	warmCmd.Dir = logDir
	warmCmd.Env = os.Environ()
	if err := warmCmd.Run(); err != nil {
		v.logger.Debug("Cache warming completed with status", "error", err)
	} else {
		v.logger.Debug("Cache warming completed successfully")
	}

	// Set up worker pool for parallel validation
	type validationJob struct {
		module string
		index  int
	}

	type validationResult struct {
		module string
		index  int
		err    error
	}

	jobs := make(chan validationJob, len(modules))
	results := make(chan validationResult, len(modules))

	// Start workers (4 concurrent compilations)
	workerCount := 4
	if len(modules) < workerCount {
		workerCount = len(modules)
	}

	v.logger.Debug("Starting parallel module validation", "workers", workerCount, "modules", len(modules))

	for w := 0; w < workerCount; w++ {
		go func() {
			for job := range jobs {
				// Basic validation (directory structure)
				if !v.ValidateModule(job.module) {
					results <- validationResult{
						module: job.module,
						index:  job.index,
						err:    fmt.Errorf("basic validation failed: missing pkg/web directory or Go files"),
					}
					continue
				}

				// Compilation validation
				err := v.ValidateModuleCompilation(ctx, job.module)
				results <- validationResult{
					module: job.module,
					index:  job.index,
					err:    err,
				}
			}
		}()
	}

	// Send jobs
	for i, mod := range modules {
		jobs <- validationJob{mod, i}
	}
	close(jobs)

	// Collect results
	valid := []string{}
	invalid := []ModuleError{}

	for i := 0; i < len(modules); i++ {
		result := <-results
		if result.err != nil {
			invalid = append(invalid, ModuleError{
				Module: result.module,
				Error:  result.err.Error(),
			})
			v.logger.Debug("Module validation failed", "module", result.module, "error", result.err)
		} else {
			valid = append(valid, result.module)
			v.logger.Debug("Module validation succeeded", "module", result.module)
		}
	}

	v.logger.Info("Module validation complete",
		"total", len(modules),
		"valid", len(valid),
		"invalid", len(invalid))

	return &ValidationResult{
		Valid:   valid,
		Invalid: invalid,
	}, nil
}