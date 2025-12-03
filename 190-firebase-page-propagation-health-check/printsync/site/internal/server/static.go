package server

import (
	"net/http"
	"os"

	"printsync/web"
)

func StaticHandler() http.Handler {
	// Development: serve from disk for hot reload
	if os.Getenv("GO_ENV") == "development" {
		return http.StripPrefix("/static/",
			http.FileServer(http.Dir("web/dist")))
	}

	// Production: serve from embedded FS
	return http.StripPrefix("/static/",
		http.FileServer(http.FS(web.DistFS)))
}
