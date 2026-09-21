package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"portable-ssh-ftp/internal/session"
)

func TestAPI_DuplicateSession_NotFound(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	// Test POST /api/session/{id}/duplicate with unknown id
	req := httptest.NewRequest(http.MethodPost, "/api/session/unknown-id/duplicate", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500 status, got %d", w.Code)
	}

	var resp map[string]string
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if !strings.Contains(resp["error"], "session not found") {
		t.Errorf("expected 'session not found' error message, got: %s", resp["error"])
	}
}

func TestAPI_ListSessions_Empty(t *testing.T) {
	mgr := session.NewManager()
	api := NewAPI(mgr)

	mux := http.NewServeMux()
	api.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 status, got %d", w.Code)
	}

	var resp struct {
		Sessions []session.SessionSummary `json:"sessions"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Sessions) != 0 {
		t.Errorf("expected 0 sessions, got %d", len(resp.Sessions))
	}
}
