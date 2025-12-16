package filesync

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	"google.golang.org/api/iterator"
)

// GCSUploader uploads files to Google Cloud Storage with Firestore tracking
type GCSUploader struct {
	gcsClient       *storage.Client
	firestoreClient *firestore.Client
	bucket          string
	collection      string
}

// GCSUploaderOption configures a GCSUploader
type GCSUploaderOption func(*GCSUploader)

// WithCollection configures the Firestore collection to use for tracking uploads
func WithCollection(collection string) GCSUploaderOption {
	return func(u *GCSUploader) {
		u.collection = collection
	}
}

// NewGCSUploader creates a new GCSUploader with the given clients and options
func NewGCSUploader(
	gcsClient *storage.Client,
	firestoreClient *firestore.Client,
	bucket string,
	opts ...GCSUploaderOption,
) *GCSUploader {
	u := &GCSUploader{
		gcsClient:       gcsClient,
		firestoreClient: firestoreClient,
		bucket:          bucket,
		collection:      getCollectionName(filesCollectionBase), // default to filesCollection from firestore_store.go
	}

	for _, opt := range opts {
		opt(u)
	}

	return u
}

// CheckExists checks if a file with the given hash already exists in GCS
// Returns true and the GCS path if found, false otherwise
func (u *GCSUploader) CheckExists(ctx context.Context, hash string) (exists bool, gcsPath string, err error) {
	// Query Firestore for files with matching hash and uploaded status
	iter := u.firestoreClient.Collection(u.collection).
		Where("hash", "==", hash).
		Where("status", "==", string(FileStatusUploaded)).
		Limit(1).
		Documents(ctx)
	defer iter.Stop()

	doc, err := iter.Next()
	if err == iterator.Done {
		// No matching file found
		return false, "", nil
	}
	if err != nil {
		return false, "", fmt.Errorf("failed to query for existing file: %w", err)
	}

	var file SyncFile
	if err := doc.DataTo(&file); err != nil {
		return false, "", fmt.Errorf("failed to unmarshal file data: %w", err)
	}

	return true, file.GCSPath, nil
}

// Upload uploads a file to GCS, sending progress updates
// If a file with the same hash already exists, it returns a deduplicated result
func (u *GCSUploader) Upload(
	ctx context.Context,
	file FileInfo,
	gcsPath string,
	metadata *ExtractedMetadata,
	progress chan<- Progress,
) (*UploadResult, error) {
	// Step 1: Check if file already exists (global deduplication)
	exists, existingPath, err := u.CheckExists(ctx, file.Hash)
	if err != nil {
		return nil, &UploadError{
			File:    file,
			GCSPath: gcsPath,
			Err:     fmt.Errorf("failed to check if file exists: %w", err),
		}
	}

	if exists {
		// File already uploaded, return deduplicated result
		return &UploadResult{
			Success:       true,
			GCSPath:       existingPath,
			BytesUploaded: 0,
			Deduplicated:  true,
		}, nil
	}

	// Step 2: Check for path conflicts
	if err := u.checkConflict(ctx, gcsPath, file.Hash); err != nil {
		return nil, &UploadError{
			File:    file,
			GCSPath: gcsPath,
			Err:     err,
		}
	}

	// Step 3: Upload to GCS
	bytesUploaded, err := u.uploadToGCS(ctx, file, gcsPath, progress)
	if err != nil {
		return nil, &UploadError{
			File:    file,
			GCSPath: gcsPath,
			Err:     err,
		}
	}

	// Step 4: Record upload in Firestore
	if err := u.recordUpload(ctx, file, gcsPath, metadata); err != nil {
		return nil, &UploadError{
			File:    file,
			GCSPath: gcsPath,
			Err:     fmt.Errorf("failed to record upload in Firestore: %w", err),
		}
	}

	return &UploadResult{
		Success:       true,
		GCSPath:       gcsPath,
		BytesUploaded: bytesUploaded,
		Deduplicated:  false,
	}, nil
}

// checkConflict checks if a different file already exists at the target path
func (u *GCSUploader) checkConflict(ctx context.Context, gcsPath, hash string) error {
	iter := u.firestoreClient.Collection(u.collection).
		Where("gcsPath", "==", gcsPath).
		Where("status", "==", string(FileStatusUploaded)).
		Limit(1).
		Documents(ctx)
	defer iter.Stop()

	doc, err := iter.Next()
	if err == iterator.Done {
		// No file at this path, no conflict
		return nil
	}
	if err != nil {
		return fmt.Errorf("failed to check for path conflict: %w", err)
	}

	var file SyncFile
	if err := doc.DataTo(&file); err != nil {
		return fmt.Errorf("failed to unmarshal conflicting file: %w", err)
	}

	// If the hash is different, we have a conflict
	if file.Hash != hash {
		return ErrConflict
	}

	// Same hash at same path is fine (idempotent)
	return nil
}

