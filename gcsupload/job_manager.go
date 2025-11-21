package gcsupload

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	"github.com/google/uuid"
)

// JobManager manages upload jobs
type JobManager struct {
	FirestoreClient *firestore.Client
	storageClient   *storage.Client
	projectID       string
	mu              sync.RWMutex
	activeJobs      map[string]*jobExecution
}

// jobExecution represents a running job
type jobExecution struct {
	job      *UploadJob
	config   *UploadConfig
	cancelFn context.CancelFunc
	files    map[string]*FileInfo
}

// NewJobManager creates a new JobManager
func NewJobManager(ctx context.Context, projectID string) (*JobManager, error) {
	firestoreClient, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("failed to create Firestore client: %w", err)
	}

	storageClient, err := storage.NewClient(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to create Storage client: %w", err)
	}

	return &JobManager{
		FirestoreClient: firestoreClient,
		storageClient:   storageClient,
		projectID:       projectID,
		activeJobs:      make(map[string]*jobExecution),
	}, nil
}

// Close closes the JobManager and its clients
func (jm *JobManager) Close() error {
	jm.mu.Lock()
	defer jm.mu.Unlock()

	// Cancel all active jobs
	for _, exec := range jm.activeJobs {
		if exec.cancelFn != nil {
			exec.cancelFn()
		}
	}

	var errs []error
	if err := jm.FirestoreClient.Close(); err != nil {
		errs = append(errs, err)
	}
	if err := jm.storageClient.Close(); err != nil {
		errs = append(errs, err)
	}

	if len(errs) > 0 {
		return fmt.Errorf("errors closing clients: %v", errs)
	}
	return nil
}

// CreateJob creates a new upload job
func (jm *JobManager) CreateJob(ctx context.Context, config *UploadConfig) (*UploadJob, error) {
	job := &UploadJob{
		ID:          uuid.New().String(),
		Name:        config.JobName,
		BasePath:    config.BasePath,
		GCSBucket:   config.GCSBucket,
		GCSBasePath: config.GCSBasePath,
		Status:      JobStatusPending,
		CreatedAt:   time.Now(),
		UpdatedAt:   time.Now(),
	}

	// Save job to Firestore
	_, err := jm.FirestoreClient.Collection("upload_jobs").Doc(job.ID).Set(ctx, job)
	if err != nil {
		return nil, fmt.Errorf("failed to create job in Firestore: %w", err)
	}

	return job, nil
}

// StartJob starts an upload job
func (jm *JobManager) StartJob(ctx context.Context, jobID string, config *UploadConfig) error {
	// Get job from Firestore
	doc, err := jm.FirestoreClient.Collection("upload_jobs").Doc(jobID).Get(ctx)
	if err != nil {
		return fmt.Errorf("failed to get job: %w", err)
	}

	var job UploadJob
	if err := doc.DataTo(&job); err != nil {
		return fmt.Errorf("failed to parse job: %w", err)
	}

	// Update status to running
	job.Status = JobStatusRunning
	job.UpdatedAt = time.Now()
	_, err = jm.FirestoreClient.Collection("upload_jobs").Doc(jobID).Set(ctx, job)
	if err != nil {
		return fmt.Errorf("failed to update job status: %w", err)
	}

	// Create job execution context
	jobCtx, cancelFn := context.WithCancel(context.Background())
	exec := &jobExecution{
		job:      &job,
		config:   config,
		cancelFn: cancelFn,
		files:    make(map[string]*FileInfo),
	}

	jm.mu.Lock()
	jm.activeJobs[jobID] = exec
	jm.mu.Unlock()

	// Start job in background
	go jm.runJob(jobCtx, exec)

	return nil
}

// runJob executes the upload job
func (jm *JobManager) runJob(ctx context.Context, exec *jobExecution) {
	defer func() {
		jm.mu.Lock()
		delete(jm.activeJobs, exec.job.ID)
		jm.mu.Unlock()
	}()

	// Discover files
	files, err := exec.config.FileDiscoverer.Discover(ctx, exec.job.BasePath)
	if err != nil {
		jm.failJob(ctx, exec, fmt.Sprintf("file discovery failed: %v", err))
		return
	}

	exec.job.TotalFiles = len(files)
	jm.updateJob(ctx, exec.job)

	// Process each file
	for _, filePath := range files {
		select {
		case <-ctx.Done():
			jm.cancelJob(ctx, exec)
			return
		default:
		}

		if err := jm.processFile(ctx, exec, filePath); err != nil {
			log.Printf("Error processing file %s: %v", filePath, err)
		}
	}

	// Mark job as completed
	exec.job.Status = JobStatusCompleted
	now := time.Now()
	exec.job.CompletedAt = &now
	exec.job.UpdatedAt = now
	jm.updateJob(ctx, exec.job)
}

