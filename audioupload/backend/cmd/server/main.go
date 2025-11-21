package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/rumor-ml/commons.systems/audioupload/backend/internal/audio"
	"github.com/rumor-ml/commons.systems/gcsupload"
)

type Server struct {
	jobManager *gcsupload.JobManager
	projectID  string
	gcsBucket  string
}

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	projectID := os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		log.Fatal("GCP_PROJECT_ID environment variable is required")
	}

	gcsBucket := os.Getenv("GCS_BUCKET")
	if gcsBucket == "" {
		log.Fatal("GCS_BUCKET environment variable is required")
	}

	ctx := context.Background()
	jobManager, err := gcsupload.NewJobManager(ctx, projectID)
	if err != nil {
		log.Fatalf("Failed to create job manager: %v", err)
	}
	defer jobManager.Close()

	server := &Server{
		jobManager: jobManager,
		projectID:  projectID,
		gcsBucket:  gcsBucket,
	}

	// Enable CORS for all origins (adjust for production)
	handler := corsMiddleware(server.routes())

	log.Printf("Server starting on port %s...", port)
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()

	// API routes
	mux.HandleFunc("/api/jobs", s.handleJobs)
	mux.HandleFunc("/api/jobs/", s.handleJobsWithID)
	mux.HandleFunc("/api/jobs/{id}/files", s.handleJobFiles)
	mux.HandleFunc("/api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("/api/jobs/{id}/trash", s.handleMoveToTrash)

	// Health check
	mux.HandleFunc("/health", s.handleHealth)

	// Serve static files (frontend)
	mux.Handle("/", http.FileServer(http.Dir("/app/public")))

	return mux
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
}

func (s *Server) handleJobs(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		s.createJob(w, r)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) handleJobsWithID(w http.ResponseWriter, r *http.Request) {
	// Extract job ID from path
	// Note: In Go 1.22+, we can use path parameters. For now, extract manually
	jobID := r.URL.Path[len("/api/jobs/"):]

	switch r.Method {
	case http.MethodGet:
		s.getJob(w, r, jobID)
	default:
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
	}
}

type CreateJobRequest struct {
	Name        string `json:"name"`
	BasePath    string `json:"basePath"`
	GCSBasePath string `json:"gcsBasePath"`
}

func (s *Server) createJob(w http.ResponseWriter, r *http.Request) {
	var req CreateJobRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf("Invalid request: %v", err), http.StatusBadRequest)
		return
	}

	// Validate request
	if req.Name == "" || req.BasePath == "" {
		http.Error(w, "name and basePath are required", http.StatusBadRequest)
		return
	}

	if req.GCSBasePath == "" {
		req.GCSBasePath = "audio-uploads"
	}

	ctx := r.Context()

	// Create duplicate detector
	duplicateDetector := gcsupload.NewFirestoreDuplicateDetector(
		s.jobManager.FirestoreClient,
		[]string{"artist", "album", "title"},
	)

	// Create upload config
	config := &gcsupload.UploadConfig{
		JobName:           req.Name,
		BasePath:          req.BasePath,
		GCSBucket:         s.gcsBucket,
		GCSBasePath:       req.GCSBasePath,
		FileDiscoverer:    audio.NewAudioFileDiscoverer(),
		MetadataExtractor: audio.NewMetadataExtractor(true), // Enable fingerprinting
		PathNormalizer:    audio.NewPathNormalizer(),
		DuplicateDetector: duplicateDetector,
	}

	// Create job
	job, err := s.jobManager.CreateJob(ctx, config)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to create job: %v", err), http.StatusInternalServerError)
		return
	}

	// Start job
	if err := s.jobManager.StartJob(ctx, job.ID, config); err != nil {
		http.Error(w, fmt.Sprintf("Failed to start job: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(job)
}

func (s *Server) getJob(w http.ResponseWriter, r *http.Request, jobID string) {
	ctx := r.Context()

	job, err := s.jobManager.GetJob(ctx, jobID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get job: %v", err), http.StatusNotFound)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(job)
}

func (s *Server) handleJobFiles(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID
	jobID := r.URL.Path[len("/api/jobs/"):]
	jobID = jobID[:len(jobID)-len("/files")]

	ctx := r.Context()

	files, err := s.jobManager.GetJobFiles(ctx, jobID)
	if err != nil {
		http.Error(w, fmt.Sprintf("Failed to get files: %v", err), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(files)
}

func (s *Server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID
	jobID := r.URL.Path[len("/api/jobs/"):]
	jobID = jobID[:len(jobID)-len("/cancel")]

	if err := s.jobManager.CancelJob(jobID); err != nil {
		http.Error(w, fmt.Sprintf("Failed to cancel job: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "cancelled"})
}

func (s *Server) handleMoveToTrash(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Extract job ID
	jobID := r.URL.Path[len("/api/jobs/"):]
	jobID = jobID[:len(jobID)-len("/trash")]

	ctx := r.Context()

	if err := s.jobManager.MoveFilesToTrash(ctx, jobID); err != nil {
		http.Error(w, fmt.Sprintf("Failed to move files to trash: %v", err), http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "moved to trash"})
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}
