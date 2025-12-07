package filesync

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestSanitizePath(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  string
	}{
		{
			name:  "forward slashes replaced with dashes",
			input: "path/to/file",
			want:  "path-to-file",
		},
		{
			name:  "backslashes replaced with dashes",
			input: "path\\to\\file",
			want:  "path-to-file",
		},
		{
			name:  "colons replaced with dashes",
			input: "file:name:here",
			want:  "file-name-here",
		},
		{
			name:  "pipes replaced with dashes",
			input: "file|name|here",
			want:  "file-name-here",
		},
		{
			name:  "wildcards removed",
			input: "file*.txt",
			want:  "file.txt",
		},
		{
			name:  "question marks removed",
			input: "file?.txt",
			want:  "file.txt",
		},
		{
			name:  "angle brackets removed",
			input: "file<name>here",
			want:  "filenamehere",
		},
		{
			name:  "double quotes replaced with single quotes",
			input: `file"name"here`,
			want:  "file'name'here",
		},
		{
			name:  "leading and trailing whitespace trimmed",
			input: "  filename  ",
			want:  "filename",
		},
		{
			name:  "multiple spaces collapsed to single space",
			input: "file    name    here",
			want:  "file name here",
		},
		{
			name:  "complex combination of special characters",
			input: `  file/name\with:many|special*chars?<>"test"  `,
			want:  "file-name-with-many-specialchars'test'",
		},
		{
			name:  "empty string",
			input: "",
			want:  "",
		},
		{
			name:  "only whitespace",
			input: "   ",
			want:  "",
		},
		{
			name:  "unicode characters preserved",
			input: "文件名.txt",
			want:  "文件名.txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SanitizePath(tt.input)
			if got != tt.want {
				t.Errorf("SanitizePath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestSanitizeFilename(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		maxLength int
		want      string
	}{
		{
			name:      "no truncation needed",
			input:     "file.txt",
			maxLength: 20,
			want:      "file.txt",
		},
		{
			name:      "truncate name preserving extension",
			input:     "verylongfilename.txt",
			maxLength: 15,
			want:      "verylongfil.txt",
		},
		{
			name:      "maxLength zero returns original",
			input:     "file.txt",
			maxLength: 0,
			want:      "file.txt",
		},
		{
			name:      "maxLength negative returns original",
			input:     "file.txt",
			maxLength: -1,
			want:      "file.txt",
		},
		{
			name:      "extension longer than maxLength",
			input:     "file.verylongextension",
			maxLength: 10,
			want:      "file.veryl",
		},
		{
			name:      "sanitize and truncate",
			input:     "file/with\\invalid:chars.txt",
			maxLength: 15,
			want:      "file-with-i.txt",
		},
		{
			name:      "no extension",
			input:     "verylongfilename",
			maxLength: 10,
			want:      "verylongfi",
		},
		{
			name:      "exactly at maxLength",
			input:     "file12.txt",
			maxLength: 10,
			want:      "file12.txt",
		},
		{
			name:      "multiple extensions",
			input:     "archive.tar.gz",
			maxLength: 10,
			want:      "archive.gz",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SanitizeFilename(tt.input, tt.maxLength)
			if got != tt.want {
				t.Errorf("SanitizeFilename(%q, %d) = %q, want %q", tt.input, tt.maxLength, got, tt.want)
			}
			if len(got) > tt.maxLength && tt.maxLength > 0 {
				t.Errorf("SanitizeFilename(%q, %d) = %q (length %d), exceeds maxLength", tt.input, tt.maxLength, got, len(got))
			}
		})
	}
}

func TestValidateGCSPath(t *testing.T) {
	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{
			name:    "valid simple path",
			path:    "path/to/file.txt",
			wantErr: false,
		},
		{
			name:    "valid path with unicode",
			path:    "path/to/文件.txt",
			wantErr: false,
		},
		{
			name:    "empty path",
			path:    "",
			wantErr: true,
		},
		{
			name:    "path with carriage return",
			path:    "path/to\rfile.txt",
			wantErr: true,
		},
		{
			name:    "path with line feed",
			path:    "path/to\nfile.txt",
			wantErr: true,
		},
		{
			name:    "path with both CR and LF",
			path:    "path/to\r\nfile.txt",
			wantErr: true,
		},
		{
			name:    "path starting with well-known ACME challenge",
			path:    ".well-known/acme-challenge/token",
			wantErr: true,
		},
		{
			name:    "path exceeding 1024 bytes",
			path:    strings.Repeat("a", 1025),
			wantErr: true,
		},
		{
			name:    "path exactly 1024 bytes",
			path:    strings.Repeat("a", 1024),
			wantErr: false,
		},
		{
			name:    "valid path with special characters",
			path:    "path/to/file-name_123.txt",
			wantErr: false,
		},
		{
			name:    "path with well-known but not ACME challenge",
			path:    ".well-known/other/file.txt",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateGCSPath(tt.path)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateGCSPath(%q) error = %v, wantErr %v", tt.path, err, tt.wantErr)
			}
			if err != nil && !errors.Is(err, ErrInvalidGCSPath) {
				t.Errorf("ValidateGCSPath(%q) error should wrap ErrInvalidGCSPath, got %v", tt.path, err)
			}
		})
	}
}

