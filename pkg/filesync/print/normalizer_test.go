package print

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/commons-systems/filesync"
)

func TestNewPathNormalizer(t *testing.T) {
	n := NewPathNormalizer()
	if n == nil {
		t.Fatal("NewPathNormalizer returned nil")
	}
	if n.bookTemplate == nil {
		t.Error("bookTemplate is nil")
	}
	if n.comicTemplate == nil {
		t.Error("comicTemplate is nil")
	}
	if n.unsortTemplate == nil {
		t.Error("unsortTemplate is nil")
	}
}

func TestNewPathNormalizerWithCollisionResolver(t *testing.T) {
	checkExists := func(ctx context.Context, path string) (bool, error) {
		return false, nil
	}
	resolver := filesync.NewCollisionResolver(checkExists)

	n := NewPathNormalizer(WithCollisionResolver(resolver))
	if n.resolver == nil {
		t.Error("resolver was not set")
	}
}

func TestDetectContentType(t *testing.T) {
	tests := []struct {
		name        string
		file        filesync.FileInfo
		metadata    *filesync.ExtractedMetadata
		wantType    ContentType
		description string
	}{
		{
			name: "comic by cbz extension",
			file: filesync.FileInfo{
				Path: "/path/to/comic.cbz",
			},
			metadata:    nil,
			wantType:    ContentTypeComic,
			description: "Should detect comic from .cbz extension",
		},
		{
			name: "comic by cbr extension",
			file: filesync.FileInfo{
				Path: "/path/to/comic.cbr",
			},
			metadata:    nil,
			wantType:    ContentTypeComic,
			description: "Should detect comic from .cbr extension",
		},
		{
			name: "comic by series metadata",
			file: filesync.FileInfo{
				Path: "/path/to/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"series": "Batman",
				},
			},
			wantType:    ContentTypeComic,
			description: "Should detect comic from series metadata",
		},
		{
			name: "book with author and title",
			file: filesync.FileInfo{
				Path: "/path/to/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "The Great Book",
				Raw: map[string]interface{}{
					"author": "Jane Doe",
				},
			},
			wantType:    ContentTypeBook,
			description: "Should detect book with author and title",
		},
		{
			name: "book with title only - uses default author",
			file: filesync.FileInfo{
				Path: "/path/to/file.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Some Title",
				Raw:   map[string]interface{}{},
			},
			wantType:    ContentTypeBook,
			description: "Should be book with title, author defaults to Unknown Author",
		},
		{
			name: "not a book - missing title",
			file: filesync.FileInfo{
				Path: "/path/to/file.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"author": "Jane Doe",
				},
			},
			wantType:    ContentTypeUnknown,
			description: "Should be unknown without title",
		},
		{
			name: "unknown - no metadata",
			file: filesync.FileInfo{
				Path: "/path/to/file.pdf",
			},
			metadata:    nil,
			wantType:    ContentTypeUnknown,
			description: "Should be unknown with no metadata",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := detectContentType(tt.file, tt.metadata)
			if got != tt.wantType {
				t.Errorf("detectContentType() = %v, want %v: %s", got, tt.wantType, tt.description)
			}
		})
	}
}

func TestNormalize_Book(t *testing.T) {
	tests := []struct {
		name         string
		file         filesync.FileInfo
		metadata     *filesync.ExtractedMetadata
		wantPath     string
		wantDir      string
		wantFilename string
	}{
		{
			name: "book with full metadata",
			file: filesync.FileInfo{
				Path: "/source/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "The Great Gatsby",
				Raw: map[string]interface{}{
					"author": "F. Scott Fitzgerald",
				},
			},
			wantPath:     "print/books/F. Scott Fitzgerald/The Great Gatsby.pdf",
			wantDir:      "print/books/F. Scott Fitzgerald",
			wantFilename: "The Great Gatsby.pdf",
		},
		{
			name: "book with missing author - uses default",
			file: filesync.FileInfo{
				Path: "/source/book.epub",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Anonymous Book",
				Raw:   map[string]interface{}{},
			},
			wantPath:     "print/books/Unknown Author/Anonymous Book.epub",
			wantDir:      "print/books/Unknown Author",
			wantFilename: "Anonymous Book.epub",
		},
		{
			name: "book with special characters in metadata",
			file: filesync.FileInfo{
				Path: "/source/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Title: With/Chars\\And:More",
				Raw: map[string]interface{}{
					"author": "Author/Name\\With:Chars",
				},
			},
			wantPath:     "print/books/Author-Name-With-Chars/Title- With-Chars-And-More.pdf",
			wantDir:      "print/books/Author-Name-With-Chars",
			wantFilename: "Title- With-Chars-And-More.pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewPathNormalizer()
			got, err := n.Normalize(tt.file, tt.metadata)

			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}

			if got.GCSPath != tt.wantPath {
				t.Errorf("GCSPath = %q, want %q", got.GCSPath, tt.wantPath)
			}
			if got.Directory != tt.wantDir {
				t.Errorf("Directory = %q, want %q", got.Directory, tt.wantDir)
			}
			if got.Filename != tt.wantFilename {
				t.Errorf("Filename = %q, want %q", got.Filename, tt.wantFilename)
			}
			if got.Deduplication != false {
				t.Errorf("Deduplication = %v, want false", got.Deduplication)
			}
		})
	}
}

