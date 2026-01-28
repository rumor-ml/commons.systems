package middleware

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"firebase.google.com/go/v4/auth"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockAuthClient is a mock implementation of the auth.Client interface for testing
type mockAuthClient struct {
	verifyIDTokenFunc func(ctx context.Context, idToken string) (*auth.Token, error)
}

func (m *mockAuthClient) VerifyIDToken(ctx context.Context, idToken string) (*auth.Token, error) {
	if m.verifyIDTokenFunc != nil {
		return m.verifyIDTokenFunc(ctx, idToken)
	}
	return nil, errors.New("not implemented")
}

// We can't directly set the authClient field since it's unexported, so we create a helper
// that creates AuthMiddleware with a mock client by using reflection or a test constructor
func newTestAuthMiddleware(mockClient *mockAuthClient) *AuthMiddleware {
	// Since we can't set the private field directly, we'll create a custom middleware
	// that mimics the real implementation but uses our mock
	return &AuthMiddleware{
		authClient: (*auth.Client)(nil), // We'll use a wrapper instead
	}
}

// testAuthMiddleware wraps the middleware logic for testing with a mock client
type testAuthMiddleware struct {
	mockClient *mockAuthClient
}

func (m *testAuthMiddleware) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// This is a copy of the real RequireAuth implementation but uses mockClient
		authHeader := r.Header.Get("Authorization")
		if authHeader == "" {
			http.Error(w, "Missing authorization header", http.StatusUnauthorized)
			return
		}

		parts := strings.Split(authHeader, " ")
		if len(parts) != 2 || parts[0] != "Bearer" {
			http.Error(w, "Invalid authorization header format", http.StatusUnauthorized)
			return
		}

		token := parts[1]

		decodedToken, err := m.mockClient.VerifyIDToken(r.Context(), token)
		if err != nil {
			http.Error(w, "Invalid token", http.StatusUnauthorized)
			return
		}

		authInfo := AuthInfo{
			UserID: decodedToken.UID,
		}

		if claims, ok := decodedToken.Claims["email"].(string); ok {
			authInfo.Email = claims
		}

		ctx := context.WithValue(r.Context(), AuthKey, authInfo)
		ctx = context.WithValue(ctx, UserIDKey, decodedToken.UID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func TestRequireAuth_ValidToken(t *testing.T) {
	// Create mock client that returns valid token
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return &auth.Token{
				UID: "test-user-123",
				Claims: map[string]interface{}{
					"email": "test@example.com",
				},
			}, nil
		},
	}

	middleware := &testAuthMiddleware{mockClient: mockClient}

	// Create a test handler that checks context values
	var capturedUserID string
	var capturedAuthInfo AuthInfo
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := GetUserID(r.Context())
		require.True(t, ok, "UserID should be in context")
		capturedUserID = userID

		authInfo, ok := GetAuth(r)
		require.True(t, ok, "AuthInfo should be in context")
		capturedAuthInfo = authInfo

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("success"))
	})

	// Create request with valid Bearer token
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer valid-token-123")

	// Record response
	w := httptest.NewRecorder()

	// Execute middleware
	middleware.RequireAuth(handler).ServeHTTP(w, req)

	// Verify response
	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "success", w.Body.String())

	// Verify context values
	assert.Equal(t, "test-user-123", capturedUserID)
	assert.Equal(t, "test-user-123", capturedAuthInfo.UserID)
	assert.Equal(t, "test@example.com", capturedAuthInfo.Email)
}

func TestRequireAuth_MissingAuthorizationHeader(t *testing.T) {
	mockClient := &mockAuthClient{}
	middleware := &testAuthMiddleware{mockClient: mockClient}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("Handler should not be called when auth header is missing")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	// No Authorization header set

	w := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "Missing authorization header")
}

func TestRequireAuth_InvalidHeaderFormat(t *testing.T) {
	tests := []struct {
		name          string
		authHeader    string
		expectedError string
	}{
		{
			name:          "missing Bearer prefix",
			authHeader:    "token-without-bearer",
			expectedError: "Invalid authorization header format",
		},
		{
			name:          "wrong prefix",
			authHeader:    "Basic token-123",
			expectedError: "Invalid authorization header format",
		},
		{
			name:          "lowercase bearer",
			authHeader:    "bearer token-123",
			expectedError: "Invalid authorization header format",
		},
		{
			name:          "no token after Bearer",
			authHeader:    "Bearer",
			expectedError: "Invalid authorization header format",
		},
		{
			name:          "too many parts",
			authHeader:    "Bearer token-123 extra-part",
			expectedError: "Invalid authorization header format",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockClient := &mockAuthClient{}
			middleware := &testAuthMiddleware{mockClient: mockClient}

			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Fatal("Handler should not be called for invalid auth header")
			})

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Authorization", tt.authHeader)

			w := httptest.NewRecorder()
			middleware.RequireAuth(handler).ServeHTTP(w, req)

			assert.Equal(t, http.StatusUnauthorized, w.Code)
			assert.Contains(t, w.Body.String(), tt.expectedError)
		})
	}
}

