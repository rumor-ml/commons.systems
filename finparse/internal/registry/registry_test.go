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

	// Should have built-in parsers (OFX and CSV-PNC)
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 2 {
		t.Errorf("Expected 2 initial parsers (ofx, csv-pnc), got %d", len(initialParsers))
	}
	if initialParsers[0] != "ofx" {
		t.Errorf("Expected first parser 'ofx', got '%s'", initialParsers[0])
	}
	if initialParsers[1] != "csv-pnc" {
		t.Errorf("Expected second parser 'csv-pnc', got '%s'", initialParsers[1])
	}
}

func TestRegistry_MustNew(t *testing.T) {
	// Test that MustNew() returns a registry
	reg := MustNew()
	if reg == nil {
		t.Fatal("MustNew() returned nil registry")
	}

	// Should have built-in parsers (OFX and CSV-PNC)
	initialParsers := reg.ListParsers()
	if len(initialParsers) != 2 {
		t.Errorf("Expected 2 initial parsers (ofx, csv-pnc), got %d", len(initialParsers))
	}
	if initialParsers[0] != "ofx" {
		t.Errorf("Expected first parser 'ofx', got '%s'", initialParsers[0])
	}
	if initialParsers[1] != "csv-pnc" {
		t.Errorf("Expected second parser 'csv-pnc', got '%s'", initialParsers[1])
	}
}

func TestRegistry_Register(t *testing.T) {
	// Test registering custom parsers via constructor
	testParser := &mockParser{name: "test-parser", canParseFunc: nil}
	reg := MustNew(testParser)

	// Verify both built-in and custom parser are registered
	parsers := reg.ListParsers()
	if len(parsers) != 3 {
		t.Fatalf("Expected 3 parsers (ofx + csv-pnc + test-parser), got %d", len(parsers))
	}
	if parsers[0] != "ofx" {
		t.Errorf("Expected parser name 'ofx' at index 0, got '%s'", parsers[0])
	}
	if parsers[1] != "csv-pnc" {
		t.Errorf("Expected parser name 'csv-pnc' at index 1, got '%s'", parsers[1])
	}
	if parsers[2] != "test-parser" {
		t.Errorf("Expected parser name 'test-parser' at index 2, got '%s'", parsers[2])
	}

	// Register multiple parsers
	reg2 := MustNew(
		&mockParser{name: "parser-1", canParseFunc: nil},
		&mockParser{name: "parser-2", canParseFunc: nil},
		&mockParser{name: "parser-3", canParseFunc: nil},
	)

	parsers2 := reg2.ListParsers()
	if len(parsers2) != 5 {
		t.Errorf("Expected 5 parsers (ofx + csv-pnc + 3 custom), got %d", len(parsers2))
	}
}

func TestRegistry_Register_NilParser(t *testing.T) {
	// Test that nil parser in constructor returns error
	_, err := New(nil)
	if err == nil {
		t.Error("Expected error when registering nil parser")
	}
	if !strings.Contains(err.Error(), "cannot register nil parser") {
		t.Errorf("Expected 'cannot register nil parser' error, got: %v", err)
	}
}

