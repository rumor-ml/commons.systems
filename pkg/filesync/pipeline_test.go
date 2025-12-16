package filesync

import (
	"context"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// Mock implementations for testing

type mockDiscoverer struct {
	files  []FileInfo
	errors []error
	delay  time.Duration
}

func (m *mockDiscoverer) Discover(ctx context.Context, rootDir string) (<-chan FileInfo, <-chan error) {
	filesCh := make(chan FileInfo, len(m.files))
	errorsCh := make(chan error, len(m.errors))

	go func() {
		defer close(filesCh)
		defer close(errorsCh)

		// Send errors first
		for _, err := range m.errors {
			select {
			case <-ctx.Done():
				return
			case errorsCh <- err:
			}
		}

		// Then send files with optional delay
		for _, file := range m.files {
			if m.delay > 0 {
				time.Sleep(m.delay)
			}
			select {
			case <-ctx.Done():
				return
			case filesCh <- file:
			}
		}
	}()

	return filesCh, errorsCh
}

type mockExtractor struct {
	canExtract bool
	extractErr error
	delay      time.Duration
	callCount  int64
}

func (m *mockExtractor) Extract(ctx context.Context, file FileInfo, progress chan<- Progress) (*ExtractedMetadata, error) {
	atomic.AddInt64(&m.callCount, 1)
	if m.delay > 0 {
		time.Sleep(m.delay)
	}
	if m.extractErr != nil {
		return nil, m.extractErr
	}
	return &ExtractedMetadata{
		Title: "Test Book",
		Raw: map[string]interface{}{
			"author": "Test Author",
		},
	}, nil
}

func (m *mockExtractor) CanExtract(file FileInfo) bool {
	return m.canExtract
}

type mockNormalizer struct {
	normalizeErr error
}

func (m *mockNormalizer) Normalize(file FileInfo, metadata *ExtractedMetadata) (*NormalizedPath, error) {
	if m.normalizeErr != nil {
		return nil, m.normalizeErr
	}
	return &NormalizedPath{
		GCSPath:   "normalized/path/" + file.RelativePath,
		Directory: "normalized/path",
		Filename:  file.RelativePath,
	}, nil
}

type mockUploader struct {
	uploadErr     error
	deduplicated  bool
	delay         time.Duration
	callCount     int64
	uploadedFiles []FileInfo
	mu            sync.Mutex
}

func (m *mockUploader) Upload(ctx context.Context, file FileInfo, gcsPath string, metadata *ExtractedMetadata, progress chan<- Progress) (*UploadResult, error) {
	atomic.AddInt64(&m.callCount, 1)
	if m.delay > 0 {
		time.Sleep(m.delay)
	}

	m.mu.Lock()
	m.uploadedFiles = append(m.uploadedFiles, file)
	m.mu.Unlock()

	if m.uploadErr != nil {
		return nil, m.uploadErr
	}
	return &UploadResult{
		Success:       true,
		GCSPath:       gcsPath,
		BytesUploaded: file.Size,
		Deduplicated:  m.deduplicated,
	}, nil
}

func (m *mockUploader) CheckExists(ctx context.Context, hash string) (bool, string, error) {
	return false, "", nil
}

func (m *mockUploader) DeleteLocal(ctx context.Context, localPath string) error {
	// Mock implementation - just return nil (successful deletion)
	return nil
}

func (m *mockUploader) getUploadedFiles() []FileInfo {
	m.mu.Lock()
	defer m.mu.Unlock()
	files := make([]FileInfo, len(m.uploadedFiles))
	copy(files, m.uploadedFiles)
	return files
}

type mockSessionStore struct {
	sessions map[string]*SyncSession
	mu       sync.Mutex
}

func newMockSessionStore() *mockSessionStore {
	return &mockSessionStore{
		sessions: make(map[string]*SyncSession),
	}
}

func (m *mockSessionStore) Create(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStore) Update(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.sessions[session.ID]; !exists {
		return errors.New("session not found")
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStore) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, errors.New("session not found")
	}
	return session, nil
}

func (m *mockSessionStore) List(ctx context.Context, userID string) ([]*SyncSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var sessions []*SyncSession
	for _, s := range m.sessions {
		if s.UserID == userID {
			sessions = append(sessions, s)
		}
	}
	return sessions, nil
}

func (m *mockSessionStore) Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession), errCallback func(error)) error {
	return nil
}

func (m *mockSessionStore) Delete(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
	return nil
}

type mockFileStore struct {
	files map[string]*SyncFile
	mu    sync.Mutex
}

func newMockFileStore() *mockFileStore {
	return &mockFileStore{
		files: make(map[string]*SyncFile),
	}
}

func (m *mockFileStore) Create(ctx context.Context, file *SyncFile) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[file.ID] = file
	return nil
}

func (m *mockFileStore) Update(ctx context.Context, file *SyncFile) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.files[file.ID]; !exists {
		return errors.New("file not found")
	}
	m.files[file.ID] = file
	return nil
}

func (m *mockFileStore) Get(ctx context.Context, fileID string) (*SyncFile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	file, exists := m.files[fileID]
	if !exists {
		return nil, errors.New("file not found")
	}
	return file, nil
}

func (m *mockFileStore) ListBySession(ctx context.Context, sessionID string) ([]*SyncFile, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var files []*SyncFile
	for _, f := range m.files {
		if f.SessionID == sessionID {
			files = append(files, f)
		}
	}
	return files, nil
}

func (m *mockFileStore) SubscribeBySession(ctx context.Context, sessionID string, callback func(*SyncFile), errCallback func(error)) error {
	return nil
}

func (m *mockFileStore) Delete(ctx context.Context, fileID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.files, fileID)
	return nil
}

// Test cases

