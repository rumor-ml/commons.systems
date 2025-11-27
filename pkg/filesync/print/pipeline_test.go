package print

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	"github.com/commons-systems/filesync"
)

// getTestGCSClient creates a GCS client for testing
func getTestGCSClient(t *testing.T) *storage.Client {
	t.Helper()

	if os.Getenv("STORAGE_EMULATOR_HOST") == "" {
		t.Skip("STORAGE_EMULATOR_HOST not set, skipping integration test")
	}

	ctx := context.Background()
	client, err := storage.NewClient(ctx)
	if err != nil {
		t.Fatalf("failed to create GCS client: %v", err)
	}

	return client
}

// getTestFirestoreClient creates a Firestore client for testing
func getTestFirestoreClient(t *testing.T) *firestore.Client {
	t.Helper()

	if os.Getenv("FIRESTORE_EMULATOR_HOST") == "" {
		t.Skip("FIRESTORE_EMULATOR_HOST not set, skipping integration test")
	}

	ctx := context.Background()
	client, err := firestore.NewClient(ctx, "test-project")
	if err != nil {
		t.Fatalf("failed to create Firestore client: %v", err)
	}

	return client
}

// createTestBucket creates a test bucket in the GCS emulator
func createTestBucket(t *testing.T, client *storage.Client, bucketName string) {
	t.Helper()
	ctx := context.Background()

	bucket := client.Bucket(bucketName)
	if err := bucket.Create(ctx, "test-project", nil); err != nil {
		// Bucket might already exist, which is fine
		t.Logf("note: bucket creation returned: %v", err)
	}
}

