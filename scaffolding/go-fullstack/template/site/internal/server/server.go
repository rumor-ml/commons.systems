package server

import (
	"net/http"

	"{{APP_NAME}}/internal/firestore"
	"{{APP_NAME}}/internal/handlers"
	"{{APP_NAME}}/internal/middleware"
)

func NewRouter(fs *firestore.Client) http.Handler {
	mux := http.NewServeMux()

	// Static assets
	mux.Handle("GET /static/", StaticHandler())

	// Health check for Cloud Run
	mux.HandleFunc("GET /health", handlers.HealthHandler)

	// Pages (support HTMX partial + full page)
	h := handlers.NewPageHandlers(fs)
	mux.HandleFunc("GET /", h.Home)
	mux.HandleFunc("GET /dashboard", h.Dashboard)

	// HTMX partials
	mux.HandleFunc("GET /partials/items", h.ItemsPartial)
	mux.HandleFunc("POST /partials/items", h.CreateItem)

	// API for React islands
	mux.HandleFunc("GET /api/data", h.DataAPI)

	// Apply middleware
	return middleware.Chain(mux,
		middleware.Logger,
		middleware.HTMX,
	)
}
