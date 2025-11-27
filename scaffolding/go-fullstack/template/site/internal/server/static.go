package server

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"os"
)

func StaticHandler(distFS embed.FS) http.Handler {
	// Development: serve from disk for hot reload
	if os.Getenv("GO_ENV") == "development" {
		return http.StripPrefix("/static/",
			http.FileServer(http.Dir("web/dist")))
	}

	// Production: serve from embedded FS
	subFS, err := fs.Sub(distFS, "dist")
	if err != nil {
		log.Fatalf("CRITICAL: Failed to create static file sub-filesystem: %v", err)
	}
	return http.StripPrefix("/static/",
		http.FileServer(http.FS(subFS)))
}
