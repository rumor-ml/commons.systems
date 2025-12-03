package filesync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestNewExtensionDiscoverer(t *testing.T) {
	tests := []struct {
		name string
		opts []DiscoveryOption
		want *ExtensionDiscoverer
	}{
		{
			name: "default options",
			opts: []DiscoveryOption{},
			want: &ExtensionDiscoverer{
				extensions:  []string{},
				skipHidden:  true,
				computeHash: true,
				bufferSize:  100,
			},
		},
		{
			name: "with extensions",
			opts: []DiscoveryOption{
				WithExtensions(".jpg", ".png", "gif"),
			},
			want: &ExtensionDiscoverer{
				extensions:  []string{".jpg", ".png", ".gif"},
				skipHidden:  true,
				computeHash: true,
				bufferSize:  100,
			},
		},
		{
			name: "skip hidden false",
			opts: []DiscoveryOption{
				WithSkipHidden(false),
			},
			want: &ExtensionDiscoverer{
				extensions:  []string{},
				skipHidden:  false,
				computeHash: true,
				bufferSize:  100,
			},
		},
		{
			name: "compute hash false",
			opts: []DiscoveryOption{
				WithComputeHash(false),
			},
			want: &ExtensionDiscoverer{
				extensions:  []string{},
				skipHidden:  true,
				computeHash: false,
				bufferSize:  100,
			},
		},
		{
			name: "custom buffer size",
			opts: []DiscoveryOption{
				WithBufferSize(50),
			},
			want: &ExtensionDiscoverer{
				extensions:  []string{},
				skipHidden:  true,
				computeHash: true,
				bufferSize:  50,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := NewExtensionDiscoverer(tt.opts...)

			if len(got.extensions) != len(tt.want.extensions) {
				t.Errorf("extensions length = %d, want %d", len(got.extensions), len(tt.want.extensions))
			}
			for i := range got.extensions {
				if got.extensions[i] != tt.want.extensions[i] {
					t.Errorf("extensions[%d] = %s, want %s", i, got.extensions[i], tt.want.extensions[i])
				}
			}

			if got.skipHidden != tt.want.skipHidden {
				t.Errorf("skipHidden = %v, want %v", got.skipHidden, tt.want.skipHidden)
			}
			if got.computeHash != tt.want.computeHash {
				t.Errorf("computeHash = %v, want %v", got.computeHash, tt.want.computeHash)
			}
			if got.bufferSize != tt.want.bufferSize {
				t.Errorf("bufferSize = %v, want %v", got.bufferSize, tt.want.bufferSize)
			}
		})
	}
}

func TestWithExtensions_Normalization(t *testing.T) {
	tests := []struct {
		name  string
		input []string
		want  []string
	}{
		{
			name:  "with dots",
			input: []string{".jpg", ".PNG", ".GIF"},
			want:  []string{".jpg", ".png", ".gif"},
		},
		{
			name:  "without dots",
			input: []string{"jpg", "PNG", "gif"},
			want:  []string{".jpg", ".png", ".gif"},
		},
		{
			name:  "mixed",
			input: []string{".jpg", "PNG", ".gif"},
			want:  []string{".jpg", ".png", ".gif"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := NewExtensionDiscoverer(WithExtensions(tt.input...))

			if len(d.extensions) != len(tt.want) {
				t.Errorf("extensions length = %d, want %d", len(d.extensions), len(tt.want))
			}
			for i := range d.extensions {
				if d.extensions[i] != tt.want[i] {
					t.Errorf("extensions[%d] = %s, want %s", i, d.extensions[i], tt.want[i])
				}
			}
		})
	}
}

