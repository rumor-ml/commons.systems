// Package filesync provides a pipeline orchestrator for synchronizing files to cloud storage.
// The workflow is two-phase:
//  1. Extraction: Files are discovered and metadata extracted. Files stop at "extracted" status.
//  2. Upload: Users review extracted files and approve/reject. Approved files are uploaded.
//
// This design allows user review of metadata before files are uploaded to permanent storage.
package filesync

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

// Pipeline orchestrates file synchronization in two phases:
// Phase 1 (Extraction): discovery -> metadata extraction (files stop at FileStatusExtracted awaiting approval)
// Phase 2 (Upload): approval -> normalization -> upload (triggered by ApproveAndUpload or ApproveAllAndUpload)
type Pipeline struct {
	discoverer   Discoverer
	extractor    MetadataExtractor
	normalizer   PathNormalizer
	uploader     Uploader
	sessionStore SessionStore
	fileStore    FileStore
	config       PipelineConfig
}

// PipelineConfig configures pipeline behavior
type PipelineConfig struct {
	ConcurrentJobs     int           // Number of concurrent file processing jobs (default 8)
	ProgressBufferSize int           // Buffer size for progress channel (default 100)
	StatsBatchInterval time.Duration // Interval for batched stats updates (default 500ms)
	StatsBatchSize     int           // Number of operations before forced stats flush (default 50)
}

// DefaultPipelineConfig returns the default pipeline configuration
func DefaultPipelineConfig() PipelineConfig {
	return PipelineConfig{
		ConcurrentJobs:     8,
		ProgressBufferSize: 100,
		StatsBatchInterval: 500 * time.Millisecond,
		StatsBatchSize:     50,
	}
}

// Validate validates the pipeline configuration
func (c PipelineConfig) Validate() error {
	if c.ConcurrentJobs < 1 {
		return fmt.Errorf("ConcurrentJobs must be >= 1, got %d", c.ConcurrentJobs)
	}
	if c.StatsBatchInterval <= 0 {
		return fmt.Errorf("StatsBatchInterval must be > 0, got %v", c.StatsBatchInterval)
	}
	if c.ProgressBufferSize < 0 {
		return fmt.Errorf("ProgressBufferSize must be >= 0, got %d", c.ProgressBufferSize)
	}
	if c.StatsBatchSize < 1 {
		return fmt.Errorf("StatsBatchSize must be >= 1, got %d", c.StatsBatchSize)
	}
	return nil
}

// PipelineResult represents the outcome of a pipeline execution
type PipelineResult struct {
	SessionID       string
	TotalFiles      int
	ProcessedFiles  int
	SkippedFiles    int
	FailedFiles     int
	Errors          []FileError
	SecondaryErrors []error // Non-fatal errors (e.g., store update failures)
	Duration        time.Duration
}

// FileError represents an error that occurred while processing a file
type FileError struct {
	File  FileInfo
	Stage string
	Err   error // The underlying error
}

// PipelineOption is a functional option for configuring a Pipeline
type PipelineOption func(*Pipeline)

// WithConfig sets the pipeline configuration
func WithConfig(config PipelineConfig) PipelineOption {
	return func(p *Pipeline) {
		p.config = config
	}
}

// WithConcurrentJobs sets the number of concurrent jobs
func WithConcurrentJobs(jobs int) PipelineOption {
	return func(p *Pipeline) {
		p.config.ConcurrentJobs = jobs
	}
}

// WithProgressBufferSize sets the progress channel buffer size
func WithProgressBufferSize(size int) PipelineOption {
	return func(p *Pipeline) {
		p.config.ProgressBufferSize = size
	}
}

// WithStatsBatchInterval sets the stats batch flush interval
func WithStatsBatchInterval(interval time.Duration) PipelineOption {
	return func(p *Pipeline) {
		p.config.StatsBatchInterval = interval
	}
}

// WithStatsBatchSize sets the stats batch flush size
func WithStatsBatchSize(size int) PipelineOption {
	return func(p *Pipeline) {
		p.config.StatsBatchSize = size
	}
}

