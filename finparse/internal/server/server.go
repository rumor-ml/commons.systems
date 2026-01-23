package server

import (
	"context"
	"net/http"

	"github.com/rumor-ml/commons.systems/finparse/internal/firestore"
	"github.com/rumor-ml/commons.systems/finparse/internal/handlers"
	"github.com/rumor-ml/commons.systems/finparse/internal/middleware"
)

// Server represents the budget API server
type Server struct {
	fsClient *firestore.Client
	mux      *http.ServeMux
}

// New creates a new server instance
func New(ctx context.Context, projectID string) (*Server, error) {
	// Create Firestore client
	fsClient, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}

	// Create server
	s := &Server{
		fsClient: fsClient,
		mux:      http.NewServeMux(),
	}

	// Setup routes
	s.setupRoutes()

	return s, nil
}

// setupRoutes configures all HTTP routes
func (s *Server) setupRoutes() {
	// Health check (no auth required)
	s.mux.HandleFunc("/health", handlers.HealthCheck)

	// API handlers
	apiHandler := handlers.NewAPIHandler(s.fsClient)
	authMiddleware := middleware.NewAuthMiddleware(s.fsClient.Auth)

	// Protected API routes
	s.mux.Handle("/api/transactions", authMiddleware.RequireAuth(http.HandlerFunc(apiHandler.GetTransactions)))
	s.mux.Handle("/api/statements", authMiddleware.RequireAuth(http.HandlerFunc(apiHandler.GetStatements)))
	s.mux.Handle("/api/accounts", authMiddleware.RequireAuth(http.HandlerFunc(apiHandler.GetAccounts)))
	s.mux.Handle("/api/institutions", authMiddleware.RequireAuth(http.HandlerFunc(apiHandler.GetInstitutions)))

	// Static files for frontend (when deployed together)
	fs := http.FileServer(http.Dir("./dist"))
	s.mux.Handle("/", fs)
}

// Handler returns the HTTP handler
func (s *Server) Handler() http.Handler {
	// Apply middleware
	handler := middleware.CORS(s.mux)
	return handler
}

// Close closes the server resources
func (s *Server) Close() error {
	return s.fsClient.Close()
}
