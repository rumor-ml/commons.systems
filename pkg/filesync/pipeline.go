package filesync

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"golang.org/x/sync/semaphore"
)

// Pipeline orchestrates the file sync pipeline: discovery → extraction → normalization → upload
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

// PipelineResult represents the outcome of a pipeline execution
type PipelineResult struct {
	SessionID      string
	TotalFiles     int
	ProcessedFiles int
	SkippedFiles   int
	FailedFiles    int
	Errors         []FileError
	Duration       time.Duration
}

// FileError represents an error that occurred while processing a file
type FileError struct {
	File  FileInfo
	Stage string
	Error error
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
) *Pipeline {
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

	return p
}

// Run executes the pipeline synchronously and returns the result
func (p *Pipeline) Run(ctx context.Context, rootDir, userID string) (*PipelineResult, error) {
	resultCh, progressCh, err := p.RunAsync(ctx, rootDir, userID)
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

// RunAsync executes the pipeline asynchronously and returns result and progress channels
func (p *Pipeline) RunAsync(ctx context.Context, rootDir, userID string) (<-chan *PipelineResult, <-chan Progress, error) {
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
		return nil, nil, fmt.Errorf("failed to create session: %w", err)
	}

	// Create channels
	resultCh := make(chan *PipelineResult, 1)
	progressCh := make(chan Progress, p.config.ProgressBufferSize)

	// Start pipeline in background
	go p.execute(ctx, session, rootDir, resultCh, progressCh)

	return resultCh, progressCh, nil
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
			Error: fmt.Errorf("failed to flush final stats: %w", err),
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
			Error: fmt.Errorf("failed to update session: %w", err),
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
				Error: ctx.Err(),
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
				Error: err,
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
					Error: err,
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
						Error: err,
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
			Error: err,
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
		_ = p.fileStore.Update(ctx, syncFile)
		return fmt.Errorf("failed to extract metadata: %w", err)
	}
	stats.incrementExtracted()

	// Stage 2: Normalize path
	normalizedPath, err := p.normalizer.Normalize(file, metadata)
	if err != nil {
		syncFile.Status = FileStatusError
		syncFile.Error = err.Error()
		syncFile.UpdatedAt = time.Now()
		_ = p.fileStore.Update(ctx, syncFile)
		return fmt.Errorf("failed to normalize path: %w", err)
	}

	// Stage 3: Upload
	syncFile.Status = FileStatusUploading
	syncFile.GCSPath = normalizedPath.GCSPath
	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file status to uploading: %w", err)
	}

	uploadResult, err := p.uploader.Upload(ctx, file, normalizedPath.GCSPath, metadata, progressCh)
	if err != nil {
		syncFile.Status = FileStatusError
		syncFile.Error = err.Error()
		syncFile.UpdatedAt = time.Time{}
		_ = p.fileStore.Update(ctx, syncFile)
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

	// Store metadata
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

	syncFile.UpdatedAt = time.Now()
	if err := p.fileStore.Update(ctx, syncFile); err != nil {
		return fmt.Errorf("failed to update file with final status: %w", err)
	}

	return nil
}

// periodicStatsFlush periodically flushes stats to Firestore
func (p *Pipeline) periodicStatsFlush(ctx context.Context, stats *statsAccumulator) {
	ticker := time.NewTicker(p.config.StatsBatchInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if stats.shouldFlush() {
				_ = stats.flush(ctx)
			}
		}
	}
}