// NewPipeline creates a new pipeline orchestrator
func NewPipeline(
	discoverer Discoverer,
	extractor MetadataExtractor,
	normalizer PathNormalizer,
	uploader Uploader,
	sessionStore SessionStore,
	fileStore FileStore,
	opts ...PipelineOption,
) (*Pipeline, error) {
	if discoverer == nil {
		return nil, fmt.Errorf("discoverer is required")
	}
	if extractor == nil {
		return nil, fmt.Errorf("extractor is required")
	}
	if normalizer == nil {
		return nil, fmt.Errorf("normalizer is required")
	}
	if uploader == nil {
		return nil, fmt.Errorf("uploader is required")
	}
	if fileStore == nil {
		return nil, fmt.Errorf("fileStore is required")
	}
	if sessionStore == nil {
		return nil, fmt.Errorf("sessionStore is required")
	}

	p := &Pipeline{
		discoverer:   discoverer,
		extractor:    extractor,
		normalizer:   normalizer,
		uploader:     uploader,
		sessionStore: sessionStore,
		fileStore:    fileStore,
		config:       DefaultPipelineConfig(),
	}

	for _, opt := range opts {
		opt(p)
	}

	// Validate configuration after applying options
	if err := p.config.Validate(); err != nil {
		return nil, fmt.Errorf("invalid pipeline configuration: %w", err)
	}

	return p, nil
}

// Run is deprecated. Use RunExtraction instead.
// Run executes the extraction pipeline synchronously and returns the result.
func (p *Pipeline) Run(ctx context.Context, rootDir, userID string) (*PipelineResult, error) {
	return p.RunExtraction(ctx, rootDir, userID)
}

// RunAsync is deprecated. Use RunExtractionAsync instead.
// RunAsync executes the extraction pipeline asynchronously and returns result and progress channels.
func (p *Pipeline) RunAsync(ctx context.Context, rootDir, userID string) (<-chan *PipelineResult, <-chan Progress, error) {
	_, resultCh, progressCh, err := p.RunExtractionAsync(ctx, rootDir, userID)
	return resultCh, progressCh, err
}

// RunExtraction executes the extraction pipeline synchronously and returns the result.
// This method discovers files and extracts metadata, stopping at FileStatusExtracted.
// Files must be explicitly approved via ApproveAndUpload or ApproveAllAndUpload before upload.
func (p *Pipeline) RunExtraction(ctx context.Context, rootDir, userID string) (*PipelineResult, error) {
	_, resultCh, progressCh, err := p.RunExtractionAsync(ctx, rootDir, userID)
	if err != nil {
		return nil, err
	}

	// Drain progress channel (we don't need it for synchronous execution)
	go func() {
		for range progressCh {
			// Discard progress updates
		}
	}()

	// Wait for result
	result := <-resultCh
	return result, nil
}

// RunExtractionAsync executes the extraction pipeline asynchronously and returns session ID, result and progress channels.
// This method discovers files and extracts metadata, stopping at FileStatusExtracted.
// Files must be explicitly approved via ApproveAndUpload or ApproveAllAndUpload before upload.
func (p *Pipeline) RunExtractionAsync(ctx context.Context, rootDir, userID string) (string, <-chan *PipelineResult, <-chan Progress, error) {
	// Create session
	session := &SyncSession{
		ID:        uuid.New().String(),
		UserID:    userID,
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
		RootDir:   rootDir,
		Stats:     SessionStats{},
	}

	if err := p.sessionStore.Create(ctx, session); err != nil {
		return "", nil, nil, fmt.Errorf("failed to create session: %w", err)
	}

	// Create channels
	resultCh := make(chan *PipelineResult, 1)
	progressCh := make(chan Progress, p.config.ProgressBufferSize)

	// Start pipeline in background
	go p.execute(ctx, session, rootDir, resultCh, progressCh)

	return session.ID, resultCh, progressCh, nil
}

