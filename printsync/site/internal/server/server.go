package server

import (
	"log"
	"net/http"

	"cloud.google.com/go/storage"
	firebase "firebase.google.com/go/v4"
	"github.com/commons-systems/filesync"
	"printsync/internal/firestore"
	"printsync/internal/handlers"
	"printsync/internal/middleware"
	"printsync/internal/streaming"
)

func NewRouter(
	fs *firestore.Client,
	gcsClient *storage.Client,
	bucket string,
	firebaseApp *firebase.App,
	sessionStore filesync.SessionStore,
	fileStore filesync.FileStore,
) http.Handler {
	mux := http.NewServeMux()

	// Static assets
	mux.Handle("GET /static/", StaticHandler())

	// Health check for Cloud Run
	mux.HandleFunc("GET /health", handlers.HealthHandler)

	// Pages
	pageH := handlers.NewPageHandlers(fs)
	mux.HandleFunc("GET /", pageH.Sync)
	mux.HandleFunc("GET /sync/{id}", pageH.SyncDetail)

	// HTMX partials (non-authenticated)
	mux.HandleFunc("GET /partials/sync/form", pageH.SyncFormPartial)

	// Initialize sync infrastructure
	registry := handlers.NewSessionRegistry()
	hub, err := streaming.NewStreamHub(sessionStore, fileStore)
	if err != nil {
		log.Fatalf("Failed to create stream hub: %v", err)
	}

	// Sync handlers
	syncH, err := handlers.NewSyncHandlers(gcsClient, bucket, fs, sessionStore, fileStore, registry, hub)
	if err != nil {
		log.Fatalf("Failed to create sync handlers: %v", err)
	}

	// Protected sync API routes (require Firebase Auth)
	authMiddleware := middleware.FirebaseAuth(firebaseApp)

	// Sync API
	mux.Handle("POST /api/sync/start", authMiddleware(http.HandlerFunc(syncH.StartSync)))
	mux.Handle("GET /api/sync/{id}", authMiddleware(http.HandlerFunc(syncH.GetSession)))
	mux.Handle("GET /api/sync/{id}/stream", authMiddleware(http.HandlerFunc(syncH.StreamSession)))
	mux.Handle("POST /api/sync/{id}/cancel", authMiddleware(http.HandlerFunc(syncH.CancelSync)))
	mux.Handle("POST /api/sync/{id}/approve-all", authMiddleware(http.HandlerFunc(syncH.ApproveAll)))
	mux.Handle("POST /api/sync/{id}/upload-selected", authMiddleware(http.HandlerFunc(syncH.UploadSelected)))
	mux.Handle("POST /api/sync/{id}/trash-all", authMiddleware(http.HandlerFunc(syncH.TrashAll)))

	// File API
	mux.Handle("POST /api/files/{id}/approve", authMiddleware(http.HandlerFunc(syncH.ApproveFile)))
	mux.Handle("POST /api/files/{id}/reject", authMiddleware(http.HandlerFunc(syncH.RejectFile)))
	mux.Handle("POST /api/files/{id}/retry", authMiddleware(http.HandlerFunc(syncH.RetryFile)))
	mux.Handle("POST /api/files/{id}/trash", authMiddleware(http.HandlerFunc(syncH.TrashFile)))

	// Protected partials
	mux.Handle("GET /partials/sync/history", authMiddleware(http.HandlerFunc(syncH.HistoryPartial)))
	mux.Handle("GET /partials/trash-modal", authMiddleware(http.HandlerFunc(syncH.RenderTrashModal)))

	// Apply middleware
	return middleware.Chain(mux,
		middleware.Recovery,
		middleware.Logger,
		middleware.HTMX,
	)
}
