package server

import (
	"embed"
	"io/fs"
	"net/http"
	"os"
)

//go:embed all:../../web/dist
var distFS embed.FS

func StaticHandler() http.Handler {
	// Development: serve from disk for hot reload
	if os.Getenv("GO_ENV") == "development" {
		return http.StripPrefix("/static/",
			http.FileServer(http.Dir("web/dist")))
	}

	// Production: serve from embedded FS
	subFS, _ := fs.Sub(distFS, "web/dist")
	return http.StripPrefix("/static/",
		http.FileServer(http.FS(subFS)))
}
