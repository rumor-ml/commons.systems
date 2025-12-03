package print

import (
	"archive/zip"
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/commons-systems/filesync"
)

// createTestEPUB creates a minimal valid EPUB file for testing
func createTestEPUB(t *testing.T, path string, metadata map[string]string) {
	t.Helper()

	// Create ZIP file
	zipFile, err := os.Create(path)
	if err != nil {
		t.Fatalf("Failed to create test EPUB: %v", err)
	}
	defer zipFile.Close()

	w := zip.NewWriter(zipFile)
	defer w.Close()

	// Add mimetype file
	mimeFile, err := w.Create("mimetype")
	if err != nil {
		t.Fatalf("Failed to create mimetype: %v", err)
	}
	mimeFile.Write([]byte("application/epub+zip"))

	// Add container.xml
	containerXML := `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`

	containerFile, err := w.Create("META-INF/container.xml")
	if err != nil {
		t.Fatalf("Failed to create container.xml: %v", err)
	}
	containerFile.Write([]byte(containerXML))

	// Build OPF XML with metadata
	opfXML := `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">`

	if title, ok := metadata["title"]; ok {
		opfXML += "\n    <dc:title>" + title + "</dc:title>"
	}
	if author, ok := metadata["author"]; ok {
		opfXML += "\n    <dc:creator>" + author + "</dc:creator>"
	}
	if publisher, ok := metadata["publisher"]; ok {
		opfXML += "\n    <dc:publisher>" + publisher + "</dc:publisher>"
	}
	if description, ok := metadata["description"]; ok {
		opfXML += "\n    <dc:description>" + description + "</dc:description>"
	}
	if subject, ok := metadata["subject"]; ok {
		opfXML += "\n    <dc:subject>" + subject + "</dc:subject>"
	}
	if isbn, ok := metadata["isbn"]; ok {
		opfXML += "\n    <dc:identifier scheme=\"ISBN\">" + isbn + "</dc:identifier>"
	}
	if series, ok := metadata["series"]; ok {
		opfXML += "\n    <meta name=\"calibre:series\" content=\"" + series + "\"/>"
	}
	if volume, ok := metadata["volume"]; ok {
		opfXML += "\n    <meta name=\"calibre:series_index\" content=\"" + volume + "\"/>"
	}

	opfXML += `
  </metadata>
  <manifest></manifest>
  <spine></spine>
</package>`

	opfFile, err := w.Create("content.opf")
	if err != nil {
		t.Fatalf("Failed to create content.opf: %v", err)
	}
	opfFile.Write([]byte(opfXML))
}

func TestEPUBMetadataExtractor_Extract(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name         string
		filename     string
		metadata     map[string]string
		wantTitle    string
		wantAuthor   string
		wantPublisher string
		wantSeries   string
		wantVolume   string
		wantISBN     string
		wantErr      bool
	}{
		{
			name:     "basic metadata",
			filename: "basic.epub",
			metadata: map[string]string{
				"title":  "Test Book",
				"author": "Test Author",
			},
			wantTitle:  "Test Book",
			wantAuthor: "Test Author",
			wantErr:    false,
		},
		{
			name:     "full metadata",
			filename: "full.epub",
			metadata: map[string]string{
				"title":       "Complete Book",
				"author":      "Full Author",
				"publisher":   "Test Publisher",
				"description": "A test description",
				"subject":     "Fiction",
				"isbn":        "9781234567890",
			},
			wantTitle:     "Complete Book",
			wantAuthor:    "Full Author",
			wantPublisher: "Test Publisher",
			wantISBN:      "9781234567890",
			wantErr:       false,
		},
		{
			name:     "series metadata",
			filename: "series.epub",
			metadata: map[string]string{
				"title":  "Series Book",
				"author": "Series Author",
				"series": "Test Series",
				"volume": "1",
			},
			wantTitle:  "Series Book",
			wantAuthor: "Series Author",
			wantSeries: "Test Series",
			wantVolume: "1",
			wantErr:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testPath := filepath.Join(tmpDir, tt.filename)
			createTestEPUB(t, testPath, tt.metadata)

			e := NewEPUBMetadataExtractor()
			ctx := context.Background()
			progress := make(chan filesync.Progress, 10)
			defer close(progress)

			file := filesync.FileInfo{
				Path:     testPath,
				MimeType: "application/epub+zip",
			}

			metadata, err := e.Extract(ctx, file, progress)

			if (err != nil) != tt.wantErr {
				t.Errorf("Extract() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				if metadata == nil {
					t.Fatal("Expected metadata, got nil")
				}

				if metadata.Title != tt.wantTitle {
					t.Errorf("Title = %v, want %v", metadata.Title, tt.wantTitle)
				}

				if tt.wantAuthor != "" {
					author, ok := metadata.Raw["author"].(string)
					if !ok || author != tt.wantAuthor {
						t.Errorf("Author = %v, want %v", author, tt.wantAuthor)
					}
				}

				if tt.wantPublisher != "" {
					publisher, ok := metadata.Raw["publisher"].(string)
					if !ok || publisher != tt.wantPublisher {
						t.Errorf("Publisher = %v, want %v", publisher, tt.wantPublisher)
					}
				}

				if tt.wantSeries != "" {
					series, ok := metadata.Raw["series"].(string)
					if !ok || series != tt.wantSeries {
						t.Errorf("Series = %v, want %v", series, tt.wantSeries)
					}
				}

				if tt.wantVolume != "" {
					volume, ok := metadata.Raw["volume"].(string)
					if !ok || volume != tt.wantVolume {
						t.Errorf("Volume = %v, want %v", volume, tt.wantVolume)
					}
				}

				if tt.wantISBN != "" {
					isbn, ok := metadata.Raw["isbn"].(string)
					if !ok || isbn != tt.wantISBN {
						t.Errorf("ISBN = %v, want %v", isbn, tt.wantISBN)
					}
				}
			}
		})
	}
}

