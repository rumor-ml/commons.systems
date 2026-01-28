package middleware

import (
	"context"
	"net/http"
	"strings"

	"firebase.google.com/go/v4/auth"
)

type contextKey string

const (
	UserIDKey contextKey = "userID"
	AuthKey   contextKey = "auth"
)

// AuthInfo contains authenticated user information
type AuthInfo struct {
	UserID string
	Email  string
}

// AuthMiddleware validates Firebase Auth tokens
type AuthMiddleware struct {
	authClient *auth.Client
}

// NewAuthMiddleware creates a new auth middleware
func NewAuthMiddleware(authClient *auth.Client) *AuthMiddleware {
	return &AuthMiddleware{authClient: authClient}
}

// RequireAuth middleware that requires authentication
func (m *AuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Extract token from Authorization header
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Missing authorization header", http.StatusUnauthorized)
			return
		}

		// Expected format: "Bearer <token>"
		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		token := parts[1]

		// Verify token
		decodedToken, err := m.authClient.VerifyIDToken(r.Context(), token)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		// Extract user info from token
		authInfo := AuthInfo{
			UserID: decodedToken.UID,
		}

		// Get email if available
		if claims, ok := decodedToken.Claims["email"].(string); ok {
			authInfo.Email = claims
		}

		// Add auth info to context
		ctx := context.WithValue(r.Context(), AuthKey, authInfo)
		ctx = context.WithValue(ctx, UserIDKey, decodedToken.UID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// GetUserID extracts user ID from context
func GetUserID(ctx context.Context) (string, bool) {
	userID, ok := ctx.Value(UserIDKey).(string)
	return userID, ok
}

// GetAuth retrieves auth info from the request context
func GetAuth(r *http.Request) (AuthInfo, bool) {
	if info, ok := r.Context().Value(AuthKey).(AuthInfo); ok {
		return info, true
	}
	return AuthInfo{}, false
}
