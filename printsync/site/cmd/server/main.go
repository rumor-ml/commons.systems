package main

import (
	"context"
	"log"
	"mime"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"cloud.google.com/go/storage"
	firebase "firebase.google.com/go/v4"
	"github.com/commons-systems/filesync"
	"printsync/internal/config"
	"printsync/internal/firestore"
	"printsync/internal/server"
)

func main() {
	// Register JavaScript MIME types explicitly
	// This ensures .js files are served with correct Content-Type
	mime.AddExtensionType(".js", "application/javascript; charset=utf-8")
	mime.AddExtensionType(".mjs", "application/javascript; charset=utf-8")
	mime.AddExtensionType(".json", "application/json; charset=utf-8")
	mime.AddExtensionType(".css", "text/css; charset=utf-8")

	cfg := config.Load()

	ctx := context.Background()

	// Initialize Firestore client
	fsClient, err := firestore.NewClient(ctx, cfg.GCPProjectID)
	if err != nil {
		log.Fatalf("Failed to create Firestore client: %v", err)
	}
	defer fsClient.Close()

	// Initialize GCS client
	gcsClient, err := storage.NewClient(ctx)
	if err != nil {
		log.Fatalf("Failed to create GCS client: %v", err)
	}
	defer gcsClient.Close()

	// Initialize Firebase app for auth
	firebaseConfig := &firebase.Config{
		ProjectID: cfg.GCPProjectID,
	}
	firebaseApp, err := firebase.NewApp(ctx, firebaseConfig)
	if err != nil {
		log.Fatalf("Failed to create Firebase app: %v", err)
	}

	// Log if using Firebase Auth Emulator
	if authEmulator := os.Getenv("FIREBASE_AUTH_EMULATOR_HOST"); authEmulator != "" {
		log.Printf("Using Firebase Auth Emulator at %s", authEmulator)
	} else {
		log.Printf("WARNING: FIREBASE_AUTH_EMULATOR_HOST not set - using production Firebase Auth")
	}

	// Create session and file stores
	sessionStore := filesync.NewFirestoreSessionStore(fsClient.Client)
	fileStore := filesync.NewFirestoreFileStore(fsClient.Client)

	// Create router with all dependencies
	router := server.NewRouter(fsClient, gcsClient, cfg.GCSBucketName, firebaseApp, sessionStore, fileStore)

	srv := &http.Server{
		Addr:    ":" + cfg.Port,
		Handler: router,
	}

	// Graceful shutdown
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh

		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		srv.Shutdown(ctx)
	}()

	log.Printf("Server starting on port %s", cfg.Port)
	if err := srv.ListenAndServe(); err != http.ErrServerClosed {
		log.Fatalf("Server error: %v", err)
	}
}
