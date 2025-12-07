package print

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/commons-systems/filesync"
)

func TestOpenLibraryExtractor_QueryByISBN(t *testing.T) {
	// Create a mock HTTP server
	mockResponse := map[string]interface{}{
		"title": "Test Book",
		"authors": []map[string]string{
			{"name": "Test Author"},
		},
		"publishers":         []string{"Test Publisher"},
		"first_publish_year": 2020,
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/isbn/9781234567890.json" {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockResponse)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(
		WithBaseURL(server.URL),
		WithTimeout(5*time.Second),
	)

	ctx := context.Background()
	metadata, err := e.queryByISBN(ctx, "978-1-234-56789-0")

	if err != nil {
		t.Errorf("queryByISBN() unexpected error: %v", err)
		return
	}

	if metadata.Title != "Test Book" {
		t.Errorf("Title = %v, want %v", metadata.Title, "Test Book")
	}

	if author, ok := metadata.Raw["author"].(string); !ok || author != "Test Author" {
		t.Errorf("Author = %v, want %v", author, "Test Author")
	}

	if publisher, ok := metadata.Raw["publisher"].(string); !ok || publisher != "Test Publisher" {
		t.Errorf("Publisher = %v, want %v", publisher, "Test Publisher")
	}
}

func TestOpenLibraryExtractor_QueryByTitle(t *testing.T) {
	mockResponse := map[string]interface{}{
		"docs": []map[string]interface{}{
			{
				"title":       "Search Result Book",
				"author_name": []string{"Search Author"},
				"publisher":   []string{"Search Publisher"},
			},
		},
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/search.json" {
			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(mockResponse)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(WithBaseURL(server.URL))

	ctx := context.Background()
	metadata, err := e.queryByTitle(ctx, "Test Title")

	if err != nil {
		t.Errorf("queryByTitle() unexpected error: %v", err)
		return
	}

	if metadata.Title != "Search Result Book" {
		t.Errorf("Title = %v, want %v", metadata.Title, "Search Result Book")
	}

	if author, ok := metadata.Raw["author"].(string); !ok || author != "Search Author" {
		t.Errorf("Author = %v, want %v", author, "Search Author")
	}
}

func TestOpenLibraryExtractor_CanExtract(t *testing.T) {
	e := NewOpenLibraryExtractor()

	tests := []struct {
		name string
		file filesync.FileInfo
		want bool
	}{
		{
			name: "PDF file",
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: true,
		},
		{
			name: "EPUB file",
			file: filesync.FileInfo{Path: "/test/book.epub"},
			want: true,
		},
		{
			name: "text file",
			file: filesync.FileInfo{Path: "/test/file.txt"},
			want: false,
		},
		{
			name: "CBZ file",
			file: filesync.FileInfo{Path: "/test/comic.cbz"},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := e.CanExtract(tt.file); got != tt.want {
				t.Errorf("CanExtract() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestOpenLibraryExtractor_GracefulFailure(t *testing.T) {
	// Server that returns errors
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(WithBaseURL(server.URL))

	ctx := context.Background()

	// Test ISBN query failure
	_, err := e.queryByISBN(ctx, "1234567890")
	if err == nil {
		t.Error("Expected error for failed ISBN query")
	}

	// Test title query failure
	_, err = e.queryByTitle(ctx, "Test Title")
	if err == nil {
		t.Error("Expected error for failed title query")
	}
}

func TestOpenLibraryExtractor_ExtractWithMetadata(t *testing.T) {
	mockResponse := map[string]interface{}{
		"title": "Enhanced Book",
		"authors": []map[string]string{
			{"name": "Enhanced Author"},
		},
		"description": "Enhanced description",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(mockResponse)
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(WithBaseURL(server.URL))

	tests := []struct {
		name             string
		existingMetadata *filesync.ExtractedMetadata
		wantErr          bool
	}{
		{
			name: "with ISBN",
			existingMetadata: &filesync.ExtractedMetadata{
				Title: "Original Title",
				Raw: map[string]interface{}{
					"isbn": "9781234567890",
				},
			},
			wantErr: false,
		},
		{
			name: "with title only",
			existingMetadata: &filesync.ExtractedMetadata{
				Title: "Original Title",
				Raw:   map[string]interface{}{},
			},
			wantErr: false,
		},
		{
			name:             "nil metadata",
			existingMetadata: nil,
			wantErr:          false,
		},
		{
			name: "empty metadata",
			existingMetadata: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx := context.Background()
			metadata, err := e.ExtractWithMetadata(ctx, tt.existingMetadata)

			if (err != nil) != tt.wantErr {
				t.Errorf("ExtractWithMetadata() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if metadata == nil {
				t.Error("Expected metadata, got nil")
			}
		})
	}
}

func TestOpenLibraryExtractor_ParseBookData(t *testing.T) {
	tests := []struct {
		name          string
		jsonData      string
		wantTitle     string
		wantAuthor    string
		wantPublisher string
	}{
		{
			name: "full book data",
			jsonData: `{
				"title": "Test Book",
				"authors": [{"name": "Test Author"}],
				"publishers": ["Test Publisher"],
				"description": "Test description",
				"first_publish_year": 2020
			}`,
			wantTitle:     "Test Book",
			wantAuthor:    "Test Author",
			wantPublisher: "Test Publisher",
		},
		{
			name: "search result format",
			jsonData: `{
				"title": "Search Book",
				"author_name": ["Search Author"],
				"publisher": ["Search Publisher"]
			}`,
			wantTitle:     "Search Book",
			wantAuthor:    "Search Author",
			wantPublisher: "Search Publisher",
		},
		{
			name: "description as object",
			jsonData: `{
				"title": "Object Desc Book",
				"description": {"value": "Description value"}
			}`,
			wantTitle: "Object Desc Book",
		},
		{
			name:      "minimal data",
			jsonData:  `{"title": "Minimal Book"}`,
			wantTitle: "Minimal Book",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := NewOpenLibraryExtractor()
			metadata, err := e.parseBookData([]byte(tt.jsonData))

			if err != nil {
				t.Errorf("parseBookData() unexpected error: %v", err)
				return
			}

			if metadata.Title != tt.wantTitle {
				t.Errorf("Title = %v, want %v", metadata.Title, tt.wantTitle)
			}

			if tt.wantAuthor != "" {
				if author, ok := metadata.Raw["author"].(string); !ok || author != tt.wantAuthor {
					t.Errorf("Author = %v, want %v", author, tt.wantAuthor)
				}
			}

			if tt.wantPublisher != "" {
				if publisher, ok := metadata.Raw["publisher"].(string); !ok || publisher != tt.wantPublisher {
					t.Errorf("Publisher = %v, want %v", publisher, tt.wantPublisher)
				}
			}
		})
	}
}

func TestOpenLibraryExtractor_Timeout(t *testing.T) {
	// Server that delays response
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(
		WithBaseURL(server.URL),
		WithTimeout(100*time.Millisecond),
	)

	ctx := context.Background()
	_, err := e.queryByISBN(ctx, "1234567890")

	if err == nil {
		t.Error("Expected timeout error")
	}
}

func TestOpenLibraryExtractor_ContextCancellation(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(1 * time.Second)
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(WithBaseURL(server.URL))

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err := e.queryByISBN(ctx, "1234567890")

	if err == nil {
		t.Error("Expected error for cancelled context")
	}
}

func TestOpenLibraryExtractor_NoResults(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"docs": []interface{}{},
		})
	}))
	defer server.Close()

	e := NewOpenLibraryExtractor(WithBaseURL(server.URL))

	ctx := context.Background()
	_, err := e.queryByTitle(ctx, "Nonexistent Book")

	if err == nil {
		t.Error("Expected error for no results")
	}
}
