package devserver

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/rumor-ml/log/pkg/log"
)

// ModuleMetadata contains metadata for a module
type ModuleMetadata struct {
	Alias       string
	PackageName string
	DisplayName string
	Routes      []string
	Required    bool
}

// MainGenerator handles main.go generation for the server
type MainGenerator struct {
	serverDir    string
	validModules []string
	logger       log.Logger
}

// NewMainGenerator creates a new main.go generator
func NewMainGenerator(carriercommonsRoot string) *MainGenerator {
	return &MainGenerator{
		serverDir: filepath.Join(carriercommonsRoot, "server"),
		logger:    log.Get().WithComponent("devserver-generator"),
	}
}

// SetValidModules sets the list of valid modules for generation
func (g *MainGenerator) SetValidModules(modules []string) {
	g.validModules = modules
}

// getModuleMetadata returns metadata for a specific module
func (g *MainGenerator) getModuleMetadata(module string) ModuleMetadata {
	meta := ModuleMetadata{}

	if module == "carriercommons" {
		meta.Alias = "projectweb"
		meta.PackageName = "github.com/rumor-ml/carriercommons/pkg/web"
		meta.DisplayName = "Project Management Dashboard"
		meta.Routes = []string{"/", "/api/sync"}
		meta.Required = true
	} else {
		// Read module name from go.mod
		modPath := filepath.Join(filepath.Dir(g.serverDir), module, "go.mod")
		content, err := os.ReadFile(modPath)
		if err == nil {
			lines := strings.Split(string(content), "\n")
			for _, line := range lines {
				if strings.HasPrefix(line, "module ") {
					parts := strings.Fields(line)
					if len(parts) >= 2 {
						meta.PackageName = parts[1] + "/pkg/web"
						break
					}
				}
			}
		}

		// Generate alias and display name
		meta.Alias = module + "web"

		switch module {
		case "object":
			meta.DisplayName = "Object Storage Management"
			meta.Routes = []string{"/object", "/api/object"}
		case "imagen":
			meta.DisplayName = "Image Processing"
			meta.Routes = []string{"/imagen"}
		case "finance":
			meta.DisplayName = "Finance Dashboard"
			meta.Routes = []string{"/finance"}
		case "video":
			meta.DisplayName = "Video Management"
			meta.Routes = []string{"/video", "/api/video"}
		case "audio":
			meta.DisplayName = "Audio Management"
			meta.Routes = []string{"/audio", "/api/audio"}
		case "print":
			meta.DisplayName = "Document & Print Management"
			meta.Routes = []string{"/print", "/api/print"}
		case "layout":
			meta.DisplayName = "Layout & Booklet Design"
			meta.Routes = []string{"/layout", "/layout/api"}
		default:
			// Capitalize first letter for display name
			displayName := strings.ToUpper(module[:1]) + module[1:] + " Management"
			meta.DisplayName = displayName
			meta.Routes = []string{"/" + module}
		}
		meta.Required = false
	}

	return meta
}

// buildImports generates the imports section
func (g *MainGenerator) buildImports() string {
	var imports []string

	for _, module := range g.validModules {
		meta := g.getModuleMetadata(module)
		if meta.PackageName != "" {
			imports = append(imports, fmt.Sprintf("\t%s \"%s\"", meta.Alias, meta.PackageName))
		}
	}

	return strings.Join(imports, "\n")
}

// buildRegistrations generates the module registration code
func (g *MainGenerator) buildRegistrations() string {
	var registrations []string

	for _, module := range g.validModules {
		meta := g.getModuleMetadata(module)
		if meta.PackageName == "" {
			continue
		}

		reg := "\tsrv.RegisterModule(module.ModuleDescriptor{\n"
		reg += fmt.Sprintf("\t\tName:      \"%s\",\n", meta.DisplayName)
		reg += fmt.Sprintf("\t\tPackage:   \"%s\",\n", meta.PackageName)

		// Handle routes
		if len(meta.Routes) > 0 {
			routesStr := strings.Join(
				func() []string {
					quoted := make([]string, len(meta.Routes))
					for i, r := range meta.Routes {
						quoted[i] = fmt.Sprintf("\"%s\"", r)
					}
					return quoted
				}(),
				", ",
			)
			reg += fmt.Sprintf("\t\tRoutes:    []string{%s},\n", routesStr)
		}

		reg += fmt.Sprintf("\t\tRegistrar: %s.RegisterRoutes,\n", meta.Alias)

		if meta.Required {
			reg += "\t\tRequired:  true, // Critical for server functionality\n"
		} else {
			reg += "\t\tRequired:  false, // Non-critical module\n"
		}

		reg += "\t})"
		registrations = append(registrations, reg)
	}

	return strings.Join(registrations, "\n\n")
}