// createTestPrintFiles creates a test directory structure with print files
func createTestPrintFiles(t *testing.T) string {
	t.Helper()
	tmpDir := t.TempDir()

	files := map[string]string{
		"book1.pdf":  "This is a test PDF book",
		"book2.epub": "This is a test EPUB book",
		"comic.cbz":  "This is a test comic",
		"nested/book3.pdf": "This is a nested PDF book",
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

	return tmpDir
}

func TestNewPrintPipeline_CreatesPipeline(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx := context.Background()
	bucketName := "test-print-pipeline"

	pipeline, err := NewPrintPipeline(ctx, gcsClient, firestoreClient, bucketName)
	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	if pipeline == nil {
		t.Fatal("pipeline should not be nil")
	}
}

func TestNewPrintPipeline_WithOptions(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx := context.Background()
	bucketName := "test-print-pipeline-opts"

	// Create pipeline with custom options
	pipeline, err := NewPrintPipeline(
		ctx,
		gcsClient,
		firestoreClient,
		bucketName,
		filesync.WithConcurrentJobs(4),
		filesync.WithProgressBufferSize(50),
	)

	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	if pipeline == nil {
		t.Fatal("pipeline should not be nil")
	}
}

func TestPrintPipeline_Integration_ProcessFiles(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx := context.Background()
	bucketName := "test-print-integration"

	// Create test bucket
	createTestBucket(t, gcsClient, bucketName)

	// Create test files
	testDir := createTestPrintFiles(t)

	// Create pipeline
	pipeline, err := NewPrintPipeline(
		ctx,
		gcsClient,
		firestoreClient,
		bucketName,
		filesync.WithConcurrentJobs(2),
	)
	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	// Run pipeline
	result, err := pipeline.Run(ctx, testDir, "test-user")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify results
	if result.TotalFiles != 4 {
		t.Errorf("expected 4 total files, got %d", result.TotalFiles)
	}

	// At least some files should be processed (might skip duplicates)
	if result.ProcessedFiles == 0 && result.SkippedFiles == 0 {
		t.Error("expected at least some files to be processed or skipped")
	}

	if len(result.Errors) > 0 {
		t.Logf("processing errors: %d", len(result.Errors))
		for _, fileErr := range result.Errors {
			t.Logf("  - %s: %v", fileErr.Stage, fileErr.Error)
		}
	}

	// Verify session was created in Firestore
	sessionStore := filesync.NewFirestoreSessionStore(firestoreClient)
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if session.Status != filesync.SessionStatusCompleted && session.Status != filesync.SessionStatusFailed {
		t.Errorf("expected session to be completed or failed, got %s", session.Status)
	}

	if session.Stats.Discovered != result.TotalFiles {
		t.Errorf("session stats discovered = %d, want %d", session.Stats.Discovered, result.TotalFiles)
	}
}

func TestPrintPipeline_Integration_RunAsync(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx := context.Background()
	bucketName := "test-print-async"

	// Create test bucket
	createTestBucket(t, gcsClient, bucketName)

	// Create test files
	testDir := createTestPrintFiles(t)

	// Create pipeline
	pipeline, err := NewPrintPipeline(
		ctx,
		gcsClient,
		firestoreClient,
		bucketName,
	)
	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	// Run pipeline asynchronously
	start := time.Now()
	resultCh, progressCh, err := pipeline.RunAsync(ctx, testDir, "test-user-async")
	callDuration := time.Since(start)

	if err != nil {
		t.Fatalf("pipeline.RunAsync() failed: %v", err)
	}

	// Should return immediately
	if callDuration > 100*time.Millisecond {
		t.Errorf("RunAsync took too long to return: %v", callDuration)
	}

	// Collect progress updates
	var progressUpdates int
	go func() {
		for range progressCh {
			progressUpdates++
		}
	}()

	// Wait for result
	result := <-resultCh

	// Give progress channel time to drain
	time.Sleep(100 * time.Millisecond)

	t.Logf("received %d progress updates", progressUpdates)

	// Verify results
	if result.TotalFiles != 4 {
		t.Errorf("expected 4 total files, got %d", result.TotalFiles)
	}

	if result.ProcessedFiles == 0 && result.SkippedFiles == 0 {
		t.Error("expected at least some files to be processed or skipped")
	}
}

func TestPrintPipeline_Integration_ContextCancellation(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx, cancel := context.WithCancel(context.Background())
	bucketName := "test-print-cancel"

	// Create test bucket
	createTestBucket(t, gcsClient, bucketName)

	// Create test files
	testDir := createTestPrintFiles(t)

	// Create pipeline
	pipeline, err := NewPrintPipeline(
		ctx,
		gcsClient,
		firestoreClient,
		bucketName,
		filesync.WithConcurrentJobs(1), // Single job to make cancellation timing more predictable
	)
	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	// Cancel context after a short delay
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	// Run pipeline (should be cancelled mid-execution)
	result, err := pipeline.Run(ctx, testDir, "test-user-cancel")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Result should show incomplete processing
	t.Logf("processed %d/%d files before cancellation", result.ProcessedFiles, result.TotalFiles)

	// We should have captured some work (might process 0-4 files depending on timing)
	if result.TotalFiles == 0 {
		t.Error("expected at least discovery to start before cancellation")
	}
}

func TestPrintPipeline_Integration_EmptyDirectory(t *testing.T) {
	gcsClient := getTestGCSClient(t)
	firestoreClient := getTestFirestoreClient(t)
	defer gcsClient.Close()
	defer firestoreClient.Close()

	ctx := context.Background()
	bucketName := "test-print-empty"

	// Create test bucket
	createTestBucket(t, gcsClient, bucketName)

	// Create empty test directory
	testDir := t.TempDir()

	// Create pipeline
	pipeline, err := NewPrintPipeline(
		ctx,
		gcsClient,
		firestoreClient,
		bucketName,
	)
	if err != nil {
		t.Fatalf("NewPrintPipeline() failed: %v", err)
	}

	// Run pipeline on empty directory
	result, err := pipeline.Run(ctx, testDir, "test-user-empty")
	if err != nil {
		t.Fatalf("pipeline.Run() failed: %v", err)
	}

	// Verify results
	if result.TotalFiles != 0 {
		t.Errorf("expected 0 total files, got %d", result.TotalFiles)
	}

	if result.ProcessedFiles != 0 {
		t.Errorf("expected 0 processed files, got %d", result.ProcessedFiles)
	}

	// Session should be marked as failed (no files processed)
	sessionStore := filesync.NewFirestoreSessionStore(firestoreClient)
	session, err := sessionStore.Get(ctx, result.SessionID)
	if err != nil {
		t.Fatalf("failed to get session: %v", err)
	}

	if session.Status != filesync.SessionStatusFailed {
		t.Errorf("expected session status to be failed for empty directory, got %s", session.Status)
	}
}