func TestEPUBMetadataExtractor_CanExtract(t *testing.T) {
	e := NewEPUBMetadataExtractor()

	tests := []struct {
		name string
		file filesync.FileInfo
		want bool
	}{
		{
			name: "EPUB by extension",
			file: filesync.FileInfo{Path: "/test/book.epub"},
			want: true,
		},
		{
			name: "EPUB by extension uppercase",
			file: filesync.FileInfo{Path: "/test/book.EPUB"},
			want: true,
		},
		{
			name: "EPUB by mime type",
			file: filesync.FileInfo{
				Path:     "/test/book",
				MimeType: "application/epub+zip",
			},
			want: true,
		},
		{
			name: "PDF file",
			file: filesync.FileInfo{Path: "/test/book.pdf"},
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

func TestEPUBMetadataExtractor_InvalidFile(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		name     string
		filename string
		content  []byte
		wantErr  bool
	}{
		{
			name:     "non-existent file",
			filename: "nonexistent.epub",
			content:  nil,
			wantErr:  true,
		},
		{
			name:     "not a ZIP file",
			filename: "notzip.epub",
			content:  []byte("This is not a ZIP file"),
			wantErr:  true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var testPath string
			if tt.content != nil {
				testPath = filepath.Join(tmpDir, tt.filename)
				if err := os.WriteFile(testPath, tt.content, 0644); err != nil {
					t.Fatalf("Failed to create test file: %v", err)
				}
			} else {
				testPath = filepath.Join(tmpDir, tt.filename)
			}

			e := NewEPUBMetadataExtractor()
			ctx := context.Background()
			progress := make(chan filesync.Progress, 10)
			defer close(progress)

			file := filesync.FileInfo{
				Path:     testPath,
				MimeType: "application/epub+zip",
			}

			_, err := e.Extract(ctx, file, progress)

			if (err != nil) != tt.wantErr {
				t.Errorf("Extract() error = %v, wantErr %v", err, tt.wantErr)
			}

			if tt.wantErr && err != nil {
				var extractionErr *filesync.ExtractionError
				if !filesync.IsError(err, &extractionErr) {
					t.Errorf("Expected ExtractionError, got %T", err)
				}
			}
		})
	}
}

func TestEPUBMetadataExtractor_EmptyMetadata(t *testing.T) {
	tmpDir := t.TempDir()
	testPath := filepath.Join(tmpDir, "empty.epub")

	// Create EPUB with no metadata
	createTestEPUB(t, testPath, map[string]string{})

	e := NewEPUBMetadataExtractor()
	ctx := context.Background()
	progress := make(chan filesync.Progress, 10)
	defer close(progress)

	file := filesync.FileInfo{
		Path:     testPath,
		MimeType: "application/epub+zip",
	}

	metadata, err := e.Extract(ctx, file, progress)
	if err != nil {
		t.Errorf("Extract() unexpected error: %v", err)
	}

	if metadata == nil {
		t.Fatal("Expected metadata, got nil")
	}

	// Should have empty/default values
	if metadata.Title != "" {
		t.Errorf("Expected empty title, got %v", metadata.Title)
	}
}