const mainGoTemplate = `package main

import (
	"flag"
	"fmt"
	"os"

{{IMPORTS}}
{{MODULE_IMPORT}}
	"github.com/rumor-ml/server/internal/server"
)

func main() {
	var (
		port           = flag.Int("port", 8080, "Port to listen on")
		dev            = flag.Bool("dev", false, "Enable development mode (opens browser, enables auto-shutdown)")
		noAutoShutdown = flag.Bool("no-auto-shutdown", false, "Disable auto-shutdown when browser closes")
		initialPath    = flag.String("initial-path", "/", "Initial path to open in browser")
	)
	flag.Parse()

	// Create server configuration with production defaults
	config := &server.Config{
		Port:             fmt.Sprintf(":%d", *port),
		OpenBrowser:      false, // Default: no browser opening (production mode)
		AutoShutdown:     false, // Default: no auto-shutdown (production mode)
		HeartbeatTimeout: server.DefaultConfig().HeartbeatTimeout,
		InitialPath:      *initialPath,
	}

	// Enable development mode features
	if *dev {
		config.OpenBrowser = true
		config.AutoShutdown = true
		fmt.Println("Development mode: Browser opening and auto-shutdown enabled")
	}

	// Override auto-shutdown if explicitly disabled
	if *noAutoShutdown {
		config.AutoShutdown = false
		fmt.Println("Auto-shutdown disabled")
	}

	// Create server
	srv, err := server.New(config)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create server: %v\n", err)
		os.Exit(1)
	}

	// Register modules
{{REGISTRATIONS}}

	// Load all modules with error handling
	fmt.Println("Loading modules...")
	if err := srv.LoadModules(); err != nil {
		fmt.Fprintf(os.Stderr, "Critical module loading failures: %v\n", err)
		os.Exit(1)
	}

	// Display module loading results
	fmt.Println("\nModule loading complete!")

{{OBJECT_SCAN}}
	// Start the server
	fmt.Printf("\n🚀 Server starting on http://localhost%s\n", config.Port)
	if err := srv.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Server failed: %v\n", err)
		os.Exit(1)
	}
}
`

// GenerateMainGo generates the main.go file with valid modules
func (g *MainGenerator) GenerateMainGo() error {
	// Use embedded template
	content := mainGoTemplate
	content = strings.Replace(content, "{{IMPORTS}}", g.buildImports(), 1)
	content = strings.Replace(content, "{{REGISTRATIONS}}", g.buildRegistrations(), 1)

	// Conditionally include module import (only if there are valid modules)
	moduleImport := ""
	if len(g.validModules) > 0 {
		moduleImport = "\n\t\"github.com/rumor-ml/server/internal/module\""
	}
	content = strings.Replace(content, "{{MODULE_IMPORT}}", moduleImport, 1)

	// Conditionally include object scan code
	// CRITICAL: Only trigger scan if BOTH object AND video modules are present
	// This prevents metadata loss from scanning before video file types are registered
	objectScan := ""
	hasObject := false
	hasVideo := false
	for _, module := range g.validModules {
		if module == "object" {
			hasObject = true
		}
		if module == "video" {
			hasVideo = true
		}
	}

	if hasObject && hasVideo {
		objectScan = `
	// Trigger object module's initial GCS scan now that all modules are loaded
	// This ensures all media type handlers are registered before scanning
	fmt.Println("\nTriggering initial GCS scan...")
	if err := objectweb.TriggerInitialScan(); err != nil {
		fmt.Printf("Warning: Initial GCS scan failed: %v\n", err)
	}
`
	} else if hasObject && !hasVideo {
		g.logger.Warn("Object module loaded without video module - skipping initial scan to prevent metadata loss")
		objectScan = `
	// Skipping initial GCS scan - video module not loaded
	// To enable scanning, include both object and video modules
	fmt.Println("\nSkipping initial GCS scan (video module not loaded)")
`
	}
	content = strings.Replace(content, "{{OBJECT_SCAN}}", objectScan, 1)

	// Backup original main.go if it exists
	mainPath := filepath.Join(g.serverDir, "main.go")
	if _, err := os.Stat(mainPath); err == nil {
		backupPath := mainPath + ".original"
		if err := os.Rename(mainPath, backupPath); err != nil {
			return fmt.Errorf("failed to backup main.go: %w", err)
		}
		g.logger.Debug("Backed up original main.go", "backup", backupPath)
	}

	// Write generated main.go
	generatedPath := filepath.Join(g.serverDir, "main.go.generated")
	if err := os.WriteFile(generatedPath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write generated main.go: %w", err)
	}

	// Copy generated to main.go
	if err := os.Rename(generatedPath, mainPath); err != nil {
		return fmt.Errorf("failed to move generated main.go: %w", err)
	}

	g.logger.Info("Generated main.go successfully", "modules", strings.Join(g.validModules, ","))
	return nil
}

// RestoreOriginalMain restores the original main.go file
func (g *MainGenerator) RestoreOriginalMain() error {
	mainPath := filepath.Join(g.serverDir, "main.go")
	backupPath := mainPath + ".original"

	if _, err := os.Stat(backupPath); err == nil {
		if err := os.Rename(backupPath, mainPath); err != nil {
			return fmt.Errorf("failed to restore original main.go: %w", err)
		}
		g.logger.Debug("Restored original main.go")
	}

	return nil
}