func TestDiscover_BasicFunctionality(t *testing.T) {
	// Create test directory structure
	tmpDir := t.TempDir()

	// Create test files
	files := map[string]string{
		"test1.jpg": "image content",
		"test2.png": "another image",
		"test3.txt": "text file",
		"doc.pdf":   "pdf content",
	}

	for name, content := range files {
		path := filepath.Join(tmpDir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", name, err)
		}
	}

	// Test discovery with extension filter
	discoverer := NewExtensionDiscoverer(
		WithExtensions(".jpg", ".png"),
		WithComputeHash(true),
	)

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	// Collect results
	var discovered []FileInfo
	var errs []error

	for fileChan != nil || errChan != nil {
		select {
		case file, ok := <-fileChan:
			if !ok {
				fileChan = nil
				continue
			}
			discovered = append(discovered, file)
		case err, ok := <-errChan:
			if !ok {
				errChan = nil
				continue
			}
			errs = append(errs, err)
		}
	}

	// Verify no errors
	if len(errs) > 0 {
		t.Errorf("unexpected errors: %v", errs)
	}

	// Verify only .jpg and .png files were discovered
	if len(discovered) != 2 {
		t.Errorf("expected 2 files, got %d", len(discovered))
	}

	// Verify file properties
	for _, file := range discovered {
		ext := strings.ToLower(filepath.Ext(file.Path))
		if ext != ".jpg" && ext != ".png" {
			t.Errorf("unexpected file extension: %s", ext)
		}

		if file.Hash == "" {
			t.Error("expected hash to be computed")
		}

		if file.Size == 0 {
			t.Error("expected size to be greater than 0")
		}

		if file.RelativePath == "" {
			t.Error("expected relative path to be set")
		}

		if file.MimeType == "" {
			t.Error("expected mime type to be set")
		}
	}
}

func TestDiscover_HiddenFiles(t *testing.T) {
	tmpDir := t.TempDir()

	// Create visible and hidden files
	files := []string{
		"visible.txt",
		".hidden.txt",
	}

	for _, name := range files {
		path := filepath.Join(tmpDir, name)
		if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", name, err)
		}
	}

	t.Run("skip hidden", func(t *testing.T) {
		discoverer := NewExtensionDiscoverer(
			WithSkipHidden(true),
			WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		if len(discovered) != 1 {
			t.Errorf("expected 1 file, got %d", len(discovered))
		}

		if len(discovered) > 0 && strings.HasPrefix(filepath.Base(discovered[0].Path), ".") {
			t.Error("hidden file should be skipped")
		}
	})

	t.Run("include hidden", func(t *testing.T) {
		discoverer := NewExtensionDiscoverer(
			WithSkipHidden(false),
			WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		if len(discovered) != 2 {
			t.Errorf("expected 2 files, got %d", len(discovered))
		}
	})
}

func TestDiscover_HiddenDirectories(t *testing.T) {
	tmpDir := t.TempDir()

	// Create hidden directory with files
	hiddenDir := filepath.Join(tmpDir, ".hidden")
	if err := os.Mkdir(hiddenDir, 0755); err != nil {
		t.Fatalf("failed to create hidden directory: %v", err)
	}

	hiddenFile := filepath.Join(hiddenDir, "file.txt")
	if err := os.WriteFile(hiddenFile, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create file in hidden directory: %v", err)
	}

	// Create visible file
	visibleFile := filepath.Join(tmpDir, "visible.txt")
	if err := os.WriteFile(visibleFile, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create visible file: %v", err)
	}

	t.Run("skip hidden directories", func(t *testing.T) {
		discoverer := NewExtensionDiscoverer(
			WithSkipHidden(true),
			WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should only find the visible file
		if len(discovered) != 1 {
			t.Errorf("expected 1 file, got %d", len(discovered))
		}

		if len(discovered) > 0 && strings.Contains(discovered[0].Path, ".hidden") {
			t.Error("files in hidden directories should be skipped")
		}
	})
}

func TestDiscover_HashComputation(t *testing.T) {
	tmpDir := t.TempDir()

	content := []byte("test content for hashing")
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, content, 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Compute expected hash
	hasher := sha256.New()
	hasher.Write(content)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))

	t.Run("with hash computation", func(t *testing.T) {
		discoverer := NewExtensionDiscoverer(
			WithComputeHash(true),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var file FileInfo
		for f := range fileChan {
			file = f
		}

		// Drain error channel
		for range errChan {
		}

		if file.Hash != expectedHash {
			t.Errorf("hash = %s, want %s", file.Hash, expectedHash)
		}
	})

	t.Run("without hash computation", func(t *testing.T) {
		discoverer := NewExtensionDiscoverer(
			WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var file FileInfo
		for f := range fileChan {
			file = f
		}

		// Drain error channel
		for range errChan {
		}

		if file.Hash != "" {
			t.Errorf("hash should be empty, got %s", file.Hash)
		}
	})
}

func TestDiscover_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()

	// Create many files to ensure discovery takes some time
	for i := 0; i < 100; i++ {
		path := filepath.Join(tmpDir, fmt.Sprintf("file%03d.txt", i))
		if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
			t.Fatalf("failed to create test file: %v", err)
		}
	}

	discoverer := NewExtensionDiscoverer(
		WithComputeHash(true),
		WithBufferSize(1), // Small buffer to slow down
	)

	ctx, cancel := context.WithCancel(context.Background())
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	// Cancel immediately
	cancel()

	// Collect results
	var fileCount int
	var gotCancelError bool

	for fileChan != nil || errChan != nil {
		select {
		case _, ok := <-fileChan:
			if !ok {
				fileChan = nil
				continue
			}
			fileCount++
		case err, ok := <-errChan:
			if !ok {
				errChan = nil
				continue
			}
			if errors.Is(err, ErrCancelled) {
				gotCancelError = true
			}
		case <-time.After(5 * time.Second):
			t.Fatal("timeout waiting for channels to close")
		}
	}

	// Should get cancellation error
	if !gotCancelError {
		t.Error("expected cancellation error")
	}

	// Should process fewer than all files (but might get some before cancellation)
	if fileCount > 100 {
		t.Errorf("expected fewer than 100 files due to cancellation, got %d", fileCount)
	}
}

