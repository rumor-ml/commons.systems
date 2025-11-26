package middleware

import (
	"context"
	"net/http"
)

type contextKey string

const HTMXKey contextKey = "htmx"

type HTMXInfo struct {
	IsHTMX         bool
	Target         string
	HistoryRestore bool
}

func HTMX(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		info := HTMXInfo{
			IsHTMX:         r.Header.Get("HX-Request") == "true",
			Target:         r.Header.Get("HX-Target"),
			HistoryRestore: r.Header.Get("HX-History-Restore-Request") == "true",
		}

		if info.IsHTMX {
			w.Header().Set("Vary", "HX-Request")
		}

		ctx := context.WithValue(r.Context(), HTMXKey, info)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func GetHTMX(r *http.Request) HTMXInfo {
	if info, ok := r.Context().Value(HTMXKey).(HTMXInfo); ok {
		return info
	}
	return HTMXInfo{}
}
