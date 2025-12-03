package print

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	"github.com/commons-systems/filesync"
)

// OpenLibraryExtractor queries openlibrary.org for additional metadata
type OpenLibraryExtractor struct {
	client  *http.Client
	timeout time.Duration
	baseURL string
}

// OpenLibraryOption configures an OpenLibraryExtractor
type OpenLibraryOption func(*OpenLibraryExtractor)

// WithHTTPClient sets a custom HTTP client
func WithHTTPClient(client *http.Client) OpenLibraryOption {
	return func(e *OpenLibraryExtractor) {
		e.client = client
	}
}

// WithTimeout sets the request timeout
func WithTimeout(timeout time.Duration) OpenLibraryOption {
	return func(e *OpenLibraryExtractor) {
		e.timeout = timeout
	}
}

// WithBaseURL sets a custom base URL (useful for testing)
func WithBaseURL(baseURL string) OpenLibraryOption {
	return func(e *OpenLibraryExtractor) {
		e.baseURL = baseURL
	}
}

// NewOpenLibraryExtractor creates a new OpenLibraryExtractor
func NewOpenLibraryExtractor(opts ...OpenLibraryOption) *OpenLibraryExtractor {
	e := &OpenLibraryExtractor{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		timeout: 10 * time.Second,
		baseURL: "https://openlibrary.org",
	}

	for _, opt := range opts {
		opt(e)
	}

	// Ensure client has timeout set
	if e.client.Timeout == 0 {
		e.client.Timeout = e.timeout
	}

	return e
}

// Extract implements filesync.MetadataExtractor
// Fails gracefully - returns empty metadata on errors instead of failing
func (e *OpenLibraryExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	metadata := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	// We need either an ISBN or a title to query
	// This extractor depends on previous extractors having populated some metadata
	// Since we can't access previously extracted metadata here, we return empty metadata
	// This extractor is meant to be used in a chain where it can access file metadata

	// For now, return empty metadata - this will be populated by the chain
	// when it has access to ISBN or title from previous extractors
	return metadata, nil
}

// ExtractWithMetadata extracts additional metadata from OpenLibrary using existing metadata
// This is a helper method that can be called by the chain with previously extracted metadata
func (e *OpenLibraryExtractor) ExtractWithMetadata(ctx context.Context, existingMetadata *filesync.ExtractedMetadata) (*filesync.ExtractedMetadata, error) {
	if existingMetadata == nil {
		return &filesync.ExtractedMetadata{Raw: make(map[string]interface{})}, nil
	}

	// Try to find ISBN first
	if isbn, ok := existingMetadata.Raw["isbn"].(string); ok && isbn != "" {
		if data, err := e.queryByISBN(ctx, isbn); err == nil {
			return data, nil
		}
	}

	// Fall back to title search
	if existingMetadata.Title != "" {
		if data, err := e.queryByTitle(ctx, existingMetadata.Title); err == nil {
			return data, nil
		}
	}

	// Return empty metadata on failure (graceful failure)
	return &filesync.ExtractedMetadata{Raw: make(map[string]interface{})}, nil
}

// CanExtract implements filesync.MetadataExtractor
// Can extract from PDF and EPUB files that might have ISBN or title metadata
func (e *OpenLibraryExtractor) CanExtract(file filesync.FileInfo) bool {
	ext := strings.ToLower(filepath.Ext(file.Path))
	return ext == ".pdf" || ext == ".epub"
}

// queryByISBN queries OpenLibrary by ISBN
func (e *OpenLibraryExtractor) queryByISBN(ctx context.Context, isbn string) (*filesync.ExtractedMetadata, error) {
	// Clean ISBN (remove dashes and spaces)
	isbn = strings.ReplaceAll(strings.ReplaceAll(isbn, "-", ""), " ", "")

	url := fmt.Sprintf("%s/isbn/%s.json", e.baseURL, isbn)

	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	return e.parseBookData(body)
}

// queryByTitle queries OpenLibrary by title
func (e *OpenLibraryExtractor) queryByTitle(ctx context.Context, title string) (*filesync.ExtractedMetadata, error) {
	searchURL := fmt.Sprintf("%s/search.json?title=%s&limit=1", e.baseURL, url.QueryEscape(title))

	req, err := http.NewRequestWithContext(ctx, "GET", searchURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := e.client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("unexpected status code: %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var searchResult struct {
		Docs []json.RawMessage `json:"docs"`
	}

	if err := json.Unmarshal(body, &searchResult); err != nil {
		return nil, err
	}

	if len(searchResult.Docs) == 0 {
		return nil, fmt.Errorf("no results found")
	}

	return e.parseBookData(searchResult.Docs[0])
}

// parseBookData parses OpenLibrary book data into ExtractedMetadata
func (e *OpenLibraryExtractor) parseBookData(data []byte) (*filesync.ExtractedMetadata, error) {
	var book struct {
		Title       string   `json:"title"`
		Authors     []struct {
			Name string `json:"name"`
		} `json:"authors"`
		AuthorName  []string `json:"author_name"`
		Publishers  []string `json:"publishers"`
		Publisher   []string `json:"publisher"`
		Description interface{} `json:"description"`
		Subjects    []string `json:"subjects"`
		Subject     []string `json:"subject"`
		FirstPublishYear int `json:"first_publish_year"`
	}

	if err := json.Unmarshal(data, &book); err != nil {
		return nil, err
	}

	metadata := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	// Extract title
	if book.Title != "" {
		metadata.Title = book.Title
	}

	// Extract author
	var author string
	if len(book.Authors) > 0 && book.Authors[0].Name != "" {
		author = book.Authors[0].Name
	} else if len(book.AuthorName) > 0 {
		author = book.AuthorName[0]
	}
	if author != "" {
		metadata.Raw["author"] = author
	}

	// Extract publisher
	var publisher string
	if len(book.Publishers) > 0 {
		publisher = book.Publishers[0]
	} else if len(book.Publisher) > 0 {
		publisher = book.Publisher[0]
	}
	if publisher != "" {
		metadata.Raw["publisher"] = publisher
	}

	// Extract description
	if book.Description != nil {
		switch desc := book.Description.(type) {
		case string:
			metadata.Description = desc
		case map[string]interface{}:
			if value, ok := desc["value"].(string); ok {
				metadata.Description = value
			}
		}
	}

	// Extract subjects as tags
	subjects := book.Subjects
	if len(subjects) == 0 {
		subjects = book.Subject
	}
	if len(subjects) > 0 {
		// Limit to first 10 subjects to avoid too many tags
		maxSubjects := 10
		if len(subjects) > maxSubjects {
			subjects = subjects[:maxSubjects]
		}
		metadata.Tags = subjects
	}

	// Store first publish year
	if book.FirstPublishYear > 0 {
		metadata.Raw["first_publish_year"] = book.FirstPublishYear
	}

	return metadata, nil
}
