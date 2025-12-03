package print

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/commons-systems/filesync"
)

func TestNewDiscoverer_DefaultExtensions(t *testing.T) {
	d := NewDiscoverer()

	// Access the embedded ExtensionDiscoverer to check extensions
	// Note: extensions field is private, so we'll verify via integration test
	if d.ExtensionDiscoverer == nil {
		t.Fatal("ExtensionDiscoverer should not be nil")
	}
}

func TestDefaultExtensions_Values(t *testing.T) {
	expected := []string{".pdf", ".epub", ".cbz", ".cbr"}

	if len(DefaultExtensions) != len(expected) {
		t.Errorf("DefaultExtensions length = %d, want %d", len(DefaultExtensions), len(expected))
	}

	for i, ext := range expected {
		if DefaultExtensions[i] != ext {
			t.Errorf("DefaultExtensions[%d] = %s, want %s", i, DefaultExtensions[i], ext)
		}
	}
}

func TestNewDiscoverer_Integration(t *testing.T) {
	tmpDir := t.TempDir()

	// Create test files with different extensions
	files := map[string]string{
		"book.pdf":       "pdf content",
		"manual.epub":    "epub content",
		"comic.cbz":      "cbz content",
		"manga.cbr":      "cbr content",
		"image.jpg":      "jpg content",
		"document.txt":   "txt content",
		".hidden.pdf":    "hidden pdf",
		"nested/.hidden": "hidden nested",
	}

	// Create nested directory
	nestedDir := filepath.Join(tmpDir, "nested")
	if err := os.Mkdir(nestedDir, 0755); err != nil {
		t.Fatalf("failed to create nested directory: %v", err)
	}

	for name, content := range files {
		path := filepath.Join(tmpDir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", name, err)
		}
	}

	t.Run("default behavior", func(t *testing.T) {
		discoverer := NewDiscoverer()

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should find only print media files (pdf, epub, cbz, cbr)
		// Should NOT find hidden files (default skipHidden=true)
		expectedCount := 4
		if len(discovered) != expectedCount {
			t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
			for _, f := range discovered {
				t.Logf("  found: %s", f.Path)
			}
		}

		// Verify all discovered files are print media
		printExtensions := map[string]bool{
			".pdf":  true,
			".epub": true,
			".cbz":  true,
			".cbr":  true,
		}

		for _, file := range discovered {
			ext := strings.ToLower(filepath.Ext(file.Path))
			if !printExtensions[ext] {
				t.Errorf("unexpected file extension: %s (file: %s)", ext, file.Path)
			}

			// Verify hash is computed by default
			if file.Hash == "" {
				t.Errorf("expected hash to be computed for %s", file.Path)
			}

			// Verify no hidden files
			if strings.HasPrefix(filepath.Base(file.Path), ".") {
				t.Errorf("hidden file should be skipped: %s", file.Path)
			}
		}
	})

	t.Run("with custom options - disable hash", func(t *testing.T) {
		discoverer := NewDiscoverer(
			filesync.WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should still find same number of files
		expectedCount := 4
		if len(discovered) != expectedCount {
			t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
		}

		// Verify hash is NOT computed when disabled
		for _, file := range discovered {
			if file.Hash != "" {
				t.Errorf("expected hash to be empty for %s, got %s", file.Path, file.Hash)
			}
		}
	})

	t.Run("with custom options - include hidden", func(t *testing.T) {
		discoverer := NewDiscoverer(
			filesync.WithSkipHidden(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		var foundHidden bool
		for file := range fileChan {
			discovered = append(discovered, file)
			if strings.HasPrefix(filepath.Base(file.Path), ".") {
				foundHidden = true
			}
		}

		// Drain error channel
		for range errChan {
		}

		// Should find print media files including hidden ones
		expectedCount := 5 // 4 regular + 1 hidden pdf
		if len(discovered) != expectedCount {
			t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
			for _, f := range discovered {
				t.Logf("  found: %s", f.Path)
			}
		}

		if !foundHidden {
			t.Error("expected to find hidden print media file")
		}
	})

	t.Run("with custom options - override extensions", func(t *testing.T) {
		// Override to only find PDF files
		discoverer := NewDiscoverer(
			filesync.WithExtensions(".pdf"),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should only find PDF files (not hidden)
		expectedCount := 1
		if len(discovered) != expectedCount {
			t.Errorf("expected %d file, got %d", expectedCount, len(discovered))
		}

		if len(discovered) > 0 {
			ext := strings.ToLower(filepath.Ext(discovered[0].Path))
			if ext != ".pdf" {
				t.Errorf("expected .pdf extension, got %s", ext)
			}
		}
	})

	t.Run("with multiple custom options", func(t *testing.T) {
		// Combine: disable hash, include hidden, only epub
		discoverer := NewDiscoverer(
			filesync.WithComputeHash(false),
			filesync.WithSkipHidden(false),
			filesync.WithExtensions(".epub"),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should only find epub files
		expectedCount := 1
		if len(discovered) != expectedCount {
			t.Errorf("expected %d file, got %d", expectedCount, len(discovered))
		}

		for _, file := range discovered {
			if file.Hash != "" {
				t.Errorf("expected hash to be empty, got %s", file.Hash)
			}

			ext := strings.ToLower(filepath.Ext(file.Path))
			if ext != ".epub" {
				t.Errorf("expected .epub extension, got %s", ext)
			}
		}
	})
}

func TestNewDiscoverer_EmptyDirectory(t *testing.T) {
	tmpDir := t.TempDir()

	discoverer := NewDiscoverer()

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	var discovered []filesync.FileInfo
	for file := range fileChan {
		discovered = append(discovered, file)
	}

	// Drain error channel
	for range errChan {
	}

	if len(discovered) != 0 {
		t.Errorf("expected 0 files in empty directory, got %d", len(discovered))
	}
}

func TestNewDiscoverer_NestedDirectories(t *testing.T) {
	tmpDir := t.TempDir()

	// Create nested structure with print media files
	dirs := []string{
		"books",
		"books/fiction",
		"books/non-fiction",
		"comics",
	}

	for _, dir := range dirs {
		if err := os.MkdirAll(filepath.Join(tmpDir, dir), 0755); err != nil {
			t.Fatalf("failed to create directory %s: %v", dir, err)
		}
	}

	files := map[string]string{
		"books/book1.pdf":             "pdf 1",
		"books/fiction/novel.epub":    "epub 1",
		"books/non-fiction/guide.pdf": "pdf 2",
		"comics/issue1.cbz":           "cbz 1",
		"comics/issue2.cbr":           "cbr 1",
	}

	for name, content := range files {
		path := filepath.Join(tmpDir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", name, err)
		}
	}

	discoverer := NewDiscoverer()

	ctx := context.Background()
	fileChan, errChan := discoverer.Discover(ctx, tmpDir)

	var discovered []filesync.FileInfo
	for file := range fileChan {
		discovered = append(discovered, file)
	}

	// Drain error channel
	for range errChan {
	}

	expectedCount := 5
	if len(discovered) != expectedCount {
		t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
	}

	// Verify relative paths are correct
	for _, file := range discovered {
		if file.RelativePath == "" {
			t.Errorf("expected non-empty relative path for %s", file.Path)
		}

		// Relative path should not start with tmpDir
		if strings.HasPrefix(file.RelativePath, tmpDir) {
			t.Errorf("relative path should not contain tmpDir: %s", file.RelativePath)
		}
	}
}

func TestNewDiscoverer_HashComputation(t *testing.T) {
	tmpDir := t.TempDir()

	// Create two files with same content
	content := []byte("identical print media content")
	file1 := filepath.Join(tmpDir, "book1.pdf")
	file2 := filepath.Join(tmpDir, "book2.pdf")

	if err := os.WriteFile(file1, content, 0644); err != nil {
		t.Fatalf("failed to create file1: %v", err)
	}
	if err := os.WriteFile(file2, content, 0644); err != nil {
		t.Fatalf("failed to create file2: %v", err)
	}

	t.Run("default hash computation enabled", func(t *testing.T) {
		discoverer := NewDiscoverer()

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		if len(discovered) != 2 {
			t.Fatalf("expected 2 files, got %d", len(discovered))
		}

		// Both files should have same hash
		if discovered[0].Hash == "" || discovered[1].Hash == "" {
			t.Error("expected hashes to be computed")
		}

		if discovered[0].Hash != discovered[1].Hash {
			t.Errorf("files with identical content should have same hash: %s != %s",
				discovered[0].Hash, discovered[1].Hash)
		}
	})

	t.Run("hash computation disabled", func(t *testing.T) {
		discoverer := NewDiscoverer(
			filesync.WithComputeHash(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		if len(discovered) != 2 {
			t.Fatalf("expected 2 files, got %d", len(discovered))
		}

		// Both files should have empty hash
		for _, file := range discovered {
			if file.Hash != "" {
				t.Errorf("expected empty hash when disabled, got %s", file.Hash)
			}
		}
	})
}

func TestNewDiscoverer_SkipHidden(t *testing.T) {
	tmpDir := t.TempDir()

	// Create visible and hidden print media files
	files := map[string]string{
		"visible.pdf":  "visible content",
		".hidden.pdf":  "hidden content",
		"book.epub":    "book content",
		".secret.epub": "secret content",
	}

	for name, content := range files {
		path := filepath.Join(tmpDir, name)
		if err := os.WriteFile(path, []byte(content), 0644); err != nil {
			t.Fatalf("failed to create test file %s: %v", name, err)
		}
	}

	t.Run("default skip hidden enabled", func(t *testing.T) {
		discoverer := NewDiscoverer()

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should only find visible files
		expectedCount := 2
		if len(discovered) != expectedCount {
			t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
		}

		for _, file := range discovered {
			if strings.HasPrefix(filepath.Base(file.Path), ".") {
				t.Errorf("hidden file should be skipped: %s", file.Path)
			}
		}
	})

	t.Run("skip hidden disabled", func(t *testing.T) {
		discoverer := NewDiscoverer(
			filesync.WithSkipHidden(false),
		)

		ctx := context.Background()
		fileChan, errChan := discoverer.Discover(ctx, tmpDir)

		var discovered []filesync.FileInfo
		for file := range fileChan {
			discovered = append(discovered, file)
		}

		// Drain error channel
		for range errChan {
		}

		// Should find all files including hidden
		expectedCount := 4
		if len(discovered) != expectedCount {
			t.Errorf("expected %d files, got %d", expectedCount, len(discovered))
		}
	})
}
