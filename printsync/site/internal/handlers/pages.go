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

func (h *PageHandlers) SyncDetail(w http.ResponseWriter, r *http.Request) {
	htmx := middleware.GetHTMX(r)
	sessionID := r.PathValue("id")

	data := pages.SyncDetailPageData{
		SessionID: sessionID,
	}

	if htmx.IsHTMX && !htmx.HistoryRestore {
		pages.SyncDetailContent(data).Render(r.Context(), w)
	} else {
		pages.SyncDetail(data).Render(r.Context(), w)
	}
}

func (h *PageHandlers) SyncFormPartial(w http.ResponseWriter, r *http.Request) {
	partials.SyncForm().Render(r.Context(), w)
}