// processFile processes a single file
func (jm *JobManager) processFile(ctx context.Context, exec *jobExecution, filePath string) error {
	fileInfo := &FileInfo{
		ID:           uuid.New().String(),
		LocalPath:    filePath,
		FileName:     filepath.Base(filePath),
		Status:       FileStatusDiscovered,
		Logs:         []string{},
		DiscoveredAt: time.Now(),
		UpdatedAt:    time.Now(),
	}

	// Get file size
	stat, err := os.Stat(filePath)
	if err != nil {
		fileInfo.Status = FileStatusFailed
		fileInfo.Error = fmt.Sprintf("failed to stat file: %v", err)
		jm.saveFileInfo(ctx, exec.job.ID, fileInfo)
		exec.job.FailedFiles++
		jm.updateJob(ctx, exec.job)
		return err
	}
	fileInfo.FileSize = stat.Size()

	// Save discovered file
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	// Extract metadata
	fileInfo.Status = FileStatusProcessing
	fileInfo.UpdatedAt = time.Now()
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	metadata, logs, err := exec.config.MetadataExtractor.Extract(ctx, filePath)
	fileInfo.Logs = append(fileInfo.Logs, logs...)
	if err != nil {
		fileInfo.Status = FileStatusFailed
		fileInfo.Error = fmt.Sprintf("metadata extraction failed: %v", err)
		fileInfo.UpdatedAt = time.Now()
		jm.saveFileInfo(ctx, exec.job.ID, fileInfo)
		exec.job.FailedFiles++
		jm.updateJob(ctx, exec.job)
		return err
	}
	fileInfo.Metadata = metadata
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	// Check for duplicates
	isDup, err := exec.config.DuplicateDetector.IsDuplicate(ctx, metadata)
	if err != nil {
		log.Printf("Warning: duplicate detection failed for %s: %v", filePath, err)
	} else if isDup {
		fileInfo.Status = FileStatusSkipped
		fileInfo.Logs = append(fileInfo.Logs, "File already exists in GCS, skipping")
		fileInfo.UpdatedAt = time.Now()
		jm.saveFileInfo(ctx, exec.job.ID, fileInfo)
		exec.job.SkippedFiles++
		exec.job.ProcessedFiles++
		jm.updateJob(ctx, exec.job)
		return nil
	}

	// Generate normalized path
	gcsPath, err := exec.config.PathNormalizer.Normalize(metadata, fileInfo.FileName)
	if err != nil {
		fileInfo.Status = FileStatusFailed
		fileInfo.Error = fmt.Sprintf("path normalization failed: %v", err)
		fileInfo.UpdatedAt = time.Now()
		jm.saveFileInfo(ctx, exec.job.ID, fileInfo)
		exec.job.FailedFiles++
		jm.updateJob(ctx, exec.job)
		return err
	}
	fileInfo.GCSPath = filepath.Join(exec.job.GCSBasePath, gcsPath)
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	// Upload to GCS
	fileInfo.Status = FileStatusUploading
	fileInfo.UpdatedAt = time.Now()
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	if err := jm.uploadToGCS(ctx, exec.job.GCSBucket, fileInfo.GCSPath, filePath, fileInfo); err != nil {
		fileInfo.Status = FileStatusFailed
		fileInfo.Error = fmt.Sprintf("upload failed: %v", err)
		fileInfo.UpdatedAt = time.Now()
		jm.saveFileInfo(ctx, exec.job.ID, fileInfo)
		exec.job.FailedFiles++
		jm.updateJob(ctx, exec.job)
		return err
	}

	// Mark as completed
	fileInfo.Status = FileStatusCompleted
	now := time.Now()
	fileInfo.CompletedAt = &now
	fileInfo.UpdatedAt = now
	fileInfo.Progress = 100
	jm.saveFileInfo(ctx, exec.job.ID, fileInfo)

	exec.job.UploadedFiles++
	exec.job.ProcessedFiles++
	jm.updateJob(ctx, exec.job)

	return nil
}

