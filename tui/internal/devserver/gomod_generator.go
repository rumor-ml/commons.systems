package devserver

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/rumor-ml/log/pkg/log"
	"golang.org/x/mod/modfile"
)

// GoModGenerator handles go.mod generation for the server
type GoModGenerator struct {
	serverDir    string
	validModules []string
	logger       log.Logger
}

// NewGoModGenerator creates a new go.mod generator
func NewGoModGenerator(carriercommonsRoot string) *GoModGenerator {
	return &GoModGenerator{
		serverDir: filepath.Join(carriercommonsRoot, "server"),
		logger:    log.Get().WithComponent("gomod-generator"),
	}
}

// SetValidModules sets the list of valid modules
func (g *GoModGenerator) SetValidModules(modules []string) {
	g.validModules = modules
}

// getModuleImportPath returns the import path for a module
func (g *GoModGenerator) getModuleImportPath(module string) string {
	if module == "carriercommons" {
		return "github.com/rumor-ml/carriercommons"
	}

	// Read from module's go.mod
	modPath := filepath.Join(filepath.Dir(g.serverDir), module, "go.mod")
	content, err := os.ReadFile(modPath)
	if err != nil {
		return ""
	}

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		if strings.HasPrefix(line, "module ") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				return parts[1]
			}
		}
	}
	return ""
}

// parseServerGoMod parses the original server/go.mod file
func (g *GoModGenerator) parseServerGoMod() (*modfile.File, error) {
	goModPath := filepath.Join(g.serverDir, "go.mod")

	content, err := os.ReadFile(goModPath)
	if err != nil {
		return nil, fmt.Errorf("reading server go.mod at %s: %w", goModPath, err)
	}

	parsed, err := modfile.Parse(goModPath, content, nil)
	if err != nil {
		return nil, fmt.Errorf("parsing server go.mod: %w", err)
	}

	return parsed, nil
}

// buildGoModFromParsed builds go.mod content from parsed modfile
func (g *GoModGenerator) buildGoModFromParsed(parsed *modfile.File) string {
	var buf bytes.Buffer

	// Write module declaration
	fmt.Fprintf(&buf, "module %s\n\n", parsed.Module.Mod.Path)

	// Write go version
	if parsed.Go != nil {
		fmt.Fprintf(&buf, "go %s\n\n", parsed.Go.Version)
	}

	// Write toolchain if present
	if parsed.Toolchain != nil {
		fmt.Fprintf(&buf, "toolchain %s\n\n", parsed.Toolchain.Name)
	}

	// Collect base dependencies (always needed)
	baseDeps := map[string]bool{
		"github.com/mattn/go-sqlite3":       true,
		"github.com/n8/testing-framework":   true,
		"github.com/rumor-ml/carriercommons": true,
		"github.com/rumor-ml/log":           true,
		"github.com/rumor-ml/store":         true,
	}

	// Collect module-specific dependencies
	moduleDeps := make(map[string]bool)
	for _, module := range g.validModules {
		if module == "carriercommons" {
			continue // Already in baseDeps
		}
		importPath := g.getModuleImportPath(module)
		if importPath != "" {
			moduleDeps[importPath] = true
		}
	}

	// Write require block with base deps + module deps
	buf.WriteString("require (\n")

	// Add base dependencies with their versions from parsed go.mod
	for _, req := range parsed.Require {
		if baseDeps[req.Mod.Path] || moduleDeps[req.Mod.Path] {
			fmt.Fprintf(&buf, "\t%s %s\n", req.Mod.Path, req.Mod.Version)
		}
	}

	buf.WriteString(")\n\n")

	// Write replace directives - copy all from original go.mod
	// This ensures local dependencies like testing-framework are preserved
	if len(parsed.Replace) > 0 {
		for _, rep := range parsed.Replace {
			if rep.New.Version != "" {
				// Replace with version (e.g., replace foo => bar v1.0.0)
				fmt.Fprintf(&buf, "replace %s => %s %s\n",
					rep.Old.Path, rep.New.Path, rep.New.Version)
			} else {
				// Replace with path only (e.g., replace foo => ../bar)
				fmt.Fprintf(&buf, "replace %s => %s\n",
					rep.Old.Path, rep.New.Path)
			}
		}
	}

	return buf.String()
}

// getFallbackGoMod returns a minimal fallback go.mod template
func (g *GoModGenerator) getFallbackGoMod() string {
	return `module github.com/rumor-ml/server

go 1.24.0

toolchain go1.24.10

require (
	github.com/mattn/go-sqlite3 v1.14.32
	github.com/n8/testing-framework v0.0.0
	github.com/rumor-ml/carriercommons v0.0.0-00010101000000-000000000000
	github.com/rumor-ml/log v0.0.0
	github.com/rumor-ml/store v0.0.0
)

replace github.com/n8/testing-framework => ../testing-framework
replace github.com/rumor-ml/carriercommons => ..
replace github.com/rumor-ml/log => ../log
replace github.com/rumor-ml/store => ../store
`
}

// GenerateGoMod generates go.mod with only valid modules
func (g *GoModGenerator) GenerateGoMod() error {
	// Attempt to parse the original server/go.mod
	parsed, err := g.parseServerGoMod()

	var content string
	if err != nil {
		// Log parsing failure and use fallback template
		g.logger.Warn("failed to parse server go.mod, using fallback template",
			"error", err)
		content = g.getFallbackGoMod()
	} else {
		// Successfully parsed - build go.mod from parsed data
		g.logger.Info("successfully parsed server go.mod",
			"dependencies", len(parsed.Require),
			"replaces", len(parsed.Replace))
		content = g.buildGoModFromParsed(parsed)

		// Log synchronized dependencies
		g.logger.Info("synchronized dependencies from server/go.mod",
			"modules", strings.Join(g.validModules, ","))
	}

	// Backup original
	goModPath := filepath.Join(g.serverDir, "go.mod")
	if _, err := os.Stat(goModPath); err == nil {
		backupPath := goModPath + ".original"
		if err := os.Rename(goModPath, backupPath); err != nil {
			return fmt.Errorf("failed to backup go.mod: %w", err)
		}
		g.logger.Debug("Backed up original go.mod", "backup", backupPath)
	}

	// Write new go.mod
	if err := os.WriteFile(goModPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write go.mod: %w", err)
	}

	g.logger.Info("Generated go.mod successfully", "modules", strings.Join(g.validModules, ","))
	return nil
}

// RestoreOriginalGoMod restores the original go.mod
func (g *GoModGenerator) RestoreOriginalGoMod() error {
	goModPath := filepath.Join(g.serverDir, "go.mod")
	backupPath := goModPath + ".original"

	if _, err := os.Stat(backupPath); err == nil {
		if err := os.Rename(backupPath, goModPath); err != nil {
			return fmt.Errorf("failed to restore original go.mod: %w", err)
		}
		g.logger.Debug("Restored original go.mod")
	}

	return nil
}
