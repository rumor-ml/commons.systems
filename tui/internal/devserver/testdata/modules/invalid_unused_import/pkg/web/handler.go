package web

import (
	"net/http"
	"strings" // unused import - will cause compilation error
)

// RegisterRoutes registers the module routes
func RegisterRoutes(mux *http.ServeMux) error {
	mux.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})
	return nil
}
