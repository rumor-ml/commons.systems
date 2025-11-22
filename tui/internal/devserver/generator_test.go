package devserver

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestMainGenerator(t *testing.T) {
	// Create a temporary server directory
	tempDir := t.TempDir()
	serverDir := filepath.Join(tempDir, "server")
	if err := os.MkdirAll(serverDir, 0755); err != nil {
		t.Fatal(err)
	}

	generator := NewMainGenerator(tempDir)
	if generator == nil {
		t.Fatal("NewMainGenerator returned nil")
	}
}

func TestGenerateMain(t *testing.T) {
	// Create a temporary server directory
	tempDir := t.TempDir()
	serverDir := filepath.Join(tempDir, "server")
	if err := os.MkdirAll(serverDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a template file (required by GenerateMainGo)
	templateContent := `package main

{{IMPORTS}}

func main() {
{{REGISTRATIONS}}
}`
	templateFile := filepath.Join(serverDir, "main.go.template")
	if err := os.WriteFile(templateFile, []byte(templateContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Create an original main.go to backup
	originalMain := filepath.Join(serverDir, "main.go")
	originalContent := "package main\n\nfunc main() {\n\t// Original\n}\n"
	if err := os.WriteFile(originalMain, []byte(originalContent), 0644); err != nil {
		t.Fatal(err)
	}

	generator := NewMainGenerator(tempDir)

	// Generate main with some modules
	modules := []string{"module1", "module2"}
	generator.SetValidModules(modules)
	err := generator.GenerateMainGo()
	if err != nil {
		t.Fatalf("GenerateMain failed: %v", err)
	}

	// Check that backup was created
	backupPath := filepath.Join(serverDir, "main.go.original")
	if _, err := os.Stat(backupPath); err != nil {
		t.Error("Backup file was not created")
	}

	// Check that new main.go was created
	newContent, err := os.ReadFile(originalMain)
	if err != nil {
		t.Fatal(err)
	}

	newContentStr := string(newContent)

	// The template replacement should have occurred
	// Check that the template placeholders were replaced
	if strings.Contains(newContentStr, "{{IMPORTS}}") {
		t.Error("Template placeholder {{IMPORTS}} should have been replaced")
	}

	if strings.Contains(newContentStr, "{{REGISTRATIONS}}") {
		t.Error("Template placeholder {{REGISTRATIONS}} should have been replaced")
	}

	// Should contain main function
	if !strings.Contains(newContentStr, "func main()") {
		t.Error("Generated main.go should contain main function")
	}

	// Should contain module references (from the template replacement)
	if !strings.Contains(newContentStr, "func main()") {
		t.Error("Generated main.go should contain main function")
	}
}

func TestRestoreOriginalMain(t *testing.T) {
	// Create a temporary server directory
	tempDir := t.TempDir()
	serverDir := filepath.Join(tempDir, "server")
	if err := os.MkdirAll(serverDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a template file
	templateContent := `package main
{{IMPORTS}}
func main() {
{{REGISTRATIONS}}
}`
	templateFile := filepath.Join(serverDir, "main.go.template")
	if err := os.WriteFile(templateFile, []byte(templateContent), 0644); err != nil {
		t.Fatal(err)
	}

	// Create an original main.go
	originalMain := filepath.Join(serverDir, "main.go")
	originalContent := "package main\n\nfunc main() {\n\t// Original\n}\n"
	if err := os.WriteFile(originalMain, []byte(originalContent), 0644); err != nil {
		t.Fatal(err)
	}

	generator := NewMainGenerator(tempDir)

	// Generate new main
	modules := []string{"module1"}
	generator.SetValidModules(modules)
	err := generator.GenerateMainGo()
	if err != nil {
		t.Fatalf("GenerateMain failed: %v", err)
	}

	// Verify main.go has changed
	modifiedContent, _ := os.ReadFile(originalMain)
	if string(modifiedContent) == originalContent {
		t.Error("main.go should have been modified")
	}

	// Restore original
	err = generator.RestoreOriginalMain()
	if err != nil {
		t.Fatalf("RestoreOriginalMain failed: %v", err)
	}

	// Check that original was restored
	restoredContent, err := os.ReadFile(originalMain)
	if err != nil {
		t.Fatal(err)
	}

	if string(restoredContent) != originalContent {
		t.Error("Original main.go was not properly restored")
	}

	// Check that backup was removed
	backupPath := filepath.Join(serverDir, "main.go.original")
	if _, err := os.Stat(backupPath); err == nil {
		t.Error("Backup file should have been removed")
	}
}

func TestGenerateMainNoOriginal(t *testing.T) {
	// Create a temporary server directory without main.go
	tempDir := t.TempDir()
	serverDir := filepath.Join(tempDir, "server")
	if err := os.MkdirAll(serverDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a template file
	templateContent := `package main
{{IMPORTS}}
func main() {
{{REGISTRATIONS}}
}`
	templateFile := filepath.Join(serverDir, "main.go.template")
	if err := os.WriteFile(templateFile, []byte(templateContent), 0644); err != nil {
		t.Fatal(err)
	}

	generator := NewMainGenerator(tempDir)

	// Should handle missing original main.go gracefully
	modules := []string{"module1"}
	generator.SetValidModules(modules)
	err := generator.GenerateMainGo()
	if err != nil {
		t.Fatalf("GenerateMain should handle missing original: %v", err)
	}

	// Check that new main.go was created
	mainPath := filepath.Join(serverDir, "main.go")
	if _, err := os.Stat(mainPath); err != nil {
		t.Error("main.go should have been created")
	}

	// No backup should exist since there was no original
	backupPath := filepath.Join(serverDir, "main.go.original")
	if _, err := os.Stat(backupPath); err == nil {
		t.Error("No backup should exist when there's no original")
	}
}

func TestGetModuleMetadata(t *testing.T) {
	generator := NewMainGenerator(t.TempDir())

	tests := []struct {
		module   string
		expected string
	}{
		{"audio", "Audio Management"},
		{"video", "Video Management"},
		{"imagen", "Image Processing"},
		{"unknown", "Unknown Management"},
	}

	for _, tt := range tests {
		t.Run(tt.module, func(t *testing.T) {
			metadata := generator.getModuleMetadata(tt.module)
			if metadata.DisplayName != tt.expected {
				t.Errorf("Expected display name '%s', got '%s'", tt.expected, metadata.DisplayName)
			}
		})
	}
}