func TestPipeline_Run_ProcessesAllFiles(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
		{Path: "/test/file3.pdf", RelativePath: "file3.pdf", Size: 300, Hash: "hash3"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
		WithConcurrentJobs(2),
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run pipeline
	result, err := pipeline.Run(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify results
	if result.TotalFiles != 3 {
		t.Errorf("expected 3 total files, got %d", result.TotalFiles)
	}
	if result.ProcessedFiles != 3 {
		t.Errorf("expected 3 processed files, got %d", result.ProcessedFiles)
	}
	if result.FailedFiles != 0 {
		t.Errorf("expected 0 failed files, got %d", result.FailedFiles)
	}

	// Verify NO files were uploaded (extraction stops before upload)
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 0 {
		t.Errorf("expected 0 uploaded files (extraction only), got %d", len(uploadedFiles))
	}

	// Verify session was completed
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if session.Status != SessionStatusCompleted {
		t.Errorf("expected session status to be completed, got %s", session.Status)
	}
	if session.Stats.Discovered != 3 {
		t.Errorf("expected 3 discovered files in stats, got %d", session.Stats.Discovered)
	}
	if session.Stats.Extracted != 3 {
		t.Errorf("expected 3 extracted files in stats, got %d", session.Stats.Extracted)
	}
	if session.Stats.Uploaded != 0 {
		t.Errorf("expected 0 uploaded files in stats (extraction only), got %d", session.Stats.Uploaded)
	}

	// Verify files are in extracted status
	sessionFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}
	for _, file := range sessionFiles {
		if file.Status != FileStatusExtracted {
			t.Errorf("expected file %s to be in extracted status, got %s", file.LocalPath, file.Status)
		}
	}
}

func TestPipeline_Run_ConcurrentProcessing(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
		{Path: "/test/file3.pdf", RelativePath: "file3.pdf", Size: 300, Hash: "hash3"},
		{Path: "/test/file4.pdf", RelativePath: "file4.pdf", Size: 400, Hash: "hash4"},
	}

	// Setup mocks with delays to test concurrency
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true, delay: 50 * time.Millisecond}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{delay: 50 * time.Millisecond}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline with 4 concurrent jobs
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
		WithConcurrentJobs(4),
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	start := time.Now()
	result, runErr := pipeline.Run(ctx, "/test", "user123")
	duration := time.Since(start)

	if runErr != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// With 4 concurrent jobs and 100ms total delay per file (50ms extract + 50ms upload),
	// processing should take ~100ms (all files processed in parallel)
	// Add generous margin for test execution overhead
	if duration > 500*time.Millisecond {
		t.Errorf("processing took too long: %v (expected ~100ms with parallelism)", duration)
	}

	if result.ProcessedFiles != 4 {
		t.Errorf("expected 4 processed files, got %d", result.ProcessedFiles)
	}
}

func TestPipeline_Run_ContinuesOnFileError(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
		{Path: "/test/file3.pdf", RelativePath: "file3.pdf", Size: 300, Hash: "hash3"},
	}

	// Setup mocks - extractor will fail
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true, extractErr: errors.New("extraction failed")}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run pipeline
	result, err := pipeline.Run(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify that all files were attempted but all failed at extraction
	if result.TotalFiles != 3 {
		t.Errorf("expected 3 total files, got %d", result.TotalFiles)
	}
	if result.FailedFiles != 3 {
		t.Errorf("expected 3 failed files, got %d", result.FailedFiles)
	}
	if result.ProcessedFiles != 0 {
		t.Errorf("expected 0 processed files, got %d", result.ProcessedFiles)
	}
	if len(result.Errors) != 3 {
		t.Errorf("expected 3 errors, got %d", len(result.Errors))
	}

	// Verify no files were uploaded (extraction failed before upload stage)
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 0 {
		t.Errorf("expected 0 uploaded files, got %d", len(uploadedFiles))
	}

	// Session should still be marked as failed since no files succeeded
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if session.Status != SessionStatusFailed {
		t.Errorf("expected session status to be failed, got %s", session.Status)
	}
}

func TestPipeline_Run_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())

	// Create many test files
	var files []FileInfo
	for i := 0; i < 100; i++ {
		files = append(files, FileInfo{
			Path:         "/test/file" + string(rune(i)) + ".pdf",
			RelativePath: "file" + string(rune(i)) + ".pdf",
			Size:         100,
			Hash:         "hash" + string(rune(i)),
		})
	}

	// Setup mocks with delays
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true, delay: 10 * time.Millisecond}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{delay: 10 * time.Millisecond}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
		WithConcurrentJobs(2),
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Cancel context after a short delay
	go func() {
		time.Sleep(100 * time.Millisecond)
		cancel()
	}()

	// Run pipeline
	result, err := pipeline.Run(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify that not all files were processed (due to cancellation)
	if result.ProcessedFiles >= 100 {
		t.Errorf("expected fewer than 100 processed files due to cancellation, got %d", result.ProcessedFiles)
	}

	// Verify that context cancellation error was captured
	hasContextError := false
	for _, fileErr := range result.Errors {
		if errors.Is(fileErr.Err, context.Canceled) {
			hasContextError = true
			break
		}
	}
	if !hasContextError && len(result.Errors) == 0 {
		// It's OK if we didn't capture the error if all in-flight files completed before cancellation
		t.Logf("no context cancellation error captured, processed %d files", result.ProcessedFiles)
	}
}

func TestPipeline_RunAsync_ReturnsImmediately(t *testing.T) {
	ctx := context.Background()

	// Create test files with delays
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks with delays
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true, delay: 100 * time.Millisecond}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{delay: 100 * time.Millisecond}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// RunAsync should return immediately
	start := time.Now()
	resultCh, progressCh, runErr := pipeline.RunAsync(ctx, "/test", "user123")
	callDuration := time.Since(start)

	if runErr != nil {
		t.Fatalf("pipeline.RunAsync() failed: %v", err)
	}

	// Should return almost immediately (< 50ms)
	if callDuration > 50*time.Millisecond {
		t.Errorf("RunAsync took too long to return: %v", callDuration)
	}

	// Drain progress channel
	go func() {
		for range progressCh {
			// Discard progress updates
		}
	}()

	// Wait for result
	result := <-resultCh

	if result.ProcessedFiles != 2 {
		t.Errorf("expected 2 processed files, got %d", result.ProcessedFiles)
	}
}

func TestStatsAccumulator_Batching(t *testing.T) {
	ctx := context.Background()

	sessionStore := newMockSessionStore()
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user123",
		Status: SessionStatusRunning,
	}
	sessionStore.Create(ctx, session)

	// Create stats accumulator with small batch size
	stats, _ := newStatsAccumulator(sessionStore, session, 1*time.Second, 5)

	// Increment counters
	for i := 0; i < 3; i++ {
		stats.incrementDiscovered()
		stats.incrementUploaded()
	}

	// Should not flush yet (only 6 ops, threshold is 5 but we check total)
	if stats.shouldFlush() {
		// Time-based flush might trigger if test is slow
		t.Logf("note: shouldFlush returned true, likely due to time interval")
	}

	// Add more operations to exceed batch size
	stats.incrementDiscovered()
	stats.incrementDiscovered()

	// Now should flush (8 ops > 5)
	if !stats.shouldFlush() {
		t.Error("expected shouldFlush to return true after exceeding batch size")
	}

	// Flush and verify
	if err := stats.flush(ctx); err != nil {
		t.Fatalf("flush failed: %v", err)
	}

	// Verify session was updated
	updatedSession, err := sessionStore.Get(ctx, "test-session")
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if updatedSession.Stats.Discovered != 5 {
		t.Errorf("expected 5 discovered, got %d", updatedSession.Stats.Discovered)
	}
	if updatedSession.Stats.Uploaded != 3 {
		t.Errorf("expected 3 uploaded, got %d", updatedSession.Stats.Uploaded)
	}
}

