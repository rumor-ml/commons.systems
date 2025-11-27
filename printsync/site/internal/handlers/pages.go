package handlers

import (
	"net/http"

	"printsync/internal/firestore"
	"printsync/internal/middleware"
	"printsync/web/templates/pages"
	"printsync/web/templates/partials"
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
		Title: "Welcome to Printsync",
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		// Return just the content for HTMX requests
		pages.HomeContent(data).Render(r.Context(), w)
	} else {
		// Return full page for normal requests
		pages.Home(data).Render(r.Context(), w)
	}
}

func (h *PageHandlers) Dashboard(w http.ResponseWriter, r *http.Request) {
	htmx := middleware.GetHTMX(r)

	data := pages.DashboardData{
		Title: "Dashboard",
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		pages.DashboardContent(data).Render(r.Context(), w)
	} else {
		pages.Dashboard(data).Render(r.Context(), w)
	}
}

func (h *PageHandlers) Sync(w http.ResponseWriter, r *http.Request) {
	htmx := middleware.GetHTMX(r)

	data := pages.SyncPageData{
		Title: "Sync Files",
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		pages.SyncContent(data).Render(r.Context(), w)
	} else {
		pages.Sync(data).Render(r.Context(), w)
	}
}

func (h *PageHandlers) SyncFormPartial(w http.ResponseWriter, r *http.Request) {
	partials.SyncForm().Render(r.Context(), w)
}