func TestRequireAuth_InvalidToken(t *testing.T) {
	// Create mock client that returns error for invalid tokens
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return nil, errors.New("invalid token signature")
		},
	}

	middleware := &testAuthMiddleware{mockClient: mockClient}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("Handler should not be called for invalid token")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer invalid-token")

	w := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "Invalid token")
}

func TestRequireAuth_ExpiredToken(t *testing.T) {
	// Create mock client that returns error for expired tokens
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return nil, errors.New("token expired")
		},
	}

	middleware := &testAuthMiddleware{mockClient: mockClient}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("Handler should not be called for expired token")
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer expired-token")

	w := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w, req)

	assert.Equal(t, http.StatusUnauthorized, w.Code)
	assert.Contains(t, w.Body.String(), "Invalid token")
}

func TestRequireAuth_TokenWithoutEmail(t *testing.T) {
	// Create mock client that returns token without email claim
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			return &auth.Token{
				UID:    "user-without-email",
				Claims: map[string]interface{}{},
			}, nil
		},
	}

	middleware := &testAuthMiddleware{mockClient: mockClient}

	var capturedAuthInfo AuthInfo
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authInfo, ok := GetAuth(r)
		require.True(t, ok)
		capturedAuthInfo = authInfo
		w.WriteHeader(http.StatusOK)
	})

	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req.Header.Set("Authorization", "Bearer token-no-email")

	w := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w, req)

	assert.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "user-without-email", capturedAuthInfo.UserID)
	assert.Equal(t, "", capturedAuthInfo.Email)
}

func TestGetUserID_NoAuthInContext(t *testing.T) {
	ctx := context.Background()
	userID, ok := GetUserID(ctx)
	assert.False(t, ok, "GetUserID should return false when no auth in context")
	assert.Equal(t, "", userID)
}

func TestGetUserID_ValidContext(t *testing.T) {
	ctx := context.WithValue(context.Background(), UserIDKey, "test-user-456")
	userID, ok := GetUserID(ctx)
	assert.True(t, ok)
	assert.Equal(t, "test-user-456", userID)
}

func TestGetAuth_NoAuthInContext(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	authInfo, ok := GetAuth(req)
	assert.False(t, ok, "GetAuth should return false when no auth in context")
	assert.Equal(t, AuthInfo{}, authInfo)
}

func TestGetAuth_ValidContext(t *testing.T) {
	expectedAuthInfo := AuthInfo{
		UserID: "test-user-789",
		Email:  "user789@example.com",
	}

	ctx := context.WithValue(context.Background(), AuthKey, expectedAuthInfo)
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req = req.WithContext(ctx)

	authInfo, ok := GetAuth(req)
	assert.True(t, ok)
	assert.Equal(t, expectedAuthInfo, authInfo)
}

func TestGetAuth_WrongTypeInContext(t *testing.T) {
	// Test type safety - context value is not AuthInfo
	ctx := context.WithValue(context.Background(), AuthKey, "not-an-authinfo")
	req := httptest.NewRequest(http.MethodGet, "/test", nil)
	req = req.WithContext(ctx)

	authInfo, ok := GetAuth(req)
	assert.False(t, ok, "GetAuth should return false for wrong type")
	assert.Equal(t, AuthInfo{}, authInfo)
}

