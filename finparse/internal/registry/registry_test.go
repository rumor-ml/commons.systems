package registry

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
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

func (m *mockParser) Parse(ctx context.Context, r io.Reader, meta *parser.Metadata) (*parser.RawStatement, error) {
	return nil, nil
}

func TestRegistry_New(t *testing.T) {
	// Test that New() returns a registry without error
	reg, err := New()
	if err != nil {
		t.Fatalf("New() returned unexpected error: %v", err)
	}
	if reg == nil {
		t.Fatal("New() returned nil registry")
	}

	// Should have built-in parsers (OFX)
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 1 {
		t.Errorf("Expected 1 initial parser (ofx), got %d", len(initialParsers))
	}
	if initialParsers[0] != "ofx" {
		t.Errorf("Expected initial parser 'ofx', got '%s'", initialParsers[0])
	}
}

func TestRegistry_MustNew(t *testing.T) {
	// Test that MustNew() returns a registry
	reg := MustNew()
	if reg == nil {
		t.Fatal("MustNew() returned nil registry")
	}

	// Should have built-in parsers (OFX)
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 1 {
		t.Errorf("Expected 1 initial parser (ofx), got %d", len(initialParsers))
	}
	if initialParsers[0] != "ofx" {
		t.Errorf("Expected initial parser 'ofx', got '%s'", initialParsers[0])
	}
}

func TestRegistry_Register(t *testing.T) {
	reg := MustNew()

	// Initially has built-in parsers (OFX)
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 1 {
		t.Errorf("Expected 1 initial parser (ofx), got %d", len(initialParsers))
	}
	if initialParsers[0] != "ofx" {
		t.Errorf("Expected initial parser 'ofx', got '%s'", initialParsers[0])
	}

	// Register custom parser
	testParser := &mockParser{name: "test-parser", canParseFunc: nil}
	if err := reg.Register(testParser); err != nil {
		t.Fatalf("Failed to register parser: %v", err)
	}

	// Verify parser is registered
	parsers := reg.ListParsers()
	if len(parsers) != 2 {
		t.Fatalf("Expected 2 parsers after registration, got %d", len(parsers))
	}
	if parsers[1] != "test-parser" {
		t.Errorf("Expected parser name 'test-parser' at index 1, got '%s'", parsers[1])
	}

	// Register multiple parsers
	if err := reg.Register(&mockParser{name: "parser-2", canParseFunc: nil}); err != nil {
		t.Fatalf("Failed to register parser-2: %v", err)
	}
	if err := reg.Register(&mockParser{name: "parser-3", canParseFunc: nil}); err != nil {
		t.Fatalf("Failed to register parser-3: %v", err)
	}

	parsers = reg.ListParsers()
	if len(parsers) != 4 {
		t.Errorf("Expected 4 parsers, got %d", len(parsers))
	}
}

func TestRegistry_Register_NilParser(t *testing.T) {
	reg := MustNew()
	err := reg.Register(nil)
	if err == nil {
		t.Error("Expected error when registering nil parser")
	}
	if !strings.Contains(err.Error(), "cannot register nil parser") {
		t.Errorf("Expected 'cannot register nil parser' error, got: %v", err)
	}
}