// execute runs the pipeline orchestration logic
func (p *Pipeline) execute(ctx context.Context, session *SyncSession, rootDir string, resultCh chan<- *PipelineResult, progressCh chan<- Progress) {
	defer close(resultCh)
	defer close(progressCh)

	startTime := time.Now()

	// Initialize stats accumulator
	stats := newStatsAccumulator(p.sessionStore, session, p.config.StatsBatchInterval, int64(p.config.StatsBatchSize))

	// Start periodic stats flusher
	flushCtx, cancelFlush := context.WithCancel(ctx)
	defer cancelFlush()
	go p.periodicStatsFlush(flushCtx, stats)

	// Start discovery
	filesCh, discoveryCh := p.discoverer.Discover(ctx, rootDir)

	// Process files concurrently
	result := p.processFiles(ctx, session, filesCh, discoveryCh, stats, progressCh)

	// Final stats flush
	if err := stats.flush(ctx); err != nil {
		result.Errors = append(result.Errors, FileError{
			Stage: "stats_flush",
			Err:   fmt.Errorf("failed to flush final stats: %w", err),
		})
	}

	// Update session status
	now := time.Now()
	session.CompletedAt = &now
	if result.ProcessedFiles > 0 || result.SkippedFiles > 0 {
		session.Status = SessionStatusCompleted
	} else {
		session.Status = SessionStatusFailed
	}
	session.Stats = stats.getSnapshot()

	if err := p.sessionStore.Update(ctx, session); err != nil {
		result.Errors = append(result.Errors, FileError{
			Stage: "session_update",
			Err:   fmt.Errorf("failed to update session: %w", err),
		})
	}

	result.Duration = time.Since(startTime)
	resultCh <- result
}

// processFiles processes discovered files concurrently
func (p *Pipeline) processFiles(
	ctx context.Context,
	session *SyncSession,
	filesCh <-chan FileInfo,
	errorsCh <-chan error,
	stats *statsAccumulator,
	progressCh chan<- Progress,
) *PipelineResult {
	result := &PipelineResult{
		SessionID: session.ID,
		Errors:    make([]FileError, 0),
	}

	// Create semaphore for bounded concurrency
	sem := semaphore.NewWeighted(int64(p.config.ConcurrentJobs))

	// WaitGroup to track all workers
	var wg sync.WaitGroup

	// Mutex to protect result updates
	var resultMu sync.Mutex

	// Process files from discovery channel
	for file := range filesCh {
		// Check context cancellation
		select {
		case <-ctx.Done():
			// Wait for in-flight operations to complete
			wg.Wait()
			resultMu.Lock()
			result.Errors = append(result.Errors, FileError{
				Stage: "pipeline",
				Err:   ctx.Err(),
			})
			resultMu.Unlock()
			return result
		default:
		}

		// Increment discovered count
		stats.incrementDiscovered()
		resultMu.Lock()
		result.TotalFiles++
		resultMu.Unlock()

		// Acquire semaphore (blocks if at capacity)
		if err := sem.Acquire(ctx, 1); err != nil {
			resultMu.Lock()
			result.Errors = append(result.Errors, FileError{
				File:  file,
				Stage: "semaphore",
				Err:   err,
			})
			resultMu.Unlock()
			continue
		}

		// Start worker
		wg.Add(1)
		go func(f FileInfo) {
			defer wg.Done()
			defer sem.Release(1)

			// Process file through pipeline stages
			if err := p.processFile(ctx, session, f, stats, progressCh); err != nil {
				stats.incrementErrors()
				resultMu.Lock()
				result.FailedFiles++
				result.Errors = append(result.Errors, FileError{
					File:  f,
					Stage: "processing",
					Err:   err,
				})
				resultMu.Unlock()
			} else {
				resultMu.Lock()
				result.ProcessedFiles++
				resultMu.Unlock()
			}

			// Check if we should flush stats
			if stats.shouldFlush() {
				if err := stats.flush(ctx); err != nil {
					resultMu.Lock()
					result.Errors = append(result.Errors, FileError{
						Stage: "stats_flush",
						Err:   err,
					})
					resultMu.Unlock()
				}
			}
		}(file)
	}

	// Collect discovery errors
	for err := range errorsCh {
		resultMu.Lock()
		result.Errors = append(result.Errors, FileError{
			Stage: "discovery",
			Err:   err,
		})
		resultMu.Unlock()
	}

	// Wait for all workers to complete
	wg.Wait()

	return result
}

