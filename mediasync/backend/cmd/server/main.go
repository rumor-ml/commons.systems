package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"

	"github.com/rumor-ml/commons.systems/gcsupload"
	"github.com/rumor-ml/commons.systems/mediasync/backend/internal/config"
	"github.com/rumor-ml/commons.systems/mediasync/backend/internal/strategies"
)

var (
	cfg              *config.Config
	strategyRegistry *strategies.Registry
	jobManager       *gcsupload.JobManager
)

func main() {
	// Load configuration
	cfg = config.LoadFromEnv()
	if cfg.GCPProjectID == "" || cfg.GCSBucket == "" {
		log.Fatal("GCP_PROJECT_ID and GCS_BUCKET environment variables are required")
	}

	// Initialize clients
	ctx := context.Background()
	firestoreClient, err := firestore.NewClient(ctx, cfg.GCPProjectID)
	if err != nil {
		log.Fatalf("Failed to create Firestore client: %v", err)
	}
	defer firestoreClient.Close()

	storageClient, err := storage.NewClient(ctx)
	if err != nil {
		log.Fatalf("Failed to create Storage client: %v", err)
	}
	defer storageClient.Close()

	// Initialize strategy registry
	strategyRegistry = strategies.NewRegistry()
	strategyRegistry.Register(strategies.NewAudioStrategy(cfg.EnableAudio))
	strategyRegistry.Register(strategies.NewVideoStrategy(cfg.EnableVideo))
	strategyRegistry.Register(strategies.NewPrintStrategy(cfg.EnablePrint))
	strategyRegistry.Register(strategies.NewFinanceStrategy(cfg.EnableFinance))

	// Initialize job manager
	jobManager = gcsupload.NewJobManager(firestoreClient, storageClient)

	// Set up HTTP routes
	http.HandleFunc("/health", handleHealth)
	http.HandleFunc("/api/strategies", handleGetStrategies)
	http.HandleFunc("/api/jobs", handleJobs)
	http.HandleFunc("/api/jobs/", handleJobsWithID)

	// Serve static files
	fs := http.FileServer(http.Dir("./public"))
	http.Handle("/", fs)

	// Start server
	port := cfg.Port
	log.Printf("Starting mediasync server on port %s", port)
	log.Printf("Enabled strategies: audio=%v, video=%v, print=%v, finance=%v",
		cfg.EnableAudio, cfg.EnableVideo, cfg.EnablePrint, cfg.EnableFinance)

	if err := http.ListenAndServe(":"+port, nil); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{
		"status":  "healthy",
		"service": "mediasync",
	})
}

func handleGetStrategies(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	enabled := strategyRegistry.GetEnabled()
	response := make([]map[string]interface{}, len(enabled))

	for i, strategy := range enabled {
		response[i] = map[string]interface{}{
			"name":       strategy.Name(),
			"extensions": strategy.FileExtensions(),
		}
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(response)
}

func handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		handleCreateJob(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleJobsWithID(w http.ResponseWriter, r *http.Request) {
	jobID := filepath.Base(r.URL.Path)

	switch r.Method {
	case http.MethodGet:
		if r.URL.Path == fmt.Sprintf("/api/jobs/%s/files", jobID) {
			handleGetJobFiles(w, r, jobID)
		} else {
			handleGetJob(w, r, jobID)
		}
	case http.MethodPost:
		if r.URL.Path == fmt.Sprintf("/api/jobs/%s/cancel", jobID) {
			handleCancelJob(w, r, jobID)
		} else if r.URL.Path == fmt.Sprintf("/api/jobs/%s/trash", jobID) {
			handleTrashJob(w, r, jobID)
		} else {
			http.Error(w, "Not found", http.StatusNotFound)
		}
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

type CreateJobRequest struct {
	Name         string `json:"name"`
	LocalPath    string `json:"localPath"`
	StrategyName string `json:"strategyName"`
}

func handleCreateJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request body", http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name == "" || req.LocalPath == "" || req.StrategyName == "" {
		http.Error(w, "name, localPath, and strategyName are required", http.StatusBadRequest)
		return
	}

	// Get strategy
	strategy, ok := strategyRegistry.Get(req.StrategyName)
	if !ok || !strategy.IsEnabled() {
		http.Error(w, fmt.Sprintf("Strategy %s not found or not enabled", req.StrategyName), http.StatusBadRequest)
		return
	}

	// Create strategy-based discoverer and processors
	discoverer := &strategyFileDiscoverer{strategy: strategy}
	extractor := &strategyMetadataExtractor{strategy: strategy}
	normalizer := &strategyPathNormalizer{strategy: strategy}
	duplicateDetector := gcsupload.NewFirestoreDuplicateDetector(
		jobManager.FirestoreClient,
		[]string{"filename", "mediaType"},
	)

	// Create and start job
	ctx := r.Context()
	job, err := jobManager.CreateJob(ctx, req.Name, req.LocalPath, cfg.GCSBucket,
		discoverer, extractor, normalizer, duplicateDetector)

	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create job: %v", err), http.StatusInternalServerError)
		return
	}

	// Start job asynchronously
	go jobManager.ProcessJob(context.Background(), job.ID)

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(job)
}

func handleGetJob(w http.ResponseWriter, r *http.Request, jobID string) {
	ctx := r.Context()
	job, err := jobManager.GetJob(ctx, jobID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Job not found: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func handleGetJobFiles(w http.ResponseWriter, r *http.Request, jobID string) {
	ctx := r.Context()
	files, err := jobManager.GetJobFiles(ctx, jobID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get files: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func handleCancelJob(w http.ResponseWriter, r *http.Request, jobID string) {
	ctx := r.Context()
	if err := jobManager.CancelJob(ctx, jobID); err != nil {
		http.Error(w, fmt.Sprintf("Failed to cancel job: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func handleTrashJob(w http.ResponseWriter, r *http.Request, jobID string) {
	ctx := r.Context()
	if err := jobManager.TrashJob(ctx, jobID); err != nil {
		http.Error(w, fmt.Sprintf("Failed to trash job: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "trashed"})
}

// Strategy-based implementations of gcsupload interfaces

type strategyFileDiscoverer struct {
	strategy strategies.MediaStrategy
}

func (d *strategyFileDiscoverer) Discover(ctx context.Context, basePath string) ([]string, error) {
	var files []string

	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		if info.IsDir() {
			return nil
		}

		// Check if file matches strategy extensions
		for _, ext := range d.strategy.FileExtensions() {
			if filepath.Ext(path) == ext {
				files = append(files, path)
				break
			}
		}

		return nil
	})

	return files, err
}

type strategyMetadataExtractor struct {
	strategy strategies.MediaStrategy
}

func (e *strategyMetadataExtractor) Extract(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	return e.strategy.ExtractMetadata(ctx, filePath)
}

type strategyPathNormalizer struct {
	strategy strategies.MediaStrategy
}

func (n *strategyPathNormalizer) Normalize(metadata map[string]interface{}, fileName string) (string, error) {
	return n.strategy.NormalizePath(metadata, fileName)
}