func TestRegistry_Register_DuplicateName(t *testing.T) {
	reg := MustNew()

	// Register first parser
	parser1 := &mockParser{name: "test-parser", canParseFunc: nil}
	if err := reg.Register(parser1); err != nil {
		t.Fatalf("Failed to register first parser: %v", err)
	}

	// Try to register second parser with same name
	parser2 := &mockParser{name: "test-parser", canParseFunc: nil}
	err := reg.Register(parser2)
	if err == nil {
		t.Error("Expected error when registering duplicate parser name")
	}
	if !strings.Contains(err.Error(), "already registered") {
		t.Errorf("Expected 'already registered' error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "test-parser") {
		t.Errorf("Expected error to mention parser name 'test-parser', got: %v", err)
	}

	// Verify correct number of parsers (1 built-in + 1 custom)
	parsers := reg.ListParsers()
	if len(parsers) != 2 {
		t.Errorf("Expected 2 parsers after duplicate rejection (ofx + test-parser), got %d", len(parsers))
	}
}

func TestRegistry_ListParsers(t *testing.T) {
	reg := MustNew()

	// Registry with built-in parsers
	parsers := reg.ListParsers()
	if parsers == nil {
		t.Error("ListParsers should return slice, not nil")
	}
	if len(parsers) != 1 {
		t.Errorf("Expected 1 built-in parser (ofx), got %d", len(parsers))
	}
	if parsers[0] != "ofx" {
		t.Errorf("Expected first parser to be 'ofx', got '%s'", parsers[0])
	}

	// Register additional parsers
	if err := reg.Register(&mockParser{name: "csv-pnc", canParseFunc: nil}); err != nil {
		t.Fatalf("Failed to register csv-pnc: %v", err)
	}
	if err := reg.Register(&mockParser{name: "csv-amex", canParseFunc: nil}); err != nil {
		t.Fatalf("Failed to register csv-amex: %v", err)
	}

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
		fileExt       string // Optional file extension (e.g., ".ofx"), defaults to ".txt"
		parsers       []*mockParser
		expectParser  string
		expectError   bool
		errorContains string
	}{
		{
			name:        "OFX file detected",
			fileContent: "OFXHEADER:100\nDATA:OFXSGML\n<OFX><SIGNONMSGSRSV1><SONRS><STATUS><CODE>0</STATUS></SONRS></SIGNONMSGSRSV1></OFX>",
			fileExt:     ".ofx",
			parsers: []*mockParser{
				{
					name: "csv",
					canParseFunc: func(path string, header []byte) bool {
						return false
					},
				},
			},
			expectParser: "ofx", // Should match built-in OFX parser
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
			// Create temp file with appropriate extension
			ext := tt.fileExt
			if ext == "" {
				ext = ".txt"
			}
			tmpFile := createTempFileWithExt(t, tt.fileContent, ext)
			defer os.Remove(tmpFile)

			// Create registry and register parsers
			reg := MustNew()
			for _, p := range tt.parsers {
				// Skip if parser name already exists (e.g., built-in "ofx" parser)
				// In real usage, custom parsers would use different names
				if err := reg.Register(p); err != nil {
					if !strings.Contains(err.Error(), "already registered") {
						t.Fatalf("Failed to register parser: %v", err)
					}
					// Skip duplicate parser name - test will use built-in parser instead
				}
			}

			// Find parser
			foundParser, err := reg.FindParser(tmpFile)

			// Check error expectation
			if tt.expectError {
				if err == nil {
					t.Fatal("Expected error, got nil")
				}
				if tt.errorContains != "" && !strings.Contains(err.Error(), tt.errorContains) {
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
			reg := MustNew()
			if err := reg.Register(&mockParser{
				name: "test",
				canParseFunc: func(path string, header []byte) bool {
					return true
				},
			}); err != nil {
				t.Fatalf("Failed to register parser: %v", err)
			}

			_, err := reg.FindParser(tt.filePath)
			if err == nil {
				t.Fatal("Expected error, got nil")
			}
			if !strings.Contains(err.Error(), tt.errorContains) {
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
			reg := MustNew()
			if err := reg.Register(&mockParser{
				name: "test",
				canParseFunc: func(path string, header []byte) bool {
					receivedHeaderLen = len(header)
					return true
				},
			}); err != nil {
				t.Fatalf("Failed to register parser: %v", err)
			}

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
	reg := MustNew()
	if err := reg.Register(&mockParser{
		name: "empty-handler",
		canParseFunc: func(path string, header []byte) bool {
			receivedHeaderLen = len(header)
			// Parser can choose to accept or reject empty files
			return len(header) == 0
		},
	}); err != nil {
		t.Fatalf("Failed to register parser: %v", err)
	}

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
	reg := MustNew()
	if err := reg.Register(&mockParser{
		name: "binary",
		canParseFunc: func(path string, header []byte) bool {
			receivedHeader = make([]byte, len(header))
			copy(receivedHeader, header)
			return header[0] == 0x00 && header[1] == 0xFF
		},
	}); err != nil {
		t.Fatalf("Failed to register parser: %v", err)
	}

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
	reg := MustNew()
	if err := reg.Register(&mockParser{
		name: "path-checker",
		canParseFunc: func(path string, header []byte) bool {
			receivedPath = path
			return true
		},
	}); err != nil {
		t.Fatalf("Failed to register parser: %v", err)
	}

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
	return createTempFileWithExt(t, content, ".txt")
}

func createTempFileWithExt(t *testing.T, content string, ext string) string {
	t.Helper()
	tmpDir := t.TempDir()
	tmpFile := filepath.Join(tmpDir, "test-file"+ext)
	if err := os.WriteFile(tmpFile, []byte(content), 0600); err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	return tmpFile
}