func TestRegistry_Register_DuplicateName(t *testing.T) {
	// Test duplicate custom parser names
	parser1 := &mockParser{name: "test-parser", canParseFunc: nil}
	parser2 := &mockParser{name: "test-parser", canParseFunc: nil}

	_, err := New(parser1, parser2)
	if err == nil {
		t.Error("Expected error when registering duplicate parser name")
	}
	if !strings.Contains(err.Error(), "already registered") {
		t.Errorf("Expected 'already registered' error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "test-parser") {
		t.Errorf("Expected error to mention parser name 'test-parser', got: %v", err)
	}

	// Test duplicate with built-in parser name (OFX)
	ofxDuplicate := &mockParser{name: "ofx", canParseFunc: nil}
	_, err = New(ofxDuplicate)
	if err == nil {
		t.Error("Expected error when registering duplicate built-in parser name (ofx)")
	}
	if !strings.Contains(err.Error(), "already registered") {
		t.Errorf("Expected 'already registered' error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "ofx") {
		t.Errorf("Expected error to mention parser name 'ofx', got: %v", err)
	}

	// Test duplicate with built-in parser name (CSV-PNC)
	csvDuplicate := &mockParser{name: "csv-pnc", canParseFunc: nil}
	_, err = New(csvDuplicate)
	if err == nil {
		t.Error("Expected error when registering duplicate built-in parser name (csv-pnc)")
	}
	if !strings.Contains(err.Error(), "already registered") {
		t.Errorf("Expected 'already registered' error, got: %v", err)
	}
	if !strings.Contains(err.Error(), "csv-pnc") {
		t.Errorf("Expected error to mention parser name 'csv-pnc', got: %v", err)
	}
}

func TestRegistry_ListParsers(t *testing.T) {
	reg := MustNew()

	// Registry with built-in parsers
	parsers := reg.ListParsers()
	if parsers == nil {
		t.Error("ListParsers should return slice, not nil")
	}
	if len(parsers) != 2 {
		t.Errorf("Expected 2 built-in parsers (ofx, csv-pnc), got %d", len(parsers))
	}
	if parsers[0] != "ofx" {
		t.Errorf("Expected first parser to be 'ofx', got '%s'", parsers[0])
	}
	if parsers[1] != "csv-pnc" {
		t.Errorf("Expected second parser to be 'csv-pnc', got '%s'", parsers[1])
	}

	// Create registry with additional parsers
	reg2 := MustNew(
		&mockParser{name: "csv-amex", canParseFunc: nil},
		&mockParser{name: "csv-chase", canParseFunc: nil},
	)

	parsers2 := reg2.ListParsers()
	if len(parsers2) != 4 {
		t.Fatalf("Expected 4 parsers, got %d", len(parsers2))
	}

	// Verify order preserved (built-in first, then custom in order)
	expected := []string{"ofx", "csv-pnc", "csv-amex", "csv-chase"}
	for i, name := range expected {
		if parsers2[i] != name {
			t.Errorf("Parser %d: expected '%s', got '%s'", i, name, parsers2[i])
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

			// Create registry with custom parsers
			// Filter out mock parsers that conflict with built-in names
			customParsers := make([]parser.Parser, 0, len(tt.parsers))
			for _, p := range tt.parsers {
				// Skip mock parsers with built-in names (e.g., "ofx")
				// These tests expect the built-in parser behavior instead
				if p.Name() != "ofx" {
					customParsers = append(customParsers, p)
				}
			}
			reg := MustNew(customParsers...)

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
			reg := MustNew(&mockParser{
				name: "test",
				canParseFunc: func(path string, header []byte) bool {
					return true
				},
			})

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
			reg := MustNew(&mockParser{
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
	reg := MustNew(&mockParser{
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
	reg := MustNew(&mockParser{
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
	reg := MustNew(&mockParser{
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

func TestMustNew_PanicContext(t *testing.T) {
	tests := []struct {
		name          string
		parsers       []parser.Parser
		panicContains []string
	}{
		{
			name:    "nil custom parser",
			parsers: []parser.Parser{&mockParser{name: "test-parser"}, nil},
			panicContains: []string{
				"failed to register custom parser 2 of 2",
				"cannot register nil parser",
				"Successfully registered: ofx, csv-pnc, test-parser",
				"programmer error",
				"check your parser initialization",
			},
		},
		{
			name: "duplicate name",
			parsers: []parser.Parser{
				&mockParser{name: "test-parser"},
				&mockParser{name: "test-parser"},
			},
			panicContains: []string{
				"failed to register custom parser 2 of 2",
				"already registered",
				"Successfully registered: ofx, csv-pnc, test-parser",
				"programmer error",
				"check your parser initialization",
			},
		},
		{
			name:    "built-in conflict",
			parsers: []parser.Parser{&mockParser{name: "ofx"}},
			panicContains: []string{
				"failed to register custom parser 1 of 1",
				"already registered",
				"ofx",
				"Successfully registered: ofx, csv-pnc",
				"programmer error",
				"check your parser initialization",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defer func() {
				r := recover()
				if r == nil {
					t.Fatal("Expected panic, got none")
				}

				panicMsg, ok := r.(string)
				if !ok {
					t.Fatalf("Expected string panic, got %T: %v", r, r)
				}

				for _, expected := range tt.panicContains {
					if !strings.Contains(panicMsg, expected) {
						t.Errorf("Panic message missing %q: %s", expected, panicMsg)
					}
				}
			}()
			MustNew(tt.parsers...)
		})
	}
}

func TestMustNew_PanicMessageFormat(t *testing.T) {
	defer func() {
		r := recover()
		if r == nil {
			t.Fatal("Expected panic, got none")
		}

		panicMsg, ok := r.(string)
		if !ok {
			t.Fatalf("Expected string panic, got %T: %v", r, r)
		}

		assertions := []string{
			"failed to create parser registry:",
			"failed to register custom parser 1 of 1",
			"cannot register nil parser",
			"\n\n",
			"This is a programmer error - check your parser initialization.",
		}
		for _, expected := range assertions {
			if !strings.Contains(panicMsg, expected) {
				t.Errorf("Panic message missing %q\nFull message: %s", expected, panicMsg)
			}
		}

		// Verify order: registry error comes before programmer message
		registryIdx := strings.Index(panicMsg, "failed to create parser registry:")
		programmerIdx := strings.Index(panicMsg, "This is a programmer error")
		if registryIdx == -1 || programmerIdx == -1 || registryIdx >= programmerIdx {
			t.Errorf("Panic message has incorrect structure. Expected 'failed to create parser registry' before 'programmer error'.\nGot: %s", panicMsg)
		}
	}()

	MustNew(nil) // Should panic with well-structured message
}

func TestNew_EnhancedErrorContext(t *testing.T) {
	tests := []struct {
		name          string
		customParsers []parser.Parser
		errorContains []string
	}{
		{
			name:          "nil custom parser",
			customParsers: []parser.Parser{&mockParser{name: "valid"}, nil},
			errorContains: []string{
				"failed to register custom parser 2 of 2",
				"cannot register nil parser",
				"Successfully registered: ofx, csv-pnc, valid",
			},
		},
		{
			name: "duplicate name",
			customParsers: []parser.Parser{
				&mockParser{name: "dup"},
				&mockParser{name: "dup"},
			},
			errorContains: []string{
				"failed to register custom parser 2 of 2",
				"already registered",
				"Successfully registered: ofx, csv-pnc, dup",
			},
		},
		{
			name:          "first parser fails (1 of 1)",
			customParsers: []parser.Parser{nil},
			errorContains: []string{
				"failed to register custom parser 1 of 1",
				"cannot register nil parser",
				"Successfully registered: ofx, csv-pnc",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := New(tt.customParsers...)
			if err == nil {
				t.Fatal("Expected error, got nil")
			}

			errMsg := err.Error()
			for _, expected := range tt.errorContains {
				if !strings.Contains(errMsg, expected) {
					t.Errorf("Error missing %q: %s", expected, errMsg)
				}
			}
		})
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
