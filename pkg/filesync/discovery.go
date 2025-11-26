package filesync

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"io/fs"
	"mime"
	"os"
	"path/filepath"
	"strings"
)

// DiscoveryOption configures ExtensionDiscoverer
type DiscoveryOption func(*ExtensionDiscoverer)

// ExtensionDiscoverer implements Discoverer for extension-based file discovery
type ExtensionDiscoverer struct {
	extensions  []string                              // Extensions to match (lowercase, with dot)
	skipHidden  bool                                  // Skip files/dirs starting with "."
	computeHash bool                                  // Compute SHA256 hash
	bufferSize  int                                   // Channel buffer size (default 100)
	fileFilter  func(path string, d fs.DirEntry) bool // Optional additional filter
}

// WithExtensions configures the file extensions to discover
func WithExtensions(exts ...string) DiscoveryOption {
	return func(d *ExtensionDiscoverer) {
		// Normalize extensions to lowercase with dot prefix
		normalized := make([]string, len(exts))
		for i, ext := range exts {
			if !strings.HasPrefix(ext, ".") {
				ext = "." + ext
			}
			normalized[i] = strings.ToLower(ext)
		}
		d.extensions = normalized
	}
}

// WithSkipHidden configures whether to skip hidden files and directories
func WithSkipHidden(skip bool) DiscoveryOption {
	return func(d *ExtensionDiscoverer) {
		d.skipHidden = skip
	}
}

// WithComputeHash configures whether to compute SHA256 hashes for discovered files
func WithComputeHash(compute bool) DiscoveryOption {
	return func(d *ExtensionDiscoverer) {
		d.computeHash = compute
	}
}

// WithBufferSize configures the channel buffer size
func WithBufferSize(size int) DiscoveryOption {
	return func(d *ExtensionDiscoverer) {
		d.bufferSize = size
	}
}

// WithFileFilter configures an additional custom filter function
func WithFileFilter(filter func(path string, d fs.DirEntry) bool) DiscoveryOption {
	return func(d *ExtensionDiscoverer) {
		d.fileFilter = filter
	}
}

// NewExtensionDiscoverer creates a new ExtensionDiscoverer with the given options
func NewExtensionDiscoverer(opts ...DiscoveryOption) *ExtensionDiscoverer {
	d := &ExtensionDiscoverer{
		extensions:  []string{},
		skipHidden:  true,
		computeHash: true,
		bufferSize:  100,
	}

	for _, opt := range opts {
		opt(d)
	}

	return d
}

// Discover walks the directory tree and sends FileInfo for each file found
// Returns channels for files and errors. Both channels will be closed when discovery completes.
func (d *ExtensionDiscoverer) Discover(ctx context.Context, rootDir string) (<-chan FileInfo, <-chan error) {
	fileChan := make(chan FileInfo, d.bufferSize)
	errChan := make(chan error, d.bufferSize)

	go func() {
		defer close(fileChan)
		defer close(errChan)

		// Clean and validate root directory
		rootDir = filepath.Clean(rootDir)

		err := filepath.WalkDir(rootDir, func(path string, entry fs.DirEntry, err error) error {
			// Check for context cancellation
			select {
			case <-ctx.Done():
				return &DiscoveryError{
					Path: path,
					Err:  ErrCancelled,
				}
			default:
			}

			// Handle walk errors
			if err != nil {
				errChan <- &DiscoveryError{
					Path: path,
					Err:  err,
				}
				// Skip this entry but continue walking
				return nil
			}

			// Skip hidden files/directories if configured
			if d.skipHidden && isHidden(entry.Name()) {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}

			// Skip directories
			if entry.IsDir() {
				return nil
			}

			// Check extension filter
			if len(d.extensions) > 0 {
				ext := strings.ToLower(filepath.Ext(path))
				matched := false
				for _, allowedExt := range d.extensions {
					if ext == allowedExt {
						matched = true
						break
					}
				}
				if !matched {
					return nil
				}
			}

			// Apply custom file filter if provided
			if d.fileFilter != nil && !d.fileFilter(path, entry) {
				return nil
			}

			// Get file info
			info, err := entry.Info()
			if err != nil {
				errChan <- &DiscoveryError{
					Path: path,
					Err:  err,
				}
				return nil
			}

			// Calculate relative path
			relPath, err := filepath.Rel(rootDir, path)
			if err != nil {
				errChan <- &DiscoveryError{
					Path: path,
					Err:  err,
				}
				return nil
			}

			// Build FileInfo
			fileInfo := FileInfo{
				Path:         path,
				RelativePath: relPath,
				Size:         info.Size(),
				ModTime:      info.ModTime(),
				MimeType:     detectMimeType(path),
			}

			// Compute hash if configured
			if d.computeHash {
				hash, err := computeSHA256(path)
				if err != nil {
					errChan <- &DiscoveryError{
						Path: path,
						Err:  fmt.Errorf("failed to compute hash: %w", err),
					}
					return nil
				}
				fileInfo.Hash = hash
			}

			// Send file info to channel
			select {
			case fileChan <- fileInfo:
			case <-ctx.Done():
				return &DiscoveryError{
					Path: path,
					Err:  ErrCancelled,
				}
			}

			return nil
		})

		// If walk returned an error, send it to error channel
		if err != nil {
			// Check if it's already a DiscoveryError
			if _, ok := err.(*DiscoveryError); !ok {
				err = &DiscoveryError{
					Path: rootDir,
					Err:  err,
				}
			}
			errChan <- err
		}
	}()

	return fileChan, errChan
}

// computeSHA256 computes the SHA256 hash of a file
func computeSHA256(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

// detectMimeType detects the MIME type of a file based on its extension
func detectMimeType(path string) string {
	ext := filepath.Ext(path)
	mimeType := mime.TypeByExtension(ext)
	if mimeType == "" {
		return "application/octet-stream"
	}
	return mimeType
}

// isHidden checks if a file or directory name is hidden (starts with ".")
func isHidden(name string) bool {
	return strings.HasPrefix(name, ".")
}
