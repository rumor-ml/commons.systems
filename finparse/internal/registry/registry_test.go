package registry

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"

	"github.com/rumor-ml/commons.systems/finparse/internal/parser"
)

// mockParser implements parser.Parser for testing
type mockParser struct {
	name         string
	canParseFunc func(string, []byte) bool
}

func (m *mockParser) Name() string {
	return m.name
}

func (m *mockParser) CanParse(path string, header []byte) bool {
	if m.canParseFunc != nil {
		return m.canParseFunc(path, header)
	}
	return false
}

func (m *mockParser) Parse(ctx context.Context, r io.Reader, meta parser.Metadata) (*parser.RawStatement, error) {
	return nil, nil
}

func TestRegistry_Register(t *testing.T) {
	reg := New()

	// Initially no parsers (all commented out in New())
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 0 {
		t.Errorf("Expected 0 initial parsers, got %d", len(initialParsers))
	}

	// Register custom parser
	testParser := &mockParser{name: "test-parser", canParseFunc: nil}
	reg.Register(testParser)

	// Verify parser is registered
	parsers := reg.ListParsers()
	if len(parsers) != 1 {
		t.Fatalf("Expected 1 parser after registration, got %d", len(parsers))
	}
	if parsers[0] != "test-parser" {
		t.Errorf("Expected parser name 'test-parser', got '%s'", parsers[0])
	}

	// Register multiple parsers
	reg.Register(&mockParser{name: "parser-2", canParseFunc: nil})
	reg.Register(&mockParser{name: "parser-3", canParseFunc: nil})

	parsers = reg.ListParsers()
	if len(parsers) != 3 {
		t.Errorf("Expected 3 parsers, got %d", len(parsers))
	}
}

func TestRegistry_ListParsers(t *testing.T) {
	reg := New()

	// Empty registry
	parsers := reg.ListParsers()
	if parsers == nil {
		t.Error("ListParsers should return empty slice, not nil")
	}
	if len(parsers) != 0 {
		t.Errorf("Expected 0 parsers, got %d", len(parsers))
	}

	// Multiple parsers
	reg.Register(&mockParser{name: "ofx", canParseFunc: nil})
	reg.Register(&mockParser{name: "csv-pnc", canParseFunc: nil})
	reg.Register(&mockParser{name: "csv-amex", canParseFunc: nil})

	parsers = reg.ListParsers()
	if len(parsers) != 3 {
		t.Fatalf("Expected 3 parsers, got %d", len(parsers))
	}

	// Verify order preserved
	expected := []string{"ofx", "csv-pnc", "csv-amex"}
	for i, name := range expected {
		if parsers[i] != name {
			t.Errorf("Parser %d: expected '%s', got '%s'", i, name, parsers[i])
		}
	}
}

func TestRegistry_FindParser(t *testing.T) {
	tests := []struct {
		name          string
		fileContent   string
		parsers       []*mockParser
		expectParser  string
		expectError   bool
		errorContains string
	}{
		{
			name:        "OFX file detected",
			fileContent: "<OFX><SIGNONMSGSRSV1>",
			parsers: []*mockParser{
				{
					name: "ofx",
					canParseFunc: func(path string, header []byte) bool {
						return len(header) > 0 && header[0] == '<'
					},
				},
				{
					name: "csv",
					canParseFunc: func(path string, header []byte) bool {
						return false
					},
				},
			},
			expectParser: "ofx",
			expectError:  false,
		},
		{
			name:        "CSV file detected",
			fileContent: "Date,Description,Amount\n2024-01-01,Test,100.00",
			parsers: []*mockParser{
				{
					name: "ofx",
					canParseFunc: func(path string, header []byte) bool {
						return len(header) > 0 && header[0] == '<'
					},
				},
				{
					name: "csv",
					canParseFunc: func(path string, header []byte) bool {
						return len(header) > 0 && header[0] != '<'
					},
				},
			},
			expectParser: "csv",
			expectError:  false,
		},
		{
			name:        "No parser matches",
			fileContent: "Some unknown format",
			parsers: []*mockParser{
				{
					name: "ofx",
					canParseFunc: func(path string, header []byte) bool {
						return false
					},
				},
			},
			expectParser:  "",
			expectError:   true,
			errorContains: "no parser found",
		},
		{
			name:        "First matching parser wins",
			fileContent: "Test content",
			parsers: []*mockParser{
				{
					name: "parser-1",
					canParseFunc: func(path string, header []byte) bool {
						return true
					},
				},
				{
					name: "parser-2",
					canParseFunc: func(path string, header []byte) bool {
						return true
					},
				},
			},
			expectParser: "parser-1",
			expectError:  false,
		},
		{
			name:        "Empty file handled",
			fileContent: "",
			parsers: []*mockParser{
				{
					name: "parser",
					canParseFunc: func(path string, header []byte) bool {
						return len(header) == 0
					},
				},
			},
			expectParser: "parser",
			expectError:  false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create temp file
			tmpFile := createTempFile(t, tt.fileContent)
			defer os.Remove(tmpFile)

			// Create registry and register parsers
			reg := New()
			for _, p := range tt.parsers {
				reg.Register(p)
			}

			// Find parser
			foundParser, err := reg.FindParser(tmpFile)

			// Check error expectation
			if tt.expectError {
				if err == nil {
					t.Fatal("Expected error, got nil")
				}
				if tt.errorContains != "" && !contains(err.Error(), tt.errorContains) {
					t.Errorf("Expected error containing '%s', got '%s'", tt.errorContains, err.Error())
				}
				return
			}

			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if foundParser.Name() != tt.expectParser {
				t.Errorf("Expected parser '%s', got '%s'", tt.expectParser, foundParser.Name())
			}
		})
	}
}

