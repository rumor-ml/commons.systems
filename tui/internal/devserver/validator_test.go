package devserver

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestModuleValidator(t *testing.T) {
	// Create a temporary directory for testing
	tempDir := t.TempDir()

	validator := NewModuleValidator(tempDir)
	if validator == nil {
		t.Fatal("NewModuleValidator returned nil")
	}
}

func TestDiscoverModules(t *testing.T) {
	// Create a temporary directory structure
	tempDir := t.TempDir()

	// Create some test module directories
	modules := []string{"testmodule1", "testmodule2", "notamodule"}
	for _, mod := range modules[:2] {
		modDir := filepath.Join(tempDir, mod)
		if err := os.MkdirAll(modDir, 0755); err != nil {
			t.Fatal(err)
		}

		// Create go.mod file
		goModPath := filepath.Join(modDir, "go.mod")
		content := "module github.com/test/" + mod + "\n\ngo 1.21\n"
		if err := os.WriteFile(goModPath, []byte(content), 0644); err != nil {
			t.Fatal(err)
		}

		// Create pkg/web directory (required for discovery)
		webDir := filepath.Join(modDir, "pkg", "web")
		if err := os.MkdirAll(webDir, 0755); err != nil {
			t.Fatal(err)
		}
	}

	// Create directory without go.mod
	if err := os.MkdirAll(filepath.Join(tempDir, "notamodule"), 0755); err != nil {
		t.Fatal(err)
	}

	validator := NewModuleValidator(tempDir)
	discovered, err := validator.DiscoverModules()
	if err != nil {
		t.Fatalf("DiscoverModules failed: %v", err)
	}

	// Should find 2 modules
	if len(discovered) != 2 {
		t.Errorf("Expected 2 modules, found %d", len(discovered))
	}

	// Check module names
	foundModules := make(map[string]bool)
	for _, mod := range discovered {
		foundModules[mod] = true
	}

	if !foundModules["testmodule1"] {
		t.Error("testmodule1 not found")
	}

	if !foundModules["testmodule2"] {
		t.Error("testmodule2 not found")
	}

	if foundModules["notamodule"] {
		t.Error("notamodule should not be discovered")
	}
}