func TestNormalize_Comic(t *testing.T) {
	tests := []struct {
		name         string
		file         filesync.FileInfo
		metadata     *filesync.ExtractedMetadata
		wantPath     string
		wantDir      string
		wantFilename string
	}{
		{
			name: "comic with full metadata",
			file: filesync.FileInfo{
				Path: "/source/comic.cbz",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"publisher": "DC Comics",
					"series":    "Batman",
					"volume":    "Vol 1",
				},
			},
			wantPath:     "print/comics/DC Comics/Batman/Vol 1.cbz",
			wantDir:      "print/comics/DC Comics/Batman",
			wantFilename: "Vol 1.cbz",
		},
		{
			name: "comic with missing publisher - uses default",
			file: filesync.FileInfo{
				Path: "/source/comic.cbr",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"series": "Spider-Man",
					"volume": "Issue 1",
				},
			},
			wantPath:     "print/comics/Unknown Publisher/Spider-Man/Issue 1.cbr",
			wantDir:      "print/comics/Unknown Publisher/Spider-Man",
			wantFilename: "Issue 1.cbr",
		},
		{
			name: "comic with all defaults",
			file: filesync.FileInfo{
				Path: "/source/comic.cbz",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{},
			},
			wantPath:     "print/comics/Unknown Publisher/Unknown Series/Unknown Volume.cbz",
			wantDir:      "print/comics/Unknown Publisher/Unknown Series",
			wantFilename: "Unknown Volume.cbz",
		},
		{
			name: "comic with special characters",
			file: filesync.FileInfo{
				Path: "/source/comic.cbz",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"publisher": "Marvel/DC",
					"series":    "X-Men: First Class",
					"volume":    "Vol 1: Genesis",
				},
			},
			wantPath:     "print/comics/Marvel-DC/X-Men- First Class/Vol 1- Genesis.cbz",
			wantDir:      "print/comics/Marvel-DC/X-Men- First Class",
			wantFilename: "Vol 1- Genesis.cbz",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewPathNormalizer()
			got, err := n.Normalize(tt.file, tt.metadata)

			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}

			if got.GCSPath != tt.wantPath {
				t.Errorf("GCSPath = %q, want %q", got.GCSPath, tt.wantPath)
			}
			if got.Directory != tt.wantDir {
				t.Errorf("Directory = %q, want %q", got.Directory, tt.wantDir)
			}
			if got.Filename != tt.wantFilename {
				t.Errorf("Filename = %q, want %q", got.Filename, tt.wantFilename)
			}
		})
	}
}

