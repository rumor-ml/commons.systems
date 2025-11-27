package handlers

import (
	"log"
	"net/http"

	"{{APP_NAME}}/internal/firestore"
	"{{APP_NAME}}/internal/middleware"
	"{{APP_NAME}}/web/templates/pages"
)

type PageHandlers struct {
	fs *firestore.Client
}

func NewPageHandlers(fs *firestore.Client) *PageHandlers {
	return &PageHandlers{fs: fs}
}

func (h *PageHandlers) Home(w http.ResponseWriter, r *http.Request) {
	htmx := middleware.GetHTMX(r)

	data := pages.HomeData{
		Title: "Welcome to {{APP_NAME_TITLE}}",
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		// Return just the content for HTMX requests
		if err := pages.HomeContent(data).Render(r.Context(), w); err != nil {
			log.Printf("Render error: %v", err)
		}
	} else {
		// Return full page for normal requests
		if err := pages.Home(data).Render(r.Context(), w); err != nil {
			log.Printf("Render error: %v", err)
		}
	}
}

func (h *PageHandlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	htmx := middleware.GetHTMX(r)

	data := pages.DashboardData{
		Title: "Dashboard",
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		if err := pages.DashboardContent(data).Render(r.Context(), w); err != nil {
			log.Printf("Render error: %v", err)
		}
	} else {
		if err := pages.Dashboard(data).Render(r.Context(), w); err != nil {
			log.Printf("Render error: %v", err)
		}
	}
}
