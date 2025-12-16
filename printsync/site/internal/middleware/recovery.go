package middleware

import (
	"log"
	"net/http"
	"runtime/debug"
)

// Recovery recovers from panics in HTTP handlers.
//
// Scope: HTTP request processing (ServeHTTP chain)
// Does NOT recover: Background goroutines
// For background recovery, see streaming.StreamMerger methods
func Recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("PANIC recovered: %v\n%s", err, debug.Stack())
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
		}()
		next.ServeHTTP(w, r)
	})
}