// processFile processes a single file through the pipeline stages
func (p *Pipeline) processFile(
	ctx context.Context,
	session *SyncSession,
	file FileInfo,
	stats *statsAccumulator,
	progressCh chan<- Progress,
) error {
	// Create file record
	syncFile := &SyncFile{
		ID:        uuid.New().String(),
		UserID:    session.UserID,
		SessionID: session.ID,
		LocalPath: file.Path,
		Hash:      file.Hash,
		Status:    FileStatusPending,
		UpdatedAt: time.Now(),
	}

	if err := p.fileStore.Create(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to create file record: %w", err)
	}

	// Stage 1: Extract metadata
	syncFile.Status = FileStatusExtracting
	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file status to extracting: %w", err)
	}

	metadata, err := p.extractor.Extract(ctx, file, progressCh)
	if err != nil {
		syncFile.Status = FileStatusError
		syncFile.Error = err.Error()
		syncFile.UpdatedAt = time.Now()
		if updateErr := p.fileStore.Update(ctx, syncFile); updateErr != nil {
			return fmt.Errorf("extraction failed: %w (additionally, failed to update file status: %v)", err, updateErr)
		}
		return fmt.Errorf("failed to extract metadata: %w", err)
	}

	// Store extracted metadata immediately (for UI display)
	syncFile.Metadata = FileMetadata{
		Title: metadata.Title,
		Extra: make(map[string]string),
	}
	if metadata.Raw != nil {
		if author, ok := metadata.Raw["author"].(string); ok {
			syncFile.Metadata.Author = author
		}
		if isbn, ok := metadata.Raw["isbn"].(string); ok {
			syncFile.Metadata.ISBN = isbn
		}
		if publisher, ok := metadata.Raw["publisher"].(string); ok {
			syncFile.Metadata.Publisher = publisher
		}
		if publishDate, ok := metadata.Raw["publishDate"].(string); ok {
			syncFile.Metadata.PublishDate = publishDate
		}
	}

	// Set status to extracted - awaiting user approval
	syncFile.Status = FileStatusExtracted
	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file status to extracted: %w", err)
	}

	stats.incrementExtracted()
	return nil
}

// approveAndUploadFile approves a single file and uploads it.
// The file must be in FileStatusExtracted state with metadata already stored.
func (p *Pipeline) approveAndUploadFile(ctx context.Context, syncFile *SyncFile, stats *statsAccumulator, progressCh chan<- Progress) error {
	// Verify file is in extracted state
	if syncFile.Status != FileStatusExtracted {
		return fmt.Errorf("file %s not in extracted state (current: %s)", syncFile.ID, syncFile.Status)
	}

	// Reconstruct FileInfo from SyncFile
	fileInfo := FileInfo{
		Path:         syncFile.LocalPath,
		RelativePath: syncFile.LocalPath, // We don't have the original relative path, use local path
		Hash:         syncFile.Hash,
		// Size and other fields are not critical for normalization/upload
	}

	// Reconstruct ExtractedMetadata from stored metadata
	metadata := &ExtractedMetadata{
		Title: syncFile.Metadata.Title,
		Raw:   make(map[string]interface{}),
	}
	if syncFile.Metadata.Author != "" {
		metadata.Raw["author"] = syncFile.Metadata.Author
	}
	if syncFile.Metadata.ISBN != "" {
		metadata.Raw["isbn"] = syncFile.Metadata.ISBN
	}
	if syncFile.Metadata.Publisher != "" {
		metadata.Raw["publisher"] = syncFile.Metadata.Publisher
	}
	if syncFile.Metadata.PublishDate != "" {
		metadata.Raw["publishDate"] = syncFile.Metadata.PublishDate
	}

	// Stage 1: Normalize path
	normalizedPath, err := p.normalizer.Normalize(fileInfo, metadata)
	if err != nil {
		syncFile.Status = FileStatusError
		syncFile.Error = err.Error()
		syncFile.UpdatedAt = time.Now()
		if updateErr := p.fileStore.Update(ctx, syncFile); updateErr != nil {
			return fmt.Errorf("normalization failed: %w (additionally, failed to update file status: %v)", err, updateErr)
		}
		return fmt.Errorf("failed to normalize path: %w", err)
	}

	// Stage 2: Upload
	syncFile.Status = FileStatusUploading
	syncFile.GCSPath = normalizedPath.GCSPath
	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file status to uploading: %w", err)
	}

	uploadResult, err := p.uploader.Upload(ctx, fileInfo, normalizedPath.GCSPath, metadata, progressCh)
	if err != nil {
		syncFile.Status = FileStatusError
		syncFile.Error = err.Error()
		syncFile.UpdatedAt = time.Now()
		if updateErr := p.fileStore.Update(ctx, syncFile); updateErr != nil {
			return fmt.Errorf("upload failed: %w (additionally, failed to update file status: %v)", err, updateErr)
		}
		return fmt.Errorf("failed to upload: %w", err)
	}

	// Update file record with final status
	if uploadResult.Deduplicated {
		syncFile.Status = FileStatusSkipped
		stats.incrementSkipped()
	} else {
		syncFile.Status = FileStatusUploaded
		stats.incrementUploaded()
	}

	// Mark as approved
	stats.incrementApproved()

	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file with final status: %w", err)
	}

	return nil
}

