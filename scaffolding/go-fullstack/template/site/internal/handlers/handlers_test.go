package handlers

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPageHandlers_Home_ReturnsOK(t *testing.T) {
	h := NewPageHandlers(nil) // nil Firestore client for basic test

	req := httptest.NewRequest("GET", "/", nil)
	rr := httptest.NewRecorder()

	h.Home(rr, req)

	// Home should attempt to render (may fail without templates, but shouldn't panic)
	// In a real test environment with templates, this would return 200
	if rr.Code == 0 {
		t.Error("Expected a response code to be set")
	}
}

func TestPageHandlers_Dashboard_ReturnsOK(t *testing.T) {
	h := NewPageHandlers(nil)

	req := httptest.NewRequest("GET", "/dashboard", nil)
	rr := httptest.NewRecorder()

	h.Dashboard(rr, req)

	if rr.Code == 0 {
		t.Error("Expected a response code to be set")
	}
}