// uploadToGCS streams a file to GCS with progress reporting
func (u *GCSUploader) uploadToGCS(ctx context.Context, file FileInfo, gcsPath string, progress chan<- Progress) (int64, error) {
	// Open the local file
	f, err := os.Open(file.Path)
	if err != nil {
		return 0, fmt.Errorf("failed to open file: %w", err)
	}
	defer f.Close()

	// Create GCS object writer
	obj := u.gcsClient.Bucket(u.bucket).Object(gcsPath)
	writer := obj.NewWriter(ctx)

	// Set content type if available
	if file.MimeType != "" {
		writer.ContentType = file.MimeType
	}

	// Copy with progress reporting
	const bufferSize = 32 * 1024 // 32KB chunks
	buf := make([]byte, bufferSize)
	var totalWritten int64

	for {
		// Check for context cancellation
		select {
		case <-ctx.Done():
			writer.Close()
			return 0, ErrCancelled
		default:
		}

		n, err := f.Read(buf)
		if n > 0 {
			written, writeErr := writer.Write(buf[:n])
			if writeErr != nil {
				writer.Close()
				return 0, fmt.Errorf("failed to write to GCS: %w", writeErr)
			}
			totalWritten += int64(written)

			// Send progress update
			sendProgress(progress, Progress{
				Type:           ProgressTypeOperation,
				Operation:      "uploading",
				File:           file.Path,
				BytesProcessed: totalWritten,
				TotalBytes:     file.Size,
				Percentage:     float64(totalWritten) / float64(file.Size) * 100,
				Message:        "Uploading",
			})
		}

		if err == io.EOF {
			break
		}
		if err != nil {
			writer.Close()
			return 0, fmt.Errorf("failed to read file: %w", err)
		}
	}

	// Close the writer to finalize the upload
	if err := writer.Close(); err != nil {
		return 0, fmt.Errorf("failed to finalize GCS upload: %w", err)
	}

	return totalWritten, nil
}

// recordUpload creates a Firestore document to track the upload
func (u *GCSUploader) recordUpload(ctx context.Context, file FileInfo, gcsPath string, metadata *ExtractedMetadata) error {
	// Use hash as document ID for global deduplication
	docRef := u.firestoreClient.Collection(u.collection).Doc(file.Hash)

	syncFile := &SyncFile{
		ID:        file.Hash,
		LocalPath: file.Path,
		GCSPath:   gcsPath,
		Hash:      file.Hash,
		Status:    FileStatusUploaded,
		UpdatedAt: time.Now(),
		Metadata:  convertMetadata(metadata),
		// UserID and SessionID are empty for global dedup
		// The pipeline orchestrator will handle session-scoped tracking
	}

	_, err := docRef.Set(ctx, syncFile)
	if err != nil {
		return fmt.Errorf("failed to create Firestore record: %w", err)
	}

	return nil
}

// convertMetadata converts ExtractedMetadata to FileMetadata
func convertMetadata(extracted *ExtractedMetadata) FileMetadata {
	if extracted == nil {
		return FileMetadata{}
	}

	fm := FileMetadata{
		Title: extracted.Title,
		Extra: make(map[string]string),
	}

	// Copy fields that map to FileMetadata
	if extracted.CaptureDevice != "" {
		fm.Extra["captureDevice"] = extracted.CaptureDevice
	}

	if extracted.Description != "" {
		fm.Extra["description"] = extracted.Description
	}

	// Store location if present
	if extracted.Location != nil {
		fm.Extra["latitude"] = fmt.Sprintf("%f", extracted.Location.Latitude)
		fm.Extra["longitude"] = fmt.Sprintf("%f", extracted.Location.Longitude)
		if extracted.Location.Altitude != nil {
			fm.Extra["altitude"] = fmt.Sprintf("%f", *extracted.Location.Altitude)
		}
	}

	// Store tags as comma-separated string
	if len(extracted.Tags) > 0 {
		tagStr := ""
		for i, tag := range extracted.Tags {
			if i > 0 {
				tagStr += ","
			}
			tagStr += tag
		}
		fm.Extra["tags"] = tagStr
	}

	// Store raw metadata that doesn't fit elsewhere
	for k, v := range extracted.Raw {
		key := fmt.Sprintf("raw_%s", k)
		fm.Extra[key] = fmt.Sprintf("%v", v)
	}

	return fm
}

// DeleteLocal deletes the local source file (moves to system trash).
// This is called after a file has been successfully uploaded to clean up local storage.
// The operation is idempotent - returns nil if the file doesn't exist.
func (u *GCSUploader) DeleteLocal(ctx context.Context, localPath string) error {
	// Check for context cancellation
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}

	// Delete the local file
	err := os.Remove(localPath)
	if err != nil {
		// If file doesn't exist, that's fine (idempotent)
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("failed to delete local file %s: %w", localPath, err)
	}

	return nil
}

// sendProgress safely sends a progress update to the channel
func sendProgress(ch chan<- Progress, p Progress) {
	if ch == nil {
		return
	}

	select {
	case ch <- p:
		// Successfully sent
	default:
		// Channel is full or closed, don't block
		log.Printf("WARNING: Dropped progress event - Operation: %s, File: %s, Channel likely full or closed",
			p.Operation, p.File)
	}
}
