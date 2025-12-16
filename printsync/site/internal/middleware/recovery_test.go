package middleware

import (
	"bytes"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecovery_CatchesPanic(t *testing.T) {
	tests := []struct {
		name       string
		panicValue interface{}
	}{
		{"string panic", "test panic"},
		{"error panic", errors.New("test error")},
		{"nil panic", nil},
		{"int panic", 42},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Capture log output to verify stack trace is logged
			var logBuf bytes.Buffer
			log.SetOutput(&logBuf)
			defer log.SetOutput(nil)

			panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				panic(tt.panicValue)
			})

			recovered := Recovery(panicHandler)
			req := httptest.NewRequest("GET", "/test", nil)
			rec := httptest.NewRecorder()

			// Should not panic
			recovered.ServeHTTP(rec, req)

			// Should return 500
			if rec.Code != http.StatusInternalServerError {
				t.Errorf("Expected status 500, got %d", rec.Code)
			}

			// Should have error message
			if rec.Body.String() != "Internal Server Error\n" {
				t.Errorf("Expected 'Internal Server Error\\n', got %q", rec.Body.String())
			}

			// Verify Content-Type header
			contentType := rec.Header().Get("Content-Type")
			if contentType != "text/plain; charset=utf-8" {
				t.Errorf("Expected Content-Type 'text/plain; charset=utf-8', got %q", contentType)
			}

			// Verify X-Content-Type-Options header
			noSniff := rec.Header().Get("X-Content-Type-Options")
			if noSniff != "nosniff" {
				t.Errorf("Expected X-Content-Type-Options 'nosniff', got %q", noSniff)
			}

			// Verify stack trace was logged
			logOutput := logBuf.String()
			if !strings.Contains(logOutput, "PANIC recovered:") {
				t.Errorf("Expected log to contain 'PANIC recovered:', got %q", logOutput)
			}
			if !strings.Contains(logOutput, "goroutine") {
				t.Errorf("Expected log to contain stack trace with 'goroutine', got %q", logOutput)
			}
		})
	}
}

func TestRecovery_NonPanickingRequests(t *testing.T) {
	normalHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	recovered := Recovery(normalHandler)
	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	recovered.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rec.Code)
	}
	if rec.Body.String() != "success" {
		t.Errorf("Expected 'success', got %q", rec.Body.String())
	}
}

func TestRecovery_PanicAfterHeadersWritten(t *testing.T) {
	// Capture log output
	var logBuf bytes.Buffer
	log.SetOutput(&logBuf)
	defer log.SetOutput(nil)

	// Handler that writes headers first, then panics
	panicHandler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("partial response"))
		panic("error after headers written")
	})

	recovered := Recovery(panicHandler)
	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	// Should not panic
	recovered.ServeHTTP(rec, req)

	// Status code should be 200 (already written before panic)
	if rec.Code != http.StatusOK {
		t.Errorf("Expected status 200 (headers already written), got %d", rec.Code)
	}

	// Body should contain partial response (http.Error cannot override)
	body := rec.Body.String()
	if !strings.Contains(body, "partial response") {
		t.Errorf("Expected body to contain 'partial response', got %q", body)
	}

	// Verify panic was still logged
	logOutput := logBuf.String()
	if !strings.Contains(logOutput, "PANIC recovered:") {
		t.Errorf("Expected log to contain 'PANIC recovered:', got %q", logOutput)
	}
	if !strings.Contains(logOutput, "error after headers written") {
		t.Errorf("Expected log to contain panic message, got %q", logOutput)
	}
}