func TestPathTemplate_Placeholders(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		want    []string
	}{
		{
			name:    "single placeholder",
			pattern: "path/{name}/file.txt",
			want:    []string{"name"},
		},
		{
			name:    "multiple placeholders",
			pattern: "path/{author}/{title}.{ext}",
			want:    []string{"author", "title", "ext"},
		},
		{
			name:    "duplicate placeholders",
			pattern: "path/{name}/file_{name}.txt",
			want:    []string{"name"},
		},
		{
			name:    "no placeholders",
			pattern: "path/to/file.txt",
			want:    []string{},
		},
		{
			name:    "placeholder at start",
			pattern: "{root}/path/file.txt",
			want:    []string{"root"},
		},
		{
			name:    "placeholder at end",
			pattern: "path/to/{filename}",
			want:    []string{"filename"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpl := NewPathTemplate(tt.pattern)
			got := tmpl.Placeholders()

			if len(got) != len(tt.want) {
				t.Errorf("Placeholders() returned %d items, want %d: got %v, want %v", len(got), len(tt.want), got, tt.want)
				return
			}

			// Convert to map for easier comparison (order doesn't matter for unique placeholders)
			gotMap := make(map[string]bool)
			for _, p := range got {
				gotMap[p] = true
			}

			for _, w := range tt.want {
				if !gotMap[w] {
					t.Errorf("Placeholders() missing %q, got %v, want %v", w, got, tt.want)
				}
			}
		})
	}
}