func TestNormalize_Unsorted(t *testing.T) {
	tests := []struct {
		name         string
		file         filesync.FileInfo
		metadata     *filesync.ExtractedMetadata
		wantPath     string
		wantDir      string
		wantFilename string
	}{
		{
			name: "unknown file type",
			file: filesync.FileInfo{
				Path: "/source/document.txt",
			},
			metadata:     nil,
			wantPath:     "print/unsorted/document.txt",
			wantDir:      "print/unsorted",
			wantFilename: "document.txt",
		},
		{
			name: "pdf without metadata",
			file: filesync.FileInfo{
				Path: "/source/unknown.pdf",
			},
			metadata:     &filesync.ExtractedMetadata{},
			wantPath:     "print/unsorted/unknown.pdf",
			wantDir:      "print/unsorted",
			wantFilename: "unknown.pdf",
		},
		{
			name: "file with only author - no title",
			file: filesync.FileInfo{
				Path: "/source/incomplete.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{
					"author": "Some Author",
				},
			},
			wantPath:     "print/unsorted/incomplete.pdf",
			wantDir:      "print/unsorted",
			wantFilename: "incomplete.pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewPathNormalizer()
			got, err := n.Normalize(tt.file, tt.metadata)

			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}

			if got.GCSPath != tt.wantPath {
				t.Errorf("GCSPath = %q, want %q", got.GCSPath, tt.wantPath)
			}
			if got.Directory != tt.wantDir {
				t.Errorf("Directory = %q, want %q", got.Directory, tt.wantDir)
			}
			if got.Filename != tt.wantFilename {
				t.Errorf("Filename = %q, want %q", got.Filename, tt.wantFilename)
			}
		})
	}
}

func TestNormalize_SpecialCharacterSanitization(t *testing.T) {
	tests := []struct {
		name     string
		file     filesync.FileInfo
		metadata *filesync.ExtractedMetadata
		want     string
	}{
		{
			name: "sanitize slashes and colons",
			file: filesync.FileInfo{
				Path: "/source/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Title/With:Slashes",
				Raw: map[string]interface{}{
					"author": "Author\\Name",
				},
			},
			want: "print/books/Author-Name/Title-With-Slashes.pdf",
		},
		{
			name: "sanitize wildcards and quotes",
			file: filesync.FileInfo{
				Path: "/source/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Title*With?Wildcards",
				Raw: map[string]interface{}{
					"author": "Author \"Name\"",
				},
			},
			want: "print/books/Author 'Name'/TitleWithWildcards.pdf",
		},
		{
			name: "sanitize comparison operators",
			file: filesync.FileInfo{
				Path: "/source/book.pdf",
			},
			metadata: &filesync.ExtractedMetadata{
				Title: "Title<With>Brackets",
				Raw: map[string]interface{}{
					"author": "Author|Name",
				},
			},
			want: "print/books/Author-Name/TitleWithBrackets.pdf",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewPathNormalizer()
			got, err := n.Normalize(tt.file, tt.metadata)

			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}

			if got.GCSPath != tt.want {
				t.Errorf("GCSPath = %q, want %q", got.GCSPath, tt.want)
			}
		})
	}
}

func TestNormalize_PathValidation(t *testing.T) {
	t.Run("validates generated paths", func(t *testing.T) {
		n := NewPathNormalizer()

		file := filesync.FileInfo{
			Path: "/source/book.pdf",
		}
		metadata := &filesync.ExtractedMetadata{
			Title: "Valid Title",
			Raw: map[string]interface{}{
				"author": "Valid Author",
			},
		}

		got, err := n.Normalize(file, metadata)
		if err != nil {
			t.Fatalf("Normalize() error = %v", err)
		}

		// Verify the path passes GCS validation
		if err := filesync.ValidateGCSPath(got.GCSPath); err != nil {
			t.Errorf("Generated path failed validation: %v", err)
		}
	})
}

func TestNormalize_ExtensionHandling(t *testing.T) {
	tests := []struct {
		name     string
		filename string
		wantExt  string
	}{
		{
			name:     "pdf extension",
			filename: "book.pdf",
			wantExt:  ".pdf",
		},
		{
			name:     "epub extension",
			filename: "book.epub",
			wantExt:  ".epub",
		},
		{
			name:     "cbz extension",
			filename: "comic.cbz",
			wantExt:  ".cbz",
		},
		{
			name:     "no extension",
			filename: "book",
			wantExt:  ".unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			n := NewPathNormalizer()

			file := filesync.FileInfo{
				Path: filepath.Join("/source", tt.filename),
			}
			metadata := &filesync.ExtractedMetadata{
				Title: "Test Book",
				Raw: map[string]interface{}{
					"author": "Test Author",
				},
			}

			got, err := n.Normalize(file, metadata)
			if err != nil {
				t.Fatalf("Normalize() error = %v", err)
			}

			if !strings.HasSuffix(got.GCSPath, tt.wantExt) {
				t.Errorf("GCSPath %q does not end with %q", got.GCSPath, tt.wantExt)
			}
		})
	}
}