// periodicStatsFlush periodically flushes stats to Firestore
// Note: Flush errors are logged but not returned since this runs in a background goroutine
func (p *Pipeline) periodicStatsFlush(ctx context.Context, stats *statsAccumulator) {
	ticker := time.NewTicker(p.config.StatsBatchInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if stats.shouldFlush() {
				// Flush errors in periodic background flush are non-fatal
				// They will be retried on next flush cycle
				_ = stats.flush(ctx)
			}
		}
	}
}

// ApprovalResult represents the outcome of an approval operation
type ApprovalResult struct {
	SessionID       string
	Approved        int
	Uploaded        int
	Skipped         int
	Failed          int
	Errors          []FileError
	SecondaryErrors []error // Non-fatal errors (e.g., store update failures)
}

// ApproveAndUpload approves specific files and uploads them.
// Files must be in FileStatusExtracted state. This method normalizes paths and uploads to GCS.
// Note: Files are processed sequentially, not concurrently.
func (p *Pipeline) ApproveAndUpload(ctx context.Context, sessionID string, fileIDs []string) (*ApprovalResult, error) {
	result := &ApprovalResult{
		SessionID: sessionID,
		Errors:    make([]FileError, 0),
	}

	// Get session for stats updates
	session, err := p.sessionStore.Get(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to get session: %w", err)
	}

	// Initialize stats accumulator for this approval operation
	stats := newStatsAccumulator(p.sessionStore, session, p.config.StatsBatchInterval, int64(p.config.StatsBatchSize))

	// Process each file
	for _, fileID := range fileIDs {
		// Get file
		syncFile, err := p.fileStore.Get(ctx, fileID)
		if err != nil {
			result.Failed++
			result.Errors = append(result.Errors, FileError{
				Stage: "get_file",
				Err:   fmt.Errorf("failed to get file %s: %w", fileID, err),
			})
			continue
		}

		// Approve and upload
		if err := p.approveAndUploadFile(ctx, syncFile, stats, nil); err != nil {
			result.Failed++
			result.Errors = append(result.Errors, FileError{
				File: FileInfo{
					Path: syncFile.LocalPath,
					Hash: syncFile.Hash,
				},
				Stage: "approve_upload",
				Err:   err,
			})
			continue
		}

		result.Approved++

		// Check final status to determine uploaded vs skipped
		updatedFile, err := p.fileStore.Get(ctx, fileID)
		if err != nil {
			result.SecondaryErrors = append(result.SecondaryErrors,
				fmt.Errorf("failed to get file %s status after upload: %w", fileID, err))
		} else {
			if updatedFile.Status == FileStatusUploaded {
				result.Uploaded++
			} else if updatedFile.Status == FileStatusSkipped {
				result.Skipped++
			}
		}
	}

	// Flush final stats
	if err := stats.flush(ctx); err != nil {
		result.Errors = append(result.Errors, FileError{
			Stage: "stats_flush",
			Err:   fmt.Errorf("failed to flush stats: %w", err),
		})
	}

	return result, nil
}

