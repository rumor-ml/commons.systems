package web

import "net/http"

// RegisterRoutes registers the module routes
func RegisterRoutes(mux *http.ServeMux) error {
	mux.HandleFunc("/test", func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("OK"))
	})
	return nil
}