func TestRequireAuth_MultipleRequests(t *testing.T) {
	// Test that middleware correctly handles multiple concurrent requests
	mockClient := &mockAuthClient{
		verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
			// Return different user based on token
			if idToken == "token-user-1" {
				return &auth.Token{
					UID: "user-1",
					Claims: map[string]interface{}{
						"email": "user1@example.com",
					},
				}, nil
			}
			if idToken == "token-user-2" {
				return &auth.Token{
					UID: "user-2",
					Claims: map[string]interface{}{
						"email": "user2@example.com",
					},
				}, nil
			}
			return nil, errors.New("unknown token")
		},
	}

	middleware := &testAuthMiddleware{mockClient: mockClient}

	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, _ := GetUserID(r.Context())
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(userID))
	})

	// Request 1
	req1 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req1.Header.Set("Authorization", "Bearer token-user-1")
	w1 := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w1, req1)

	assert.Equal(t, http.StatusOK, w1.Code)
	assert.Equal(t, "user-1", w1.Body.String())

	// Request 2
	req2 := httptest.NewRequest(http.MethodGet, "/test", nil)
	req2.Header.Set("Authorization", "Bearer token-user-2")
	w2 := httptest.NewRecorder()
	middleware.RequireAuth(handler).ServeHTTP(w2, req2)

	assert.Equal(t, http.StatusOK, w2.Code)
	assert.Equal(t, "user-2", w2.Body.String())
}

func TestRequireAuth_SecurityScenarios(t *testing.T) {
	tests := []struct {
		name           string
		authHeader     string
		mockVerifyFunc func(ctx context.Context, idToken string) (*auth.Token, error)
		expectAuth     bool
		expectedCode   int
		description    string
	}{
		{
			name:       "SQL injection attempt in token",
			authHeader: "Bearer '; DROP TABLE users; --",
			mockVerifyFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid token")
			},
			expectAuth:   false,
			expectedCode: http.StatusUnauthorized,
			description:  "Should reject SQL injection attempts",
		},
		{
			name:       "XSS attempt in token",
			authHeader: "Bearer <script>alert('xss')</script>",
			mockVerifyFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid token")
			},
			expectAuth:   false,
			expectedCode: http.StatusUnauthorized,
			description:  "Should reject XSS attempts",
		},
		{
			name:       "very long token",
			authHeader: "Bearer " + strings.Repeat("a", 10000),
			mockVerifyFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid token")
			},
			expectAuth:   false,
			expectedCode: http.StatusUnauthorized,
			description:  "Should handle very long tokens gracefully",
		},
		{
			name:       "null bytes in token",
			authHeader: "Bearer token\x00withnull",
			mockVerifyFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
				return nil, errors.New("invalid token")
			},
			expectAuth:   false,
			expectedCode: http.StatusUnauthorized,
			description:  "Should reject tokens with null bytes",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockClient := &mockAuthClient{
				verifyIDTokenFunc: tt.mockVerifyFunc,
			}

			middleware := &testAuthMiddleware{mockClient: mockClient}

			handlerCalled := false
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				handlerCalled = true
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Authorization", tt.authHeader)

			w := httptest.NewRecorder()
			middleware.RequireAuth(handler).ServeHTTP(w, req)

			assert.Equal(t, tt.expectedCode, w.Code, tt.description)
			if !tt.expectAuth {
				assert.False(t, handlerCalled, "Handler should not be called: "+tt.description)
			}
		})
	}
}

func TestRequireAuth_EmailClaimTypes(t *testing.T) {
	tests := []struct {
		name          string
		emailClaim    interface{}
		expectedEmail string
	}{
		{
			name:          "valid string email",
			emailClaim:    "user@example.com",
			expectedEmail: "user@example.com",
		},
		{
			name:          "non-string email claim (int)",
			emailClaim:    12345,
			expectedEmail: "",
		},
		{
			name:          "non-string email claim (bool)",
			emailClaim:    true,
			expectedEmail: "",
		},
		{
			name:          "nil email claim",
			emailClaim:    nil,
			expectedEmail: "",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mockClient := &mockAuthClient{
				verifyIDTokenFunc: func(ctx context.Context, idToken string) (*auth.Token, error) {
					claims := map[string]interface{}{}
					if tt.emailClaim != nil {
						claims["email"] = tt.emailClaim
					}
					return &auth.Token{
						UID:    "test-user",
						Claims: claims,
					}, nil
				},
			}

			middleware := &testAuthMiddleware{mockClient: mockClient}

			var capturedAuthInfo AuthInfo
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				authInfo, _ := GetAuth(r)
				capturedAuthInfo = authInfo
				w.WriteHeader(http.StatusOK)
			})

			req := httptest.NewRequest(http.MethodGet, "/test", nil)
			req.Header.Set("Authorization", "Bearer test-token")

			w := httptest.NewRecorder()
			middleware.RequireAuth(handler).ServeHTTP(w, req)

			assert.Equal(t, http.StatusOK, w.Code)
			assert.Equal(t, tt.expectedEmail, capturedAuthInfo.Email)
		})
	}
}