// ApproveAllAndUpload approves all extracted files in a session and uploads them.
func (p *Pipeline) ApproveAllAndUpload(ctx context.Context, sessionID string) (*ApprovalResult, error) {
	// Get all files in session
	files, err := p.fileStore.ListBySession(ctx, sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to list files: %w", err)
	}

	// Filter to only extracted files
	var extractedFileIDs []string
	for _, file := range files {
		if file.Status == FileStatusExtracted {
			extractedFileIDs = append(extractedFileIDs, file.ID)
		}
	}

	// Use ApproveAndUpload to process them
	return p.ApproveAndUpload(ctx, sessionID, extractedFileIDs)
}

// RejectFiles marks files as rejected. They stay in the list with FileStatusRejected.
func (p *Pipeline) RejectFiles(ctx context.Context, sessionID string, fileIDs []string) error {
	// Get session for stats updates
	session, err := p.sessionStore.Get(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	stats := newStatsAccumulator(p.sessionStore, session, p.config.StatsBatchInterval, int64(p.config.StatsBatchSize))

	for _, fileID := range fileIDs {
		// Get file
		syncFile, err := p.fileStore.Get(ctx, fileID)
		if err != nil {
			return fmt.Errorf("failed to get file %s: %w", fileID, err)
		}

		// Verify file is in extracted state
		if syncFile.Status != FileStatusExtracted {
			return fmt.Errorf("file %s is not in extracted state (current: %s)", fileID, syncFile.Status)
		}

		// Update status to rejected
		syncFile.Status = FileStatusRejected
		syncFile.UpdatedAt = time.Now()
		if err := p.fileStore.Update(ctx, syncFile); err != nil {
			return fmt.Errorf("failed to update file %s to rejected: %w", fileID, err)
		}

		stats.incrementRejected()
	}

	// Flush stats
	if err := stats.flush(ctx); err != nil {
		return fmt.Errorf("failed to flush stats: %w", err)
	}

	return nil
}

// TrashFiles marks files as trashed (soft delete) and deletes local files.
// Files can be in uploaded or skipped state.
// Local files are deleted (moved to system trash), but GCS files remain permanently.
func (p *Pipeline) TrashFiles(ctx context.Context, sessionID string, fileIDs []string) error {
	// Get session for stats updates
	session, err := p.sessionStore.Get(ctx, sessionID)
	if err != nil {
		return fmt.Errorf("failed to get session: %w", err)
	}

	stats := newStatsAccumulator(p.sessionStore, session, p.config.StatsBatchInterval, int64(p.config.StatsBatchSize))

	for _, fileID := range fileIDs {
		// Get file
		syncFile, err := p.fileStore.Get(ctx, fileID)
		if err != nil {
			return fmt.Errorf("failed to get file %s: %w", fileID, err)
		}

		// Validate state transition using state machine
		if !CanTrash(syncFile.Status) {
			return fmt.Errorf("file %s cannot be trashed from state %s", fileID, syncFile.Status)
		}

		// Delete local file if path exists
		if syncFile.LocalPath != "" {
			if err := p.uploader.DeleteLocal(ctx, syncFile.LocalPath); err != nil {
				// If local file deletion fails, don't update to trashed state
				return fmt.Errorf("failed to delete local file for %s: %w", fileID, err)
			}
		}

		// Update status to trashed
		syncFile.Status = FileStatusTrashed
		syncFile.UpdatedAt = time.Now()
		if err := p.fileStore.Update(ctx, syncFile); err != nil {
			return fmt.Errorf("failed to update file %s to trashed: %w", fileID, err)
		}
	}

	// Flush stats
	if err := stats.flush(ctx); err != nil {
		return fmt.Errorf("failed to flush stats: %w", err)
	}

	return nil
}