func TestDiscover_ChannelClosure(t *testing.T) {
	tmpDir := t.TempDir()

	// Create a test file
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	discoverer := NewExtensionDiscoverer(
		WithComputeHash(false),
	)

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	// Drain channels
	for fileChan != nil || errChan != nil {
		select {
		case _, ok := <-fileChan:
			if !ok {
				fileChan = nil
			}
		case _, ok := <-errChan:
			if !ok {
				errChan = nil
			}
		case <-time.After(5 * time.Second):
			t.Fatal("timeout: channels were not closed")
		}
	}

	// If we reach here, both channels were properly closed
}

func TestDiscover_ErrorWrapping(t *testing.T) {
	// Test with non-existent directory
	discoverer := NewExtensionDiscoverer()

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, "/nonexistent/directory")

	// Drain file channel
	for range fileChan {
	}

	// Check error channel
	var gotDiscoveryError bool
	for err := range errChan {
		if _, ok := err.(*DiscoveryError); ok {
			gotDiscoveryError = true
		}
	}

	if !gotDiscoveryError {
		t.Error("expected DiscoveryError")
	}
}

func TestDiscover_RelativePath(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested directory structure
	subDir := filepath.Join(tmpDir, "sub", "nested")
	if err := os.MkdirAll(subDir, 0755); err != nil {
		t.Fatalf("failed to create nested directory: %v", err)
	}

	testFile := filepath.Join(subDir, "test.txt")
	if err := os.WriteFile(testFile, []byte("content"), 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	discoverer := NewExtensionDiscoverer(
		WithComputeHash(false),
	)

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	var file FileInfo
	for f := range fileChan {
		file = f
	}

	// Drain error channel
	for range errChan {
	}

	expectedRelPath := filepath.Join("sub", "nested", "test.txt")
	if file.RelativePath != expectedRelPath {
		t.Errorf("RelativePath = %s, want %s", file.RelativePath, expectedRelPath)
	}
}

func TestDiscover_MimeType(t *testing.T) {
	tmpDir := t.TempDir()

	tests := []struct {
		filename         string
		expectedMimeType string
	}{
		{"test.jpg", "image/jpeg"},
		{"test.png", "image/png"},
		{"test.pdf", "application/pdf"},
		{"test.txt", "text/plain"}, // May include "; charset=utf-8"
		{"test.unknown", "application/octet-stream"},
	}

	for _, tt := range tests {
		path := filepath.Join(tmpDir, tt.filename)
		if err := os.WriteFile(path, []byte("content"), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", tt.filename, err)
		}
	}

	discoverer := NewExtensionDiscoverer(
		WithComputeHash(false),
	)

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	discovered := make(map[string]string) // filename -> mime type
	for file := range fileChan {
		filename := filepath.Base(file.Path)
		discovered[filename] = file.MimeType
	}

	// Drain error channel
	for range errChan {
	}

	for _, tt := range tests {
		if mime, ok := discovered[tt.filename]; ok {
			// MIME type may include charset for text files, so check prefix
			if !strings.HasPrefix(mime, tt.expectedMimeType) {
				t.Errorf("file %s: mime type = %s, want prefix %s", tt.filename, mime, tt.expectedMimeType)
			}
		}
	}
}

func TestDiscover_CustomFileFilter(t *testing.T) {
	tmpDir := t.TempDir()

	// Write different sized files
	if err := os.WriteFile(filepath.Join(tmpDir, "small.txt"), []byte("small"), 0644); err != nil {
		t.Fatalf("failed to create small file: %v", err)
	}
	if err := os.WriteFile(filepath.Join(tmpDir, "large.txt"), []byte("large content with more data"), 0644); err != nil {
		t.Fatalf("failed to create large file: %v", err)
	}

	// Filter to only include files larger than 10 bytes
	filter := func(path string, d fs.DirEntry) bool {
		info, err := d.Info()
		if err != nil {
			return false
		}
		return info.Size() > 10
	}

	discoverer := NewExtensionDiscoverer(
		WithFileFilter(filter),
		WithComputeHash(false),
	)

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	var discovered []FileInfo
	for file := range fileChan {
		discovered = append(discovered, file)
	}

	// Drain error channel
	for range errChan {
	}

	// Should only find large.txt
	if len(discovered) != 1 {
		t.Errorf("expected 1 file, got %d", len(discovered))
	}

	if len(discovered) > 0 {
		if !strings.Contains(discovered[0].Path, "large.txt") {
			t.Errorf("expected large.txt, got %s", discovered[0].Path)
		}
	}
}

func TestComputeSHA256(t *testing.T) {
	tmpDir := t.TempDir()

	content := []byte("test content")
	testFile := filepath.Join(tmpDir, "test.txt")
	if err := os.WriteFile(testFile, content, 0644); err != nil {
		t.Fatalf("failed to create test file: %v", err)
	}

	// Compute expected hash
	hasher := sha256.New()
	hasher.Write(content)
	expectedHash := hex.EncodeToString(hasher.Sum(nil))

	hash, err := computeSHA256(testFile)
	if err != nil {
		t.Fatalf("computeSHA256 failed: %v", err)
	}

	if hash != expectedHash {
		t.Errorf("hash = %s, want %s", hash, expectedHash)
	}
}

func TestComputeSHA256_NonExistentFile(t *testing.T) {
	_, err := computeSHA256("/nonexistent/file.txt")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestDetectMimeType(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"/path/to/file.jpg", "image/jpeg"},
		{"/path/to/file.png", "image/png"},
		{"/path/to/file.pdf", "application/pdf"},
		{"/path/to/file.txt", "text/plain"}, // May include "; charset=utf-8"
		{"/path/to/file.unknown", "application/octet-stream"},
		{"/path/to/file", "application/octet-stream"},
	}

	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := detectMimeType(tt.path)
			// MIME type may include charset, so check prefix for text files
			if !strings.HasPrefix(got, tt.expected) {
				t.Errorf("detectMimeType(%s) = %s, want prefix %s", tt.path, got, tt.expected)
			}
		})
	}
}

func TestIsHidden(t *testing.T) {
	tests := []struct {
		name     string
		expected bool
	}{
		{".hidden", true},
		{".git", true},
		{"visible", false},
		{"file.txt", false},
		{"", false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := isHidden(tt.name)
			if got != tt.expected {
				t.Errorf("isHidden(%s) = %v, want %v", tt.name, got, tt.expected)
			}
		})
	}
}