func TestPathTemplate_Execute(t *testing.T) {
	tests := []struct {
		name    string
		pattern string
		opts    []PathTemplateOption
		values  map[string]string
		want    string
		wantErr bool
	}{
		{
			name:    "simple substitution",
			pattern: "path/{name}/file.txt",
			values:  map[string]string{"name": "test"},
			want:    "path/test/file.txt",
			wantErr: false,
		},
		{
			name:    "multiple placeholders",
			pattern: "print/books/{Author}/{Title}.{ext}",
			values: map[string]string{
				"Author": "Tolkien",
				"Title":  "The Hobbit",
				"ext":    "epub",
			},
			want:    "print/books/Tolkien/The Hobbit.epub",
			wantErr: false,
		},
		{
			name:    "missing placeholder without default",
			pattern: "path/{name}/file.txt",
			values:  map[string]string{},
			wantErr: true,
		},
		{
			name:    "missing placeholder with default",
			pattern: "path/{name}/file.txt",
			opts:    []PathTemplateOption{WithDefault("name", "default")},
			values:  map[string]string{},
			want:    "path/default/file.txt",
			wantErr: false,
		},
		{
			name:    "value overrides default",
			pattern: "path/{name}/file.txt",
			opts:    []PathTemplateOption{WithDefault("name", "default")},
			values:  map[string]string{"name": "custom"},
			want:    "path/custom/file.txt",
			wantErr: false,
		},
		{
			name:    "custom sanitizer",
			pattern: "path/{name}/file.txt",
			opts: []PathTemplateOption{
				WithSanitizer("name", strings.ToUpper),
			},
			values:  map[string]string{"name": "test"},
			want:    "path/TEST/file.txt",
			wantErr: false,
		},
		{
			name:    "sanitizer with special characters",
			pattern: "path/{name}/file.txt",
			opts: []PathTemplateOption{
				WithSanitizer("name", SanitizePath),
			},
			values:  map[string]string{"name": "file/with\\slashes"},
			want:    "path/file-with-slashes/file.txt",
			wantErr: false,
		},
		{
			name:    "duplicate placeholders same value",
			pattern: "path/{name}/file_{name}.txt",
			values:  map[string]string{"name": "test"},
			want:    "path/test/file_test.txt",
			wantErr: false,
		},
		{
			name:    "no placeholders",
			pattern: "path/to/file.txt",
			values:  map[string]string{},
			want:    "path/to/file.txt",
			wantErr: false,
		},
		{
			name:    "empty value allowed",
			pattern: "path/{name}/file.txt",
			values:  map[string]string{"name": ""},
			want:    "path//file.txt",
			wantErr: false,
		},
		{
			name:    "multiple options",
			pattern: "path/{author}/{title}.txt",
			opts: []PathTemplateOption{
				WithDefault("author", "Unknown"),
				WithDefault("title", "Untitled"),
				WithSanitizer("author", SanitizePath),
				WithSanitizer("title", SanitizePath),
			},
			values: map[string]string{
				"title": "Book:Title",
			},
			want:    "path/Unknown/Book-Title.txt",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			tmpl := NewPathTemplate(tt.pattern, tt.opts...)
			got, err := tmpl.Execute(tt.values)

			if (err != nil) != tt.wantErr {
				t.Errorf("Execute() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if err != nil && !errors.Is(err, ErrMissingPlaceholder) {
				t.Errorf("Execute() error should wrap ErrMissingPlaceholder, got %v", err)
			}

			if !tt.wantErr && got != tt.want {
				t.Errorf("Execute() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCollisionResolver_Resolve(t *testing.T) {
	tests := []struct {
		name          string
		basePath      string
		existingPaths map[string]bool
		want          string
		wantErr       bool
	}{
		{
			name:          "no collision",
			basePath:      "file.txt",
			existingPaths: map[string]bool{},
			want:          "file.txt",
			wantErr:       false,
		},
		{
			name:     "collision - adds suffix _1",
			basePath: "file.txt",
			existingPaths: map[string]bool{
				"file.txt": true,
			},
			want:    "file_1.txt",
			wantErr: false,
		},
		{
			name:     "multiple collisions - adds suffix _3",
			basePath: "file.txt",
			existingPaths: map[string]bool{
				"file.txt":   true,
				"file_1.txt": true,
				"file_2.txt": true,
			},
			want:    "file_3.txt",
			wantErr: false,
		},
		{
			name:     "no extension",
			basePath: "filename",
			existingPaths: map[string]bool{
				"filename": true,
			},
			want:    "filename_1",
			wantErr: false,
		},
		{
			name:     "path with directory",
			basePath: "path/to/file.txt",
			existingPaths: map[string]bool{
				"path/to/file.txt": true,
			},
			want:    "path/to/file_1.txt",
			wantErr: false,
		},
		{
			name:     "multiple extensions",
			basePath: "archive.tar.gz",
			existingPaths: map[string]bool{
				"archive.tar.gz": true,
			},
			want:    "archive.tar_1.gz",
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			checkExists := func(ctx context.Context, path string) (bool, error) {
				return tt.existingPaths[path], nil
			}

			resolver := NewCollisionResolver(checkExists)
			got, err := resolver.Resolve(context.Background(), tt.basePath)

			if (err != nil) != tt.wantErr {
				t.Errorf("Resolve() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr && got != tt.want {
				t.Errorf("Resolve() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestCollisionResolver_WithSeparator(t *testing.T) {
	checkExists := func(ctx context.Context, path string) (bool, error) {
		return path == "file.txt", nil
	}

	resolver := NewCollisionResolver(checkExists).WithSeparator("-")
	got, err := resolver.Resolve(context.Background(), "file.txt")

	if err != nil {
		t.Errorf("Resolve() unexpected error: %v", err)
		return
	}

	want := "file-1.txt"
	if got != want {
		t.Errorf("Resolve() with custom separator = %q, want %q", got, want)
	}
}

func TestCollisionResolver_MaxAttemptsExceeded(t *testing.T) {
	// All paths exist
	checkExists := func(ctx context.Context, path string) (bool, error) {
		return true, nil
	}

	resolver := NewCollisionResolver(checkExists).WithMaxAttempts(5)
	_, err := resolver.Resolve(context.Background(), "file.txt")

	if err == nil {
		t.Error("Resolve() expected error when max attempts exceeded, got nil")
		return
	}

	if !errors.Is(err, ErrMaxCollisionAttempts) {
		t.Errorf("Resolve() error should wrap ErrMaxCollisionAttempts, got %v", err)
	}
}

func TestCollisionResolver_CheckExistsError(t *testing.T) {
	expectedErr := errors.New("storage error")
	checkExists := func(ctx context.Context, path string) (bool, error) {
		return false, expectedErr
	}

	resolver := NewCollisionResolver(checkExists)
	_, err := resolver.Resolve(context.Background(), "file.txt")

	if err == nil {
		t.Error("Resolve() expected error when checkExists fails, got nil")
		return
	}

	if !errors.Is(err, expectedErr) {
		t.Errorf("Resolve() error should wrap storage error, got %v", err)
	}
}

func TestCollisionResolver_ContextCancellation(t *testing.T) {
	checkExists := func(ctx context.Context, path string) (bool, error) {
		// Check if context is cancelled
		if ctx.Err() != nil {
			return false, ctx.Err()
		}
		return false, nil
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	resolver := NewCollisionResolver(checkExists)
	_, err := resolver.Resolve(ctx, "file.txt")

	if err == nil {
		t.Error("Resolve() expected error when context cancelled, got nil")
		return
	}

	if !errors.Is(err, context.Canceled) {
		t.Errorf("Resolve() error should wrap context.Canceled, got %v", err)
	}
}