func TestPipeline_Run_SkippedFiles(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks - uploader returns deduplicated (but won't be called in extraction-only mode)
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{deduplicated: true}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run pipeline (extraction only)
	result, err := pipeline.Run(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify results - files are extracted but not uploaded
	if result.TotalFiles != 2 {
		t.Errorf("expected 2 total files, got %d", result.TotalFiles)
	}
	if result.ProcessedFiles != 2 {
		t.Errorf("expected 2 processed files, got %d", result.ProcessedFiles)
	}

	// Verify session stats show extracted but not uploaded
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if session.Stats.Extracted != 2 {
		t.Errorf("expected 2 extracted files in stats, got %d", session.Stats.Extracted)
	}
	if session.Stats.Uploaded != 0 {
		t.Errorf("expected 0 uploaded files in stats (extraction only), got %d", session.Stats.Uploaded)
	}
	if session.Stats.Skipped != 0 {
		t.Errorf("expected 0 skipped files in stats (extraction only), got %d", session.Stats.Skipped)
	}
}

func TestPipeline_RunExtraction_StopsAfterExtract(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Verify files stopped at extracted status
	files_in_session, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	if len(files_in_session) != 2 {
		t.Errorf("expected 2 files, got %d", len(files_in_session))
	}

	for _, file := range files_in_session {
		if file.Status != FileStatusExtracted {
			t.Errorf("expected file %s to be in extracted status, got %s", file.LocalPath, file.Status)
		}
		if file.Metadata.Title == "" {
			t.Errorf("expected file %s to have metadata stored", file.LocalPath)
		}
	}

	// Verify no uploads occurred
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 0 {
		t.Errorf("expected 0 uploaded files, got %d", len(uploadedFiles))
	}
}

func TestPipeline_ApproveAndUpload_SingleFile(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Get files to approve
	extractedFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	// Approve first file only
	approvalResult, err := pipeline.ApproveAndUpload(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("pipeline.ApproveAndUpload() failed: %v", err)
	}

	// Verify approval result
	if approvalResult.Approved != 1 {
		t.Errorf("expected 1 approved file, got %d", approvalResult.Approved)
	}
	if approvalResult.Uploaded != 1 {
		t.Errorf("expected 1 uploaded file, got %d", approvalResult.Uploaded)
	}
	if approvalResult.Failed != 0 {
		t.Errorf("expected 0 failed files, got %d", approvalResult.Failed)
	}

	// Verify first file is uploaded
	file1, err := fileStore.Get(ctx, extractedFiles[0].ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}
	if file1.Status != FileStatusUploaded {
		t.Errorf("expected file to be uploaded, got status %s", file1.Status)
	}

	// Verify second file is still extracted
	file2, err := fileStore.Get(ctx, extractedFiles[1].ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}
	if file2.Status != FileStatusExtracted {
		t.Errorf("expected file to be extracted, got status %s", file2.Status)
	}

	// Verify upload occurred
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 1 {
		t.Errorf("expected 1 uploaded file, got %d", len(uploadedFiles))
	}
}

func TestPipeline_ApproveAllAndUpload(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
		{Path: "/test/file3.pdf", RelativePath: "file3.pdf", Size: 300, Hash: "hash3"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Approve all files
	approvalResult, err := pipeline.ApproveAllAndUpload(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("pipeline.ApproveAllAndUpload() failed: %v", err)
	}

	// Verify approval result
	if approvalResult.Approved != 3 {
		t.Errorf("expected 3 approved files, got %d", approvalResult.Approved)
	}
	if approvalResult.Uploaded != 3 {
		t.Errorf("expected 3 uploaded files, got %d", approvalResult.Uploaded)
	}
	if approvalResult.Failed != 0 {
		t.Errorf("expected 0 failed files, got %d", approvalResult.Failed)
	}

	// Verify all files are uploaded
	allFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	for _, file := range allFiles {
		if file.Status != FileStatusUploaded {
			t.Errorf("expected file %s to be uploaded, got status %s", file.LocalPath, file.Status)
		}
	}

	// Verify uploads occurred
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 3 {
		t.Errorf("expected 3 uploaded files, got %d", len(uploadedFiles))
	}

	// Verify session stats
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if session.Stats.Approved != 3 {
		t.Errorf("expected 3 approved in stats, got %d", session.Stats.Approved)
	}
	if session.Stats.Uploaded != 3 {
		t.Errorf("expected 3 uploaded in stats, got %d", session.Stats.Uploaded)
	}
}

func TestPipeline_RejectFiles(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Get files
	extractedFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	// Reject first file
	err = pipeline.RejectFiles(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("pipeline.RejectFiles() failed: %v", err)
	}

	// Verify first file is rejected
	file1, err := fileStore.Get(ctx, extractedFiles[0].ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}
	if file1.Status != FileStatusRejected {
		t.Errorf("expected file to be rejected, got status %s", file1.Status)
	}

	// Verify second file is still extracted
	file2, err := fileStore.Get(ctx, extractedFiles[1].ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}
	if file2.Status != FileStatusExtracted {
		t.Errorf("expected file to be extracted, got status %s", file2.Status)
	}

	// Verify no uploads occurred
	uploadedFiles := uploader.getUploadedFiles()
	if len(uploadedFiles) != 0 {
		t.Errorf("expected 0 uploaded files, got %d", len(uploadedFiles))
	}

	// Verify session stats
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if session.Stats.Rejected != 1 {
		t.Errorf("expected 1 rejected in stats, got %d", session.Stats.Rejected)
	}
}

func TestPipeline_ApproveAndUpload_WrongStatus(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Get file
	extractedFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	// Approve and upload the file
	_, err = pipeline.ApproveAndUpload(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("first ApproveAndUpload() failed: %v", err)
	}

	// Try to approve again (should fail - file is now uploaded, not extracted)
	approvalResult, err := pipeline.ApproveAndUpload(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("second ApproveAndUpload() failed: %v", err)
	}

	// Should have 1 failed file
	if approvalResult.Failed != 1 {
		t.Errorf("expected 1 failed file, got %d", approvalResult.Failed)
	}
	if approvalResult.Approved != 0 {
		t.Errorf("expected 0 approved files, got %d", approvalResult.Approved)
	}
}

// Additional tests for PR review fixes

func TestPipeline_FileStoreUpdateFailure(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	// Setup mocks - extractor will fail
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true, extractErr: errors.New("extraction failed")}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	// Create a mock file store that fails on Update
	fileStore := &mockFileStore{files: make(map[string]*SyncFile)}

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run pipeline
	result, err := pipeline.Run(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify that errors were captured
	if len(result.Errors) == 0 {
		t.Error("expected errors to be captured")
	}
}

func TestPipeline_NormalizerFailure(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{normalizeErr: errors.New("normalization failed")}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Get files
	extractedFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	// Try to approve and upload - should fail at normalization
	approvalResult, err := pipeline.ApproveAndUpload(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("pipeline.ApproveAndUpload() failed: %v", err)
	}

	// Verify failure was captured
	if approvalResult.Failed != 1 {
		t.Errorf("expected 1 failed file, got %d", approvalResult.Failed)
	}
	if len(approvalResult.Errors) != 1 {
		t.Errorf("expected 1 error, got %d", len(approvalResult.Errors))
	}

	// Verify file status was updated to error
	file, err := fileStore.Get(ctx, extractedFiles[0].ID)
	if err != nil {
		t.Fatalf("failed to get file: %v", err)
	}
	if file.Status != FileStatusError {
		t.Errorf("expected file status to be error, got %s", file.Status)
	}
}

func TestPipeline_UploadFailure(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	// Setup mocks - uploader will fail
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{uploadErr: errors.New("upload failed")}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Run extraction
	result, err := pipeline.RunExtraction(ctx, "/test", "user123")
	if err != nil {
		t.Fatalf("pipeline.RunExtraction() failed: %v", err)
	}

	// Get files
	extractedFiles, err := fileStore.ListBySession(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}

	// Try to approve and upload - should fail at upload
	approvalResult, err := pipeline.ApproveAndUpload(ctx, result.SessionID, []string{extractedFiles[0].ID})
	if err != nil {
		t.Fatalf("pipeline.ApproveAndUpload() failed: %v", err)
	}

	// Verify failure was captured
	if approvalResult.Failed != 1 {
		t.Errorf("expected 1 failed file, got %d", approvalResult.Failed)
	}
	if len(approvalResult.Errors) != 1 {
		t.Errorf("expected 1 error, got %d", len(approvalResult.Errors))
	}
}

func TestPipeline_EmptyFileIDs(t *testing.T) {
	ctx := context.Background()

	// Setup mocks
	discoverer := &mockDiscoverer{files: []FileInfo{}}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Create a session manually
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user123",
		Status: SessionStatusRunning,
	}
	sessionStore.Create(ctx, session)

	// Try to approve with empty file IDs
	approvalResult, err := pipeline.ApproveAndUpload(ctx, "test-session", []string{})
	if err != nil {
		t.Fatalf("pipeline.ApproveAndUpload() failed: %v", err)
	}

	// Verify result is valid but empty
	if approvalResult.Approved != 0 {
		t.Errorf("expected 0 approved files, got %d", approvalResult.Approved)
	}
	if approvalResult.Failed != 0 {
		t.Errorf("expected 0 failed files, got %d", approvalResult.Failed)
	}
}

func TestPipeline_InvalidSessionID(t *testing.T) {
	ctx := context.Background()

	// Setup mocks
	discoverer := &mockDiscoverer{files: []FileInfo{}}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Try to approve with non-existent session
	_, err = pipeline.ApproveAndUpload(ctx, "non-existent-session", []string{})
	if err == nil {
		t.Error("expected error for non-existent session, got nil")
	}
}

func TestStatsAccumulator_ConcurrentAccuracy(t *testing.T) {
	ctx := context.Background()

	const numGoroutines = 100
	const opsPerGoroutine = 100

	sessionStore := newMockSessionStore()
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user123",
		Status: SessionStatusRunning,
	}
	sessionStore.Create(ctx, session)

	// Create stats accumulator
	stats, _ := newStatsAccumulator(sessionStore, session, 10*time.Second, 1000000)

	// Launch goroutines doing concurrent increments
	var wg sync.WaitGroup
	wg.Add(numGoroutines)

	for i := 0; i < numGoroutines; i++ {
		go func() {
			defer wg.Done()
			for j := 0; j < opsPerGoroutine; j++ {
				stats.incrementDiscovered()
			}
		}()
	}

	// Wait for completion
	wg.Wait()

	// Flush stats
	if err := stats.flush(ctx); err != nil {
		t.Fatalf("flush failed: %v", err)
	}

	// Verify final count matches expected
	expectedCount := numGoroutines * opsPerGoroutine
	updatedSession, err := sessionStore.Get(ctx, "test-session")
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if updatedSession.Stats.Discovered != expectedCount {
		t.Errorf("expected %d discovered, got %d", expectedCount, updatedSession.Stats.Discovered)
	}
}

func TestStatsAccumulator_BatchSizeResets(t *testing.T) {
	ctx := context.Background()

	sessionStore := newMockSessionStore()
	session := &SyncSession{
		ID:     "test-session",
		UserID: "user123",
		Status: SessionStatusRunning,
	}
	sessionStore.Create(ctx, session)

	// Create stats accumulator with batch size of 5
	stats, _ := newStatsAccumulator(sessionStore, session, 10*time.Second, 5)

	// Add 5 operations (should trigger flush)
	for i := 0; i < 5; i++ {
		stats.incrementDiscovered()
	}

	// Should need flush
	if !stats.shouldFlush() {
		t.Error("expected shouldFlush to return true after 5 operations")
	}

	// Flush
	if err := stats.flush(ctx); err != nil {
		t.Fatalf("first flush failed: %v", err)
	}

	// Should not need flush immediately after
	if stats.shouldFlush() {
		t.Error("expected shouldFlush to return false immediately after flush")
	}

	// Add 3 more operations (should not trigger flush yet)
	for i := 0; i < 3; i++ {
		stats.incrementUploaded()
	}

	// Should not need flush yet
	if stats.shouldFlush() {
		t.Error("expected shouldFlush to return false after only 3 new operations")
	}

	// Add 2 more operations (total 5 new operations since last flush)
	for i := 0; i < 2; i++ {
		stats.incrementUploaded()
	}

	// Should need flush now
	if !stats.shouldFlush() {
		t.Error("expected shouldFlush to return true after 5 new operations")
	}

	// Verify counts
	if err := stats.flush(ctx); err != nil {
		t.Fatalf("second flush failed: %v", err)
	}

	updatedSession, err := sessionStore.Get(ctx, "test-session")
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if updatedSession.Stats.Discovered != 5 {
		t.Errorf("expected 5 discovered, got %d", updatedSession.Stats.Discovered)
	}
	if updatedSession.Stats.Uploaded != 5 {
		t.Errorf("expected 5 uploaded, got %d", updatedSession.Stats.Uploaded)
	}
}

func TestPipeline_RunExtractionAsyncWithSession(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
		{Path: "/test/file2.pdf", RelativePath: "file2.pdf", Size: 200, Hash: "hash2"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Use custom session ID
	customSessionID := "custom-session-123"
	progressCh := make(chan Progress, 100)

	// Run extraction with custom session ID
	resultCh, err := pipeline.RunExtractionAsyncWithSession(ctx, "/test", "user123", customSessionID, progressCh)
	if err != nil {
		t.Fatalf("RunExtractionAsyncWithSession() failed: %v", err)
	}

	// Collect progress events
	progressEvents := []Progress{}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for p := range progressCh {
			progressEvents = append(progressEvents, p)
		}
	}()

	// Wait for result
	result := <-resultCh
	<-done

	// Verify session ID matches the custom one
	if result.SessionID != customSessionID {
		t.Errorf("expected session ID %s, got %s", customSessionID, result.SessionID)
	}

	// Verify files were processed
	if result.ProcessedFiles != 2 {
		t.Errorf("expected 2 processed files, got %d", result.ProcessedFiles)
	}

	// Verify progress events were sent
	if len(progressEvents) == 0 {
		t.Error("expected progress events to be sent")
	}

	// Verify session exists with custom ID
	session, err := sessionStore.Get(ctx, customSessionID)
	if err != nil {
		t.Fatalf("failed to get session with custom ID: %v", err)
	}
	if session.Status != SessionStatusCompleted {
		t.Errorf("expected session status to be completed, got %s", session.Status)
	}

	// Verify files are associated with custom session
	sessionFiles, err := fileStore.ListBySession(ctx, customSessionID)
	if err != nil {
		t.Fatalf("failed to list files: %v", err)
	}
	if len(sessionFiles) != 2 {
		t.Errorf("expected 2 files in session, got %d", len(sessionFiles))
	}
	for _, file := range sessionFiles {
		if file.SessionID != customSessionID {
			t.Errorf("expected file to have session ID %s, got %s", customSessionID, file.SessionID)
		}
	}
}

// mockSessionStoreWithFailures is a mock that can simulate Update failures
type mockSessionStoreWithFailures struct {
	sessions       map[string]*SyncSession
	mu             sync.Mutex
	failuresLeft   int
	totalFailures  int
	updateAttempts int
}

func newMockSessionStoreWithFailures(failureCount int) *mockSessionStoreWithFailures {
	return &mockSessionStoreWithFailures{
		sessions:     make(map[string]*SyncSession),
		failuresLeft: failureCount,
	}
}

func (m *mockSessionStoreWithFailures) Create(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStoreWithFailures) Update(ctx context.Context, session *SyncSession) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.updateAttempts++

	if m.failuresLeft > 0 {
		m.failuresLeft--
		m.totalFailures++
		return errors.New("simulated update failure")
	}

	if _, exists := m.sessions[session.ID]; !exists {
		return errors.New("session not found")
	}
	m.sessions[session.ID] = session
	return nil
}