// uploadToGCS uploads a file to GCS
func (jm *JobManager) uploadToGCS(ctx context.Context, bucket, gcsPath, localPath string, fileInfo *FileInfo) error {
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("failed to open file: %w", err)
	}
	defer file.Close()

	obj := jm.storageClient.Bucket(bucket).Object(gcsPath)
	writer := obj.NewWriter(ctx)
	defer writer.Close()

	// Copy file with progress tracking
	buf := make([]byte, 1024*1024) // 1MB buffer
	var written int64
	for {
		n, err := file.Read(buf)
		if n > 0 {
			if _, werr := writer.Write(buf[:n]); werr != nil {
				return fmt.Errorf("failed to write to GCS: %w", werr)
			}
			written += int64(n)
			fileInfo.Progress = float64(written) / float64(fileInfo.FileSize) * 100
			jm.saveFileInfo(ctx, fileInfo.ID, fileInfo)
		}
		if err != nil {
			break
		}
	}

	return nil
}

// saveFileInfo saves file info to Firestore
func (jm *JobManager) saveFileInfo(ctx context.Context, jobID string, fileInfo *FileInfo) {
	_, err := jm.FirestoreClient.
		Collection("upload_jobs").Doc(jobID).
		Collection("files").Doc(fileInfo.ID).
		Set(ctx, fileInfo)
	if err != nil {
		log.Printf("Failed to save file info: %v", err)
	}
}

// updateJob updates job in Firestore
func (jm *JobManager) updateJob(ctx context.Context, job *UploadJob) {
	job.UpdatedAt = time.Now()
	_, err := jm.FirestoreClient.Collection("upload_jobs").Doc(job.ID).Set(ctx, job)
	if err != nil {
		log.Printf("Failed to update job: %v", err)
	}
}

// failJob marks a job as failed
func (jm *JobManager) failJob(ctx context.Context, exec *jobExecution, reason string) {
	exec.job.Status = JobStatusFailed
	now := time.Now()
	exec.job.CompletedAt = &now
	exec.job.UpdatedAt = now
	jm.updateJob(ctx, exec.job)
	log.Printf("Job %s failed: %s", exec.job.ID, reason)
}

// cancelJob marks a job as cancelled
func (jm *JobManager) cancelJob(ctx context.Context, exec *jobExecution) {
	exec.job.Status = JobStatusCancelled
	now := time.Now()
	exec.job.CompletedAt = &now
	exec.job.UpdatedAt = now
	jm.updateJob(ctx, exec.job)
}

// CancelJob cancels a running job
func (jm *JobManager) CancelJob(jobID string) error {
	jm.mu.RLock()
	exec, ok := jm.activeJobs[jobID]
	jm.mu.RUnlock()

	if !ok {
		return fmt.Errorf("job not found or not running")
	}

	if exec.cancelFn != nil {
		exec.cancelFn()
	}

	return nil
}

// GetJob retrieves a job by ID
func (jm *JobManager) GetJob(ctx context.Context, jobID string) (*UploadJob, error) {
	doc, err := jm.FirestoreClient.Collection("upload_jobs").Doc(jobID).Get(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to get job: %w", err)
	}

	var job UploadJob
	if err := doc.DataTo(&job); err != nil {
		return nil, fmt.Errorf("failed to parse job: %w", err)
	}

	return &job, nil
}

// GetJobFiles retrieves all files for a job
func (jm *JobManager) GetJobFiles(ctx context.Context, jobID string) ([]*FileInfo, error) {
	docs, err := jm.FirestoreClient.
		Collection("upload_jobs").Doc(jobID).
		Collection("files").
		Documents(ctx).
		GetAll()
	if err != nil {
		return nil, fmt.Errorf("failed to get files: %w", err)
	}

	files := make([]*FileInfo, 0, len(docs))
	for _, doc := range docs {
		var fileInfo FileInfo
		if err := doc.DataTo(&fileInfo); err != nil {
			log.Printf("Failed to parse file info: %v", err)
			continue
		}
		files = append(files, &fileInfo)
	}

	return files, nil
}

// MoveFilesToTrash moves uploaded or skipped files to trash
func (jm *JobManager) MoveFilesToTrash(ctx context.Context, jobID string) error {
	files, err := jm.GetJobFiles(ctx, jobID)
	if err != nil {
		return err
	}

	for _, file := range files {
		if file.Status == FileStatusCompleted || file.Status == FileSkipped {
			// Move to trash (OS-specific implementation would go here)
			// For now, we'll just log
			log.Printf("Would move %s to trash", file.LocalPath)
		}
	}

	return nil
}
