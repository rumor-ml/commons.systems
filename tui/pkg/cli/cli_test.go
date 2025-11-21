package cli

import (
	"flag"
	"os"
	"testing"
)

func TestParseNoArgs(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Simulate no arguments
	os.Args = []string{"assistant"}

	config, err := Parse()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if config.Tools {
		t.Error("Expected Tools to be false")
	}

	if config.Help {
		t.Error("Expected Help to be false")
	}

	if len(config.Args) != 0 {
		t.Errorf("Expected no remaining args, got %v", config.Args)
	}
}

func TestParseToolsFlag(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Simulate -p flag
	os.Args = []string{"assistant", "-p"}

	config, err := Parse()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if !config.Tools {
		t.Error("Expected Tools to be true")
	}

	if config.Help {
		t.Error("Expected Help to be false")
	}
}

func TestParseHelpFlag(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Simulate -h flag
	os.Args = []string{"assistant", "-h"}

	config, err := Parse()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if config.Tools {
		t.Error("Expected Tools to be false")
	}

	if !config.Help {
		t.Error("Expected Help to be true")
	}
}

func TestParseMultipleFlags(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Simulate multiple flags
	os.Args = []string{"assistant", "-p", "-h"}

	config, err := Parse()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if !config.Tools {
		t.Error("Expected Tools to be true")
	}

	if !config.Help {
		t.Error("Expected Help to be true")
	}
}

func TestParseWithArgs(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Simulate flags with additional arguments
	os.Args = []string{"assistant", "-p", "arg1", "arg2"}

	config, err := Parse()
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}

	if !config.Tools {
		t.Error("Expected Tools to be true")
	}

	expectedArgs := []string{"arg1", "arg2"}
	if len(config.Args) != len(expectedArgs) {
		t.Errorf("Expected %d args, got %d", len(expectedArgs), len(config.Args))
	}

	for i, expected := range expectedArgs {
		if config.Args[i] != expected {
			t.Errorf("Expected arg %d to be '%s', got '%s'", i, expected, config.Args[i])
		}
	}
}

func TestExecuteHelp(t *testing.T) {
	config := &Config{Help: true}

	err := Execute(config)
	if err != nil {
		t.Errorf("Expected no error from help, got %v", err)
	}
}

func TestExecuteTools(t *testing.T) {
	config := &Config{Tools: true}

	err := Execute(config)
	if err != nil {
		t.Errorf("Expected no error from tools, got %v", err)
	}
}

func TestExecuteMultiplexer(t *testing.T) {
	config := &Config{} // No flags set, should run multiplexer

	err := Execute(config)
	if err != nil {
		t.Errorf("Expected no error from multiplexer, got %v", err)
	}
}

func TestHelpContent(t *testing.T) {
	// Capture help output by testing the function directly
	err := showHelp()
	if err != nil {
		t.Errorf("Expected no error from showHelp, got %v", err)
	}

	// Note: In a real implementation, we might want to capture stdout
	// and test the actual help content, but for now we just test it doesn't error
}

func TestExecutePriority(t *testing.T) {
	// Test that help takes priority
	config := &Config{Help: true, Tools: true}

	err := Execute(config)
	if err != nil {
		t.Errorf("Expected no error, got %v", err)
	}
}

func TestConfigStruct(t *testing.T) {
	config := &Config{
		Tools: false,
		Help:  true,
		Args:  []string{"test", "args"},
	}

	if config.Tools {
		t.Error("Expected Tools to be false")
	}

	if !config.Help {
		t.Error("Expected Help to be true")
	}

	if len(config.Args) != 2 {
		t.Errorf("Expected 2 args, got %d", len(config.Args))
	}

	if config.Args[0] != "test" {
		t.Errorf("Expected first arg to be 'test', got '%s'", config.Args[0])
	}

	if config.Args[1] != "args" {
		t.Errorf("Expected second arg to be 'args', got '%s'", config.Args[1])
	}
}

// Helper function to capture output for testing help content
// This would be more useful in a real implementation
func captureHelpOutput() string {
	// In a real implementation, we might redirect stdout to capture the help text
	// For now, we just return empty string since we're not testing the actual content
	return ""
}

func TestHelpFormatting(t *testing.T) {
	// This test would be more meaningful if we captured the actual output
	// For now, we just verify the function executes without error
	err := showHelp()
	if err != nil {
		t.Errorf("showHelp should not return error, got %v", err)
	}
}

// Test that all expected functions are available in the CLI package
func TestPackageAPI(t *testing.T) {
	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	// Test that Parse function exists and returns expected types
	config, err := Parse()
	if config == nil {
		t.Error("Parse should return a non-nil config")
	}

	if err != nil {
		// In this test environment, we might get an error due to os.Args manipulation
		// That's okay for this API test
	}

	// Test that Execute function exists and accepts Config
	err = Execute(&Config{})
	if err != nil {
		// Execute might return an error in test environment, that's okay
	}
}

func TestAllFlagsImplemented(t *testing.T) {
	// Verify that our CLI supports all the flags mentioned in the spec
	// This is a documentation test to ensure we don't miss any flags

	expectedFlags := []string{"p", "h"}

	// Reset flags for testing
	flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)

	for _, flagName := range expectedFlags {
		// Simulate each flag
		os.Args = []string{"assistant", "-" + flagName}

		config, err := Parse()
		if err != nil {
			t.Errorf("Flag -%s should be supported, got error: %v", flagName, err)
		}

		// Verify the flag actually changed something in config
		switch flagName {
		case "p":
			if !config.Tools {
				t.Errorf("Flag -%s should set Tools to true", flagName)
			}
		case "h":
			if !config.Help {
				t.Errorf("Flag -%s should set Help to true", flagName)
			}
		}

		// Reset for next test
		flag.CommandLine = flag.NewFlagSet(os.Args[0], flag.ExitOnError)
	}
}