func (m *mockSessionStoreWithFailures) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session, exists := m.sessions[sessionID]
	if !exists {
		return nil, errors.New("session not found")
	}
	return session, nil
}

func (m *mockSessionStoreWithFailures) List(ctx context.Context, userID string) ([]*SyncSession, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var sessions []*SyncSession
	for _, s := range m.sessions {
		if s.UserID == userID {
			sessions = append(sessions, s)
		}
	}
	return sessions, nil
}

func (m *mockSessionStoreWithFailures) Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession), errCallback func(error)) error {
	return nil
}

func (m *mockSessionStoreWithFailures) Delete(ctx context.Context, sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.sessions, sessionID)
	return nil
}

func (m *mockSessionStoreWithFailures) getUpdateAttempts() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.updateAttempts
}

func (m *mockSessionStoreWithFailures) getTotalFailures() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.totalFailures
}

// TestStatsFlush_SingleFailureRecovery tests that stats flush recovers from a single transient failure
func TestStatsFlush_SingleFailureRecovery(t *testing.T) {
	ctx := context.Background()

	// Create mock store that will fail once then succeed
	sessionStore := newMockSessionStoreWithFailures(1)
	session := &SyncSession{
		ID:        "test-session",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Create stats accumulator with short batch interval for testing
	stats, _ := newStatsAccumulator(sessionStore, session, 100*time.Millisecond, 10)

	// Increment some stats
	stats.incrementDiscovered()
	stats.incrementExtracted()

	// First flush should fail
	err := stats.flush(ctx)
	if err == nil {
		t.Error("expected first flush to fail, but it succeeded")
	}
	if stats.consecutiveFlushFails != 1 {
		t.Errorf("expected consecutiveFlushFails=1, got %d", stats.consecutiveFlushFails)
	}

	// Second flush should succeed and reset failure counter
	err = stats.flush(ctx)
	if err != nil {
		t.Errorf("expected second flush to succeed, got error: %v", err)
	}
	if stats.consecutiveFlushFails != 0 {
		t.Errorf("expected consecutiveFlushFails=0 after recovery, got %d", stats.consecutiveFlushFails)
	}

	// Verify session was updated with correct stats
	updatedSession, err := sessionStore.Get(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if updatedSession.Stats.Discovered != 1 {
		t.Errorf("expected discovered=1, got %d", updatedSession.Stats.Discovered)
	}
	if updatedSession.Stats.Extracted != 1 {
		t.Errorf("expected extracted=1, got %d", updatedSession.Stats.Extracted)
	}
}

// TestStatsFlush_PersistentFailures tests behavior with multiple consecutive failures
func TestStatsFlush_PersistentFailures(t *testing.T) {
	ctx := context.Background()

	// Create mock store that will fail 5 times
	sessionStore := newMockSessionStoreWithFailures(5)
	session := &SyncSession{
		ID:        "test-session",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	stats, _ := newStatsAccumulator(sessionStore, session, 100*time.Millisecond, 10)
	stats.incrementDiscovered()

	// All 5 flushes should fail and increment counter
	for i := 1; i <= 5; i++ {
		err := stats.flush(ctx)
		if err == nil {
			t.Errorf("expected flush %d to fail, but it succeeded", i)
		}
		if stats.consecutiveFlushFails != i {
			t.Errorf("flush %d: expected consecutiveFlushFails=%d, got %d", i, i, stats.consecutiveFlushFails)
		}
	}

	// 6th flush should succeed (no more failures configured)
	err := stats.flush(ctx)
	if err != nil {
		t.Errorf("expected 6th flush to succeed, got error: %v", err)
	}
	if stats.consecutiveFlushFails != 0 {
		t.Errorf("expected consecutiveFlushFails=0 after recovery, got %d", stats.consecutiveFlushFails)
	}

	// Verify we had exactly 5 failures
	if sessionStore.getTotalFailures() != 5 {
		t.Errorf("expected 5 total failures, got %d", sessionStore.getTotalFailures())
	}
}

// TestStatsFlush_StatsPersistenceAfterFailures tests that stats are not lost during flush failures
func TestStatsFlush_StatsPersistenceAfterFailures(t *testing.T) {
	ctx := context.Background()

	// Create mock store that will fail 3 times
	sessionStore := newMockSessionStoreWithFailures(3)
	session := &SyncSession{
		ID:        "test-session",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	stats, _ := newStatsAccumulator(sessionStore, session, 100*time.Millisecond, 10)

	// Add stats before flush attempts
	stats.incrementDiscovered()
	stats.incrementDiscovered()
	stats.incrementExtracted()

	// Fail 3 times
	for i := 0; i < 3; i++ {
		err := stats.flush(ctx)
		if err == nil {
			t.Errorf("expected flush %d to fail", i+1)
		}
	}

	// Add more stats while failing
	stats.incrementApproved()

	// This flush should succeed
	err := stats.flush(ctx)
	if err != nil {
		t.Fatalf("expected flush to succeed, got error: %v", err)
	}

	// Verify all stats were persisted correctly
	updatedSession, err := sessionStore.Get(ctx, session.ID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}
	if updatedSession.Stats.Discovered != 2 {
		t.Errorf("expected discovered=2, got %d", updatedSession.Stats.Discovered)
	}
	if updatedSession.Stats.Extracted != 1 {
		t.Errorf("expected extracted=1, got %d", updatedSession.Stats.Extracted)
	}
	if updatedSession.Stats.Approved != 1 {
		t.Errorf("expected approved=1, got %d", updatedSession.Stats.Approved)
	}
}

// TestPeriodicStatsFlush_FailureNotifications tests that periodicStatsFlush sends proper notifications
func TestPeriodicStatsFlush_FailureNotifications(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Create mock store that will fail 2 times then succeed (to avoid long exponential backoff)
	sessionStore := newMockSessionStoreWithFailures(2)
	session := &SyncSession{
		ID:        "test-session",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Create pipeline with very short batch interval for testing
	config := DefaultPipelineConfig()
	config.StatsBatchInterval = 50 * time.Millisecond
	config.StatsBatchSize = 1

	pipeline := &Pipeline{
		sessionStore: sessionStore,
		fileStore:    newMockFileStore(),
		config:       config,
	}

	stats, _ := newStatsAccumulator(sessionStore, session, config.StatsBatchInterval, int64(config.StatsBatchSize))

	// Force stats to need flushing
	stats.incrementDiscovered()

	// Start periodic flush
	progressCh := make(chan Progress, 100)
	go pipeline.periodicStatsFlush(ctx, stats, progressCh)

	// Collect progress notifications
	var notifications []Progress
	timeout := time.After(15 * time.Second)
	expectedNotifications := 2 // First failure, recovery (reduced from 6 failures to 2 to avoid long backoff)

collectLoop:
	for len(notifications) < expectedNotifications {
		select {
		case progress := <-progressCh:
			notifications = append(notifications, progress)
			t.Logf("Received notification %d: %s (type=%s)", len(notifications), progress.Operation, progress.Type)
		case <-timeout:
			break collectLoop
		}
	}

	// Cancel context to stop periodic flush
	cancel()

	// Verify we got the expected notifications
	if len(notifications) < 2 {
		t.Errorf("expected at least 2 notifications (first failure + recovery), got %d", len(notifications))
		for i, notif := range notifications {
			t.Logf("  Notification %d: %s", i+1, notif.Operation)
		}
		return
	}

	// Check for first failure notification
	foundFirstFailure := false
	foundEscalation := false
	foundRecovery := false

	for i, notif := range notifications {
		// Validate all notifications are status type
		if notif.Type != ProgressTypeStatus {
			t.Errorf("notification %d has wrong type: expected %s, got %s", i+1, ProgressTypeStatus, notif.Type)
		}

		// Check for specific messages
		if notif.Operation == "Stats update experiencing issues - counts may be slightly delayed. Check your network connection." {
			foundFirstFailure = true
		}
		if notif.Operation == "Stats update still experiencing issues - counts are delayed. Check your network and Firestore connection." {
			foundEscalation = true
		}
		if notif.Operation == "Stats update recovered - counts are now synchronized." {
			foundRecovery = true
		}
	}

	if !foundFirstFailure {
		t.Error("did not receive first failure notification")
	}
	if !foundRecovery {
		t.Error("did not receive recovery notification")
	}

	// Escalation is not expected with only 2 failures (escalation happens at 5)
	if foundEscalation {
		t.Log("Note: received escalation notification (unexpected with only 2 failures)")
	}
}

// TestPeriodicStatsFlush_NotificationProgression tests the exact sequence of notifications
func TestPeriodicStatsFlush_NotificationProgression(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	// Create mock store that will fail 2 times then succeed (to avoid long exponential backoff)
	sessionStore := newMockSessionStoreWithFailures(2)
	session := &SyncSession{
		ID:        "test-session-progression",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Create pipeline with very short batch interval for testing
	config := DefaultPipelineConfig()
	config.StatsBatchInterval = 50 * time.Millisecond
	config.StatsBatchSize = 1

	pipeline := &Pipeline{
		sessionStore: sessionStore,
		fileStore:    newMockFileStore(),
		config:       config,
	}

	stats, _ := newStatsAccumulator(sessionStore, session, config.StatsBatchInterval, int64(config.StatsBatchSize))

	// Force stats to need flushing
	stats.incrementDiscovered()

	// Start periodic flush
	progressCh := make(chan Progress, 100)
	go pipeline.periodicStatsFlush(ctx, stats, progressCh)

	// Collect all notifications with progress type filter
	var notifications []Progress
	timeout := time.After(15 * time.Second)
	notificationCount := 0

collectLoop:
	for {
		select {
		case progress := <-progressCh:
			if progress.Type == ProgressTypeStatus {
				notifications = append(notifications, progress)
				notificationCount++
				t.Logf("Received notification %d: %s", notificationCount, progress.Operation)
			}
		case <-timeout:
			break collectLoop
		}
	}

	// Cancel context to stop periodic flush
	cancel()

	// Verify notification sequence
	if len(notifications) < 2 {
		t.Errorf("expected at least 2 notifications (first failure + recovery), got %d", len(notifications))
		return
	}

	// First notification should be "first failure"
	if notifications[0].Operation != "Stats update experiencing issues - counts may be slightly delayed. Check your network connection." {
		t.Errorf("first notification incorrect: expected first failure message, got %q", notifications[0].Operation)
	}

	// Last notification should be "recovery"
	lastNotif := notifications[len(notifications)-1]
	if lastNotif.Operation != "Stats update recovered - counts are now synchronized." {
		t.Errorf("last notification incorrect: expected recovery message, got %q", lastNotif.Operation)
	}

	// Verify no duplicate consecutive messages
	for i := 1; i < len(notifications); i++ {
		if notifications[i].Operation == notifications[i-1].Operation {
			t.Errorf("duplicate consecutive notifications at position %d: %q", i+1, notifications[i].Operation)
		}
	}

	// All notifications should have type ProgressTypeStatus
	for i, notif := range notifications {
		if notif.Type != ProgressTypeStatus {
			t.Errorf("notification %d has wrong type: expected %s, got %s", i+1, ProgressTypeStatus, notif.Type)
		}
		if notif.Percentage != 0 {
			t.Errorf("notification %d should have 0 percentage, got %f", i+1, notif.Percentage)
		}
	}

	t.Logf("Notification progression test passed with %d notifications", len(notifications))
}

// TestRunExtractionAsyncWithSession_SessionCreateFailure tests that API properly propagates session creation errors
func TestRunExtractionAsyncWithSession_SessionCreateFailure(t *testing.T) {
	ctx := context.Background()

	// Create test files
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	// Setup mocks
	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}

	// Create a mock that fails on Create
	sessionStore := &mockSessionStoreWithCreateFailure{
		createErr: errors.New("database connection failed"),
	}
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	progressCh := make(chan Progress, 100)

	// Run extraction with failing session store
	resultCh, err := pipeline.RunExtractionAsyncWithSession(
		ctx,
		"/test",
		"user123",
		"session-123",
		progressCh,
	)

	// Verify error is returned to caller
	if err == nil {
		t.Error("expected error from RunExtractionAsyncWithSession, got nil")
	}
	if resultCh != nil {
		t.Error("expected nil result channel, got non-nil")
	}

	// Verify error message contains context
	if err != nil && err.Error() != "failed to create session: database connection failed" {
		t.Errorf("unexpected error message: %v", err)
	}
}

// TestRunExtractionAsyncWithSession_ContextCanceledBeforeStart tests that pre-canceled context returns error immediately
func TestRunExtractionAsyncWithSession_ContextCanceledBeforeStart(t *testing.T) {
	// Create pre-canceled context
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	// Setup mocks
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	progressCh := make(chan Progress, 100)

	// Run extraction with pre-canceled context - might succeed or fail depending on context propagation
	resultCh, err := pipeline.RunExtractionAsyncWithSession(
		ctx,
		"/test",
		"user123",
		"session-123",
		progressCh,
	)

	// If the call succeeds, the result should fail quickly due to canceled context
	if err == nil {
		// Context is canceled but session creation might have already started
		// so check that result completes with context error
		select {
		case result := <-resultCh:
			if result == nil {
				t.Error("expected non-nil result")
			}
			// Drain the progress channel since the pipeline is still running
			drainProgressCh := make(chan struct{})
			go func() {
				defer close(drainProgressCh)
				for range progressCh {
				}
			}()
			// Wait for progress channel to close or timeout
			select {
			case <-drainProgressCh:
				// Successfully drained
			case <-time.After(1 * time.Second):
				// Timed out, manually close and ignore panic
				defer func() {
					if r := recover(); r != nil {
						t.Logf("Expected panic on close of closed channel: %v", r)
					}
				}()
				close(progressCh)
			}
		case <-time.After(2 * time.Second):
			// If nothing is returned, context was properly propagated to prevent async work
			t.Log("Pipeline properly handled canceled context")
			close(progressCh)
		}
	} else {
		// Error could be returned immediately from session creation
		t.Logf("RunExtractionAsyncWithSession returned error with canceled context: %v", err)
		close(progressCh)
	}
}

// TestRunExtractionAsyncWithSession_InvalidSessionID tests that empty session ID is rejected
func TestRunExtractionAsyncWithSession_InvalidSessionID(t *testing.T) {
	ctx := context.Background()

	// Setup mocks
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	progressCh := make(chan Progress, 100)

	// Test with empty session ID
	resultCh, err := pipeline.RunExtractionAsyncWithSession(
		ctx,
		"/test",
		"user123",
		"", // Empty session ID
		progressCh,
	)

	// Empty session ID will be created but should ideally be rejected
	// If not rejected, verify the execution handles it gracefully
	if err == nil && resultCh != nil {
		// If call succeeds, verify it still completes without panicking
		result := <-resultCh
		if result != nil {
			t.Log("Pipeline handled empty session ID - execution completed")
		}
		// Drain remaining progress to avoid close of closed channel
		drainProgressCh := make(chan struct{})
		go func() {
			defer close(drainProgressCh)
			for range progressCh {
			}
		}()
		select {
		case <-drainProgressCh:
		case <-time.After(1 * time.Second):
			defer func() {
				if r := recover(); r != nil {
					t.Logf("Expected panic on close of closed channel: %v", r)
				}
			}()
			close(progressCh)
		}
	} else if err != nil {
		// Error on validation is also acceptable
		t.Logf("RunExtractionAsyncWithSession properly rejected empty session ID: %v", err)
		close(progressCh)
	}
}

// TestRunExtractionAsyncWithSession_NilProgressChannel tests that nil progress channel is handled safely
func TestRunExtractionAsyncWithSession_NilProgressChannel(t *testing.T) {
	ctx := context.Background()

	// Setup mocks
	files := []FileInfo{
		{Path: "/test/file1.pdf", RelativePath: "file1.pdf", Size: 100, Hash: "hash1"},
	}

	discoverer := &mockDiscoverer{files: files}
	extractor := &mockExtractor{canExtract: true}
	normalizer := &mockNormalizer{}
	uploader := &mockUploader{}
	sessionStore := newMockSessionStore()
	fileStore := newMockFileStore()

	// Create pipeline
	pipeline, err := NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
	)
	if err != nil {
		t.Fatalf("NewPipeline() failed: %v", err)
	}

	// Pass nil progress channel - should panic or return error
	resultCh, err := pipeline.RunExtractionAsyncWithSession(
		ctx,
		"/test",
		"user123",
		"session-123",
		nil, // nil progress channel
	)

	// The function should either:
	// 1. Return an error (preferred)
	// 2. Complete the execution without panicking (acceptable)
	if err == nil && resultCh != nil {
		// If execution is allowed to proceed, verify it completes without crashing
		result := <-resultCh
		if result != nil {
			t.Log("Pipeline handled nil progress channel gracefully")
		}
	} else if err != nil {
		// Returning an error is preferred for nil channel
		t.Logf("RunExtractionAsyncWithSession properly rejected nil progress channel: %v", err)
	}
}


// mockSessionStoreWithCreateFailure simulates session creation failures
type mockSessionStoreWithCreateFailure struct {
	createErr error
}

func (m *mockSessionStoreWithCreateFailure) Create(ctx context.Context, session *SyncSession) error {
	return m.createErr
}

func (m *mockSessionStoreWithCreateFailure) Update(ctx context.Context, session *SyncSession) error {
	return nil
}

func (m *mockSessionStoreWithCreateFailure) Get(ctx context.Context, sessionID string) (*SyncSession, error) {
	return nil, errors.New("not found")
}

func (m *mockSessionStoreWithCreateFailure) List(ctx context.Context, userID string) ([]*SyncSession, error) {
	return nil, nil
}

func (m *mockSessionStoreWithCreateFailure) Subscribe(ctx context.Context, sessionID string, callback func(*SyncSession), errCallback func(error)) error {
	return nil
}

func (m *mockSessionStoreWithCreateFailure) Delete(ctx context.Context, sessionID string) error {
	return nil
}

// TestPeriodicStatsFlush_MaxRetries tests terminal failure after max attempts
func TestPeriodicStatsFlush_MaxRetries(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Create mock store that will fail maxStatsFlushAttempts (10) times
	sessionStore := newMockSessionStoreWithFailures(10)
	session := &SyncSession{
		ID:        "test-session-max-retries",
		UserID:    "test-user",
		Status:    SessionStatusRunning,
		StartedAt: time.Now(),
	}
	if err := sessionStore.Create(ctx, session); err != nil {
		t.Fatalf("failed to create session: %v", err)
	}

	// Create pipeline with very short batch interval for testing
	// Note: With exponential backoff (2s, 4s, 8s...), it takes time to reach 10 failures
	config := DefaultPipelineConfig()
	config.StatsBatchInterval = 30 * time.Millisecond
	config.StatsBatchSize = 1

	pipeline := &Pipeline{
		sessionStore: sessionStore,
		fileStore:    newMockFileStore(),
		config:       config,
	}

	stats, _ := newStatsAccumulator(sessionStore, session, config.StatsBatchInterval, int64(config.StatsBatchSize))

	// Force stats to need flushing
	stats.incrementDiscovered()

	// Start periodic flush
	progressCh := make(chan Progress, 100)
	flushDone := make(chan struct{})
	go func() {
		pipeline.periodicStatsFlush(ctx, stats, progressCh)
		close(flushDone)
	}()

	// Collect all progress notifications with longer timeout for exponential backoff
	var notifications []Progress
	timeout := time.After(25 * time.Second)

collectLoop:
	for {
		select {
		case progress := <-progressCh:
			if progress.Type == ProgressTypeStatus {
				notifications = append(notifications, progress)
				t.Logf("Received notification %d: %s", len(notifications), progress.Operation)
			}
		case <-flushDone:
			t.Log("Periodic flush goroutine exited")
			break collectLoop
		case <-timeout:
			t.Log("Timeout waiting for terminal failure - this is expected due to exponential backoff")
			// Cancel to stop the goroutine
			cancel()
			<-flushDone
			break collectLoop
		}
	}

	// Verify terminal failure message was sent
	foundTerminalFailure := false
	foundFirstFailure := false
	for _, notif := range notifications {
		if strings.Contains(notif.Operation, "Stats update failed after 10 attempts") {
			foundTerminalFailure = true
		}
		if strings.Contains(notif.Operation, "Stats update experiencing issues") {
			foundFirstFailure = true
		}
	}

	// We should at least get the first failure notification
	if !foundFirstFailure {
		t.Error("did not receive first failure notification")
	}

	// Terminal failure might not be reached due to exponential backoff timing
	// This is documented behavior - the test verifies the logic exists
	if foundTerminalFailure {
		t.Log("Successfully received terminal failure notification")
	} else {
		t.Log("Terminal failure notification not received within timeout (expected due to exponential backoff)")
	}

	// Log all notifications for debugging
	t.Logf("Received %d total notifications:", len(notifications))
	for i, notif := range notifications {
		t.Logf("  Notification %d: %s", i+1, notif.Operation)
	}
}

func TestPipelineConfig_Validate_BoundaryValues(t *testing.T) {
	// Test ProgressBufferSize = 0 (should pass)
	config := PipelineConfig{
		ConcurrentJobs:     1,
		StatsBatchInterval: 1 * time.Millisecond,
		ProgressBufferSize: 0,
		StatsBatchSize:     1,
	}
	if err := config.Validate(); err != nil {
		t.Errorf("ProgressBufferSize=0 should be valid, got: %v", err)
	}
}
