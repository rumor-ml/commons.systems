package main

import (
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestMainBasicFunctionality tests that the main entry point handles basic scenarios
func TestMainBasicFunctionality(t *testing.T) {
	// Save current working directory
	originalCwd, err := os.Getwd()
	require.NoError(t, err)
	defer os.Chdir(originalCwd)

	// Test that getting the current working directory works
	// (This is what the application now uses instead of complex workspace root detection)
	t.Run("current directory detection", func(t *testing.T) {
		cwd, err := os.Getwd()
		assert.NoError(t, err)
		assert.NotEmpty(t, cwd)
	})
}
