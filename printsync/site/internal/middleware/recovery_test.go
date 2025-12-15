package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
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