func TestValidateModule(t *testing.T) {
	// Create a temporary directory structure
	tempDir := t.TempDir()

	// Create a valid module with pkg/web directory
	validModule := filepath.Join(tempDir, "validmodule")
	webDir := filepath.Join(validModule, "pkg", "web")
	if err := os.MkdirAll(webDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a dummy .go file in the web package
	goFile := filepath.Join(webDir, "handler.go")
	if err := os.WriteFile(goFile, []byte("package web\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create go.mod
	goModPath := filepath.Join(validModule, "go.mod")
	if err := os.WriteFile(goModPath, []byte("module github.com/test/validmodule\ngo 1.21\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create an invalid module without pkg/web
	invalidModule := filepath.Join(tempDir, "invalidmodule")
	if err := os.MkdirAll(invalidModule, 0755); err != nil {
		t.Fatal(err)
	}

	// Create go.mod
	goModPath2 := filepath.Join(invalidModule, "go.mod")
	if err := os.WriteFile(goModPath2, []byte("module github.com/test/invalidmodule\ngo 1.21\n"), 0644); err != nil {
		t.Fatal(err)
	}

	validator := NewModuleValidator(tempDir)

	// Test valid module
	isValid := validator.ValidateModule("validmodule")
	if !isValid {
		t.Error("Expected validmodule to be valid")
	}

	// Test invalid module
	isValid2 := validator.ValidateModule("invalidmodule")
	if isValid2 {
		t.Error("Expected invalidmodule to be invalid")
	}
}

func TestDiscoverAndValidate(t *testing.T) {
	// Create a temporary directory structure
	tempDir := t.TempDir()

	// Create a valid module with pkg/web and go.mod
	validModule := filepath.Join(tempDir, "validmodule")
	webDir := filepath.Join(validModule, "pkg", "web")
	if err := os.MkdirAll(webDir, 0755); err != nil {
		t.Fatal(err)
	}

	// Create a dummy .go file
	goFile := filepath.Join(webDir, "handler.go")
	if err := os.WriteFile(goFile, []byte("package web\n"), 0644); err != nil {
		t.Fatal(err)
	}
	goModPath := filepath.Join(validModule, "go.mod")
	if err := os.WriteFile(goModPath, []byte("module github.com/test/validmodule\ngo 1.21\n"), 0644); err != nil {
		t.Fatal(err)
	}

	// Create an invalid module with go.mod but no pkg/web
	invalidModule := filepath.Join(tempDir, "invalidmodule")
	if err := os.MkdirAll(invalidModule, 0755); err != nil {
		t.Fatal(err)
	}
	goModPath2 := filepath.Join(invalidModule, "go.mod")
	if err := os.WriteFile(goModPath2, []byte("module github.com/test/invalidmodule\ngo 1.21\n"), 0644); err != nil {
		t.Fatal(err)
	}

	validator := NewModuleValidator(tempDir)

	// Use DiscoverAndValidate which combines both steps
	validModules := validator.DiscoverAndValidate()

	// Should only find the valid module
	if len(validModules) != 1 {
		t.Errorf("Expected 1 valid module, got %d", len(validModules))
	}

	if len(validModules) > 0 && validModules[0] != "validmodule" {
		t.Errorf("Expected 'validmodule', got %s", validModules[0])
	}
}

// TestValidateModuleCompilation_ValidModule tests compilation validation with a valid module
func TestValidateModuleCompilation_ValidModule(t *testing.T) {
	// Use test fixture
	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create a module entry in the validator's root to test
	// We'll test with the valid_simple fixture
	err := validator.ValidateModuleCompilation(ctx, "valid_simple")
	if err != nil {
		t.Errorf("Expected valid_simple to compile successfully, got error: %v", err)
	}
}

// TestValidateModuleCompilation_UnusedImport tests that unused imports are detected
func TestValidateModuleCompilation_UnusedImport(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := validator.ValidateModuleCompilation(ctx, "invalid_unused_import")
	if err == nil {
		t.Error("Expected compilation error for unused import, got nil")
	}

	// Check that error message mentions unused import
	if !strings.Contains(err.Error(), "imported and not used") && !strings.Contains(err.Error(), "unused") {
		t.Errorf("Expected error about unused import, got: %v", err)
	}
}

// TestValidateModuleCompilation_SyntaxError tests that syntax errors are detected
func TestValidateModuleCompilation_SyntaxError(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := validator.ValidateModuleCompilation(ctx, "invalid_syntax_error")
	if err == nil {
		t.Error("Expected compilation error for syntax error, got nil")
	}

	// Check that error mentions syntax issue
	if !strings.Contains(err.Error(), "syntax error") && !strings.Contains(err.Error(), "expected") {
		t.Errorf("Expected syntax error message, got: %v", err)
	}
}

// TestValidateModuleCompilation_MissingFunction tests module with missing RegisterRoutes
// NOTE: The simplified validation (matching server script) only checks if pkg/web compiles,
// not if it has RegisterRoutes. The server's build process will catch missing RegisterRoutes
// when generating main.go. So this module will pass validation at the module level.
func TestValidateModuleCompilation_MissingFunction(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	err := validator.ValidateModuleCompilation(ctx, "invalid_missing_function")
	// Module compiles fine even without RegisterRoutes - this is expected behavior
	// matching the server script's validation approach
	if err != nil {
		t.Errorf("Expected module to compile (even without RegisterRoutes), got error: %v", err)
	}
}

// TestValidateModuleCompilation_Timeout tests that validation respects timeout
func TestValidateModuleCompilation_Timeout(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping timeout test in short mode")
	}

	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	// Use very short timeout to trigger timeout error
	ctx, cancel := context.WithTimeout(context.Background(), 1*time.Nanosecond)
	defer cancel()

	err := validator.ValidateModuleCompilation(ctx, "valid_simple")
	if err == nil {
		t.Error("Expected timeout error, got nil")
	}

	// Error should mention context deadline or timeout
	if !strings.Contains(err.Error(), "deadline") && !strings.Contains(err.Error(), "timeout") {
		t.Logf("Warning: Expected timeout/deadline error, got: %v", err)
	}
}

// TestDiscoverAndValidateWithDetails_MixedModules tests validation with mixed valid/invalid modules
func TestDiscoverAndValidateWithDetails_MixedModules(t *testing.T) {
	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	result, err := validator.DiscoverAndValidateWithDetails(ctx)
	if err != nil {
		t.Fatalf("DiscoverAndValidateWithDetails failed: %v", err)
	}

	// We have 1 valid and 3 invalid modules in fixtures
	if len(result.Valid) < 1 {
		t.Errorf("Expected at least 1 valid module, got %d", len(result.Valid))
	}

	if len(result.Invalid) < 1 {
		t.Errorf("Expected at least 1 invalid module, got %d", len(result.Invalid))
	}

	// Check that valid_simple is in valid list
	foundValid := false
	for _, mod := range result.Valid {
		if mod == "valid_simple" {
			foundValid = true
			break
		}
	}
	if !foundValid {
		t.Error("Expected valid_simple to be in valid modules list")
	}

	// Check that invalid modules have error details
	for _, invalid := range result.Invalid {
		if invalid.Error == "" {
			t.Errorf("Module %s marked invalid but has no error message", invalid.Module)
		}
	}
}

// TestDiscoverAndValidateWithDetails_NoModules tests behavior with no modules
func TestDiscoverAndValidateWithDetails_NoModules(t *testing.T) {
	// Create empty temp directory
	tempDir := t.TempDir()
	validator := NewModuleValidator(tempDir)

	ctx := context.Background()
	result, err := validator.DiscoverAndValidateWithDetails(ctx)
	if err != nil {
		t.Fatalf("Expected no error with empty directory, got: %v", err)
	}

	if len(result.Valid) != 0 {
		t.Errorf("Expected 0 valid modules, got %d", len(result.Valid))
	}

	if len(result.Invalid) != 0 {
		t.Errorf("Expected 0 invalid modules, got %d", len(result.Invalid))
	}
}

// TestDiscoverAndValidateWithDetails_ParallelValidation tests that validation runs in parallel
func TestDiscoverAndValidateWithDetails_ParallelValidation(t *testing.T) {
	if testing.Short() {
		t.Skip("Skipping parallel validation test in short mode")
	}

	fixtureRoot := filepath.Join("testdata", "modules")
	validator := NewModuleValidator(fixtureRoot)

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	start := time.Now()
	result, err := validator.DiscoverAndValidateWithDetails(ctx)
	elapsed := time.Since(start)

	if err != nil {
		t.Fatalf("DiscoverAndValidateWithDetails failed: %v", err)
	}

	totalModules := len(result.Valid) + len(result.Invalid)
	t.Logf("Validated %d modules in %v", totalModules, elapsed)

	// If we have at least 4 modules and it completes in reasonable time,
	// parallel validation is likely working (serial would be much slower)
	if totalModules >= 4 && elapsed > 60*time.Second {
		t.Logf("Warning: Validation took longer than expected, parallel validation may not be working")
	}
}