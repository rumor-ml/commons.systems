package print

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/commons-systems/filesync"
)

func TestPDFMetadataExtractor_Extract(t *testing.T) {
	// Note: This test requires actual PDF files to test properly.
	// For now, we test the error cases and CanExtract logic.

	// Test non-existent file
	e := NewPDFMetadataExtractor()
	ctx := context.Background()
	progress := make(chan filesync.Progress, 10)
	defer close(progress)

	file := filesync.FileInfo{
		Path:     "/nonexistent/file.pdf",
		MimeType: "application/pdf",
	}

	_, err := e.Extract(ctx, file, progress)
	if err == nil {
		t.Error("Expected error for non-existent file")
	}

	var extractionErr *filesync.ExtractionError
	if !filesync.IsError(err, &extractionErr) {
		t.Errorf("Expected ExtractionError, got %T", err)
	}
}

func TestPDFMetadataExtractor_CanExtract(t *testing.T) {
	e := NewPDFMetadataExtractor()

	tests := []struct {
		name string
		file filesync.FileInfo
		want bool
	}{
		{
			name: "PDF by extension",
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: true,
		},
		{
			name: "PDF by extension uppercase",
			file: filesync.FileInfo{Path: "/test/book.PDF"},
			want: true,
		},
		{
			name: "PDF by mime type",
			file: filesync.FileInfo{
				Path:     "/test/book",
				MimeType: "application/pdf",
			},
			want: true,
		},
		{
			name: "EPUB file",
			file: filesync.FileInfo{Path: "/test/book.epub"},
			want: false,
		},
		{
			name: "text file",
			file: filesync.FileInfo{Path: "/test/file.txt"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := e.CanExtract(tt.file); got != tt.want {
				t.Errorf("CanExtract() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestParseInfoDate(t *testing.T) {
	tests := []struct {
		name    string
		dateStr string
		wantErr bool
	}{
		{
			name:    "standard PDF date with timezone",
			dateStr: "D:20230115120000+00'00'",
			wantErr: false,
		},
		{
			name:    "PDF date without timezone",
			dateStr: "D:20230115120000",
			wantErr: false,
		},
		{
			name:    "PDF date short format",
			dateStr: "D:20230115",
			wantErr: false,
		},
		{
			name:    "without D: prefix",
			dateStr: "20230115120000",
			wantErr: false,
		},
		{
			name:    "invalid date format",
			dateStr: "invalid",
			wantErr: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := parseInfoDate(tt.dateStr)
			if (err != nil) != tt.wantErr {
				t.Errorf("parseInfoDate() error = %v, wantErr %v", err, tt.wantErr)
				return
			}
			if !tt.wantErr && got.IsZero() {
				t.Error("parseInfoDate() returned zero time for valid input")
			}
		})
	}
}

func TestPDFMetadataExtractor_ExtractionError(t *testing.T) {
	e := NewPDFMetadataExtractor()
	ctx := context.Background()
	progress := make(chan filesync.Progress, 10)
	defer close(progress)

	// Test with a non-PDF file
	tmpDir := t.TempDir()
	notPDFPath := filepath.Join(tmpDir, "notapdf.pdf")
	err := os.WriteFile(notPDFPath, []byte("This is not a PDF"), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	file := filesync.FileInfo{
		Path:     notPDFPath,
		MimeType: "application/pdf",
	}

	_, err = e.Extract(ctx, file, progress)
	if err == nil {
		t.Error("Expected error for non-PDF file")
	}

	var extractionErr *filesync.ExtractionError
	if !filesync.IsError(err, &extractionErr) {
		t.Errorf("Expected ExtractionError, got %T", err)
	}
}
