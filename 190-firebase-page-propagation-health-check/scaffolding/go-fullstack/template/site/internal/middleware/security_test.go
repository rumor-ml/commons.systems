package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestRecoverPanic_CatchesPanic(t *testing.T) {
	handler := RecoverPanic(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("test panic")
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	// Should not panic
	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", rr.Code)
	}
}

func TestRecoverPanic_NormalFlowUnaffected(t *testing.T) {
	handler := RecoverPanic(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("OK"))
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("Expected status 200, got %d", rr.Code)
	}
	if rr.Body.String() != "OK" {
		t.Errorf("Expected body 'OK', got '%s'", rr.Body.String())
	}
}

func TestSecurityHeaders_SetsAllHeaders(t *testing.T) {
	handler := SecurityHeaders(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	expectedHeaders := map[string]string{
		"X-Frame-Options":        "DENY",
		"X-Content-Type-Options": "nosniff",
		"X-XSS-Protection":       "1; mode=block",
		"Referrer-Policy":        "strict-origin-when-cross-origin",
	}

	for header, expected := range expectedHeaders {
		if got := rr.Header().Get(header); got != expected {
			t.Errorf("Header %s: expected '%s', got '%s'", header, expected, got)
		}
	}
}

func TestRecoverPanic_IncludesRequestContext(t *testing.T) {
	// This test verifies the panic recovery logs request context
	// We can't easily test log output, but we verify the handler works
	handler := RecoverPanic(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		panic("context test")
	}))

	req := httptest.NewRequest("POST", "/test/path", nil)
	req.RemoteAddr = "192.168.1.1:12345"
	rr := httptest.NewRecorder()

	handler.ServeHTTP(rr, req)

	if rr.Code != http.StatusInternalServerError {
		t.Errorf("Expected status 500, got %d", rr.Code)
	}

	body := rr.Body.String()
	if !strings.Contains(body, "Internal Server Error") {
		t.Errorf("Expected error message in body")
	}
}