func TestRegistry_FindParser_FileErrors(t *testing.T) {
	tests := []struct {
		name          string
		filePath      string
		errorContains string
	}{
		{
			name:          "Missing file",
			filePath:      "/nonexistent/file.ofx",
			errorContains: "failed to open file",
		},
		{
			name:          "Directory instead of file",
			filePath:      os.TempDir(),
			errorContains: "failed to read header",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			reg := New()
			reg.Register(&mockParser{
				name: "test",
				canParseFunc: func(path string, header []byte) bool {
					return true
				},
			})

			_, err := reg.FindParser(tt.filePath)
			if err == nil {
				t.Fatal("Expected error, got nil")
			}
			if !contains(err.Error(), tt.errorContains) {
				t.Errorf("Expected error containing '%s', got '%s'", tt.errorContains, err.Error())
			}
		})
	}
}

func TestRegistry_FindParser_HeaderReading(t *testing.T) {
	tests := []struct {
		name        string
		fileSize    int
		expectRead  int
		description string
	}{
		{
			name:        "Small file (< 512 bytes)",
			fileSize:    100,
			expectRead:  100,
			description: "Should read all available bytes",
		},
		{
			name:        "Large file (> 512 bytes)",
			fileSize:    1024,
			expectRead:  512,
			description: "Should read exactly 512 bytes",
		},
		{
			name:        "Exactly 512 bytes",
			fileSize:    512,
			expectRead:  512,
			description: "Should read all 512 bytes",
		},
		{
			name:        "1 byte file",
			fileSize:    1,
			expectRead:  1,
			description: "Should read single byte",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Create file with specific size
			content := make([]byte, tt.fileSize)
			for i := range content {
				content[i] = byte('A' + (i % 26))
			}
			tmpFile := createTempFile(t, string(content))
			defer os.Remove(tmpFile)

			// Track what header size the parser receives
			var receivedHeaderLen int
			reg := New()
			reg.Register(&mockParser{
				name: "test",
				canParseFunc: func(path string, header []byte) bool {
					receivedHeaderLen = len(header)
					return true
				},
			})

			_, err := reg.FindParser(tmpFile)
			if err != nil {
				t.Fatalf("Unexpected error: %v", err)
			}

			if receivedHeaderLen != tt.expectRead {
				t.Errorf("Expected header length %d, got %d", tt.expectRead, receivedHeaderLen)
			}
		})
	}
}

func TestRegistry_FindParser_EmptyFile(t *testing.T) {
	// Test that empty files are handled correctly (not an error)
	tmpFile := createTempFile(t, "")
	defer os.Remove(tmpFile)

	var receivedHeaderLen int
	reg := New()
	reg.Register(&mockParser{
		name: "empty-handler",
		canParseFunc: func(path string, header []byte) bool {
			receivedHeaderLen = len(header)
			// Parser can choose to accept or reject empty files
			return len(header) == 0
		},
	})

	foundParser, err := reg.FindParser(tmpFile)
	if err != nil {
		t.Fatalf("Unexpected error for empty file: %v", err)
	}

	if foundParser.Name() != "empty-handler" {
		t.Errorf("Expected 'empty-handler' parser, got '%s'", foundParser.Name())
	}

	if receivedHeaderLen != 0 {
		t.Errorf("Expected header length 0 for empty file, got %d", receivedHeaderLen)
	}
}

func TestRegistry_FindParser_BinaryFiles(t *testing.T) {
	// Test with binary data including null bytes
	binaryContent := []byte{0x00, 0xFF, 0x00, 0xAB, 0xCD, 'T', 'e', 's', 't'}
	tmpFile := createTempFile(t, string(binaryContent))
	defer os.Remove(tmpFile)

	var receivedHeader []byte
	reg := New()
	reg.Register(&mockParser{
		name: "binary",
		canParseFunc: func(path string, header []byte) bool {
			receivedHeader = make([]byte, len(header))
			copy(receivedHeader, header)
			return header[0] == 0x00 && header[1] == 0xFF
		},
	})

	foundParser, err := reg.FindParser(tmpFile)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if foundParser.Name() != "binary" {
		t.Errorf("Expected 'binary' parser, got '%s'", foundParser.Name())
	}

	// Verify binary data preserved correctly
	if len(receivedHeader) != len(binaryContent) {
		t.Errorf("Expected header length %d, got %d", len(binaryContent), len(receivedHeader))
	}

	for i := 0; i < len(binaryContent) && i < len(receivedHeader); i++ {
		if receivedHeader[i] != binaryContent[i] {
			t.Errorf("Byte %d: expected 0x%02X, got 0x%02X", i, binaryContent[i], receivedHeader[i])
		}
	}
}

func TestRegistry_FindParser_PathPassed(t *testing.T) {
	// Verify that parser receives the correct file path
	tmpFile := createTempFile(t, "test content")
	defer os.Remove(tmpFile)

	var receivedPath string
	reg := New()
	reg.Register(&mockParser{
		name: "path-checker",
		canParseFunc: func(path string, header []byte) bool {
			receivedPath = path
			return true
		},
	})

	_, err := reg.FindParser(tmpFile)
	if err != nil {
		t.Fatalf("Unexpected error: %v", err)
	}

	if receivedPath != tmpFile {
		t.Errorf("Expected path '%s', got '%s'", tmpFile, receivedPath)
	}
}

// Helper functions

func createTempFile(t *testing.T, content string) string {
	t.Helper()
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test-file.txt")
	if err := os.WriteFile(tmpFile, []byte(content), 0600); err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	return tmpFile
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(substr) == 0 ||
		func() bool {
			for i := 0; i <= len(s)-len(substr); i++ {
				if s[i:i+len(substr)] == substr {
					return true
				}
			}
			return false
		}())
}
