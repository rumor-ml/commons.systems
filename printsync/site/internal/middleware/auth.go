package middleware

import (
	"context"
	"net/http"
	"strings"

	firebase "firebase.google.com/go/v4"
)

const AuthKey contextKey = "auth"

// AuthInfo contains authenticated user information
type AuthInfo struct {
	UserID string
	Email  string
}

// FirebaseAuth returns a middleware that validates Firebase ID tokens
func FirebaseAuth(firebaseApp *firebase.App) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var idToken string

			// Try Authorization header first
			authHeader := r.Header.Get("Authorization")
			if authHeader != "" {
				parts := strings.Split(authHeader, " ")
				if len(parts) == 2 && parts[0] == "Bearer" {
					idToken = parts[1]
				}
			}

			// Fallback to cookie (for SSE/EventSource connections)
			if idToken == "" {
				cookie, err := r.Cookie("firebase_token")
				if err == nil && cookie != nil {
					idToken = cookie.Value
				}
			}

			// If no token found via either method, reject the request
			if idToken == "" {
				http.Error(w, "Missing authentication", http.StatusUnauthorized)
				return
			}

			// Verify token with Firebase Auth
			authClient, err := firebaseApp.Auth(r.Context())
			if err != nil {
				http.Error(w, "Failed to initialize auth client", http.StatusInternalServerError)
				return
			}

			token, err := authClient.VerifyIDToken(r.Context(), idToken)
			if err != nil {
				http.Error(w, "Invalid or expired token", http.StatusUnauthorized)
				return
			}

			// Extract user info from token
			authInfo := AuthInfo{
				UserID: token.UID,
			}

			// Get email if available
			if claims, ok := token.Claims["email"].(string); ok {
				authInfo.Email = claims
			}

			// Store auth info in request context
			ctx := context.WithValue(r.Context(), AuthKey, authInfo)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// GetAuth retrieves auth info from the request context
func GetAuth(r *http.Request) (AuthInfo, bool) {
	if info, ok := r.Context().Value(AuthKey).(AuthInfo); ok {
		return info, true
	}
	return AuthInfo{}, false
}
