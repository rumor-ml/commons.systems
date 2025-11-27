package print

import (
	"context"
	"testing"
	"time"

	"github.com/commons-systems/filesync"
)

// mockExtractor is a mock implementation of MetadataExtractor for testing
type mockExtractor struct {
	canExtract bool
	metadata   *filesync.ExtractedMetadata
	err        error
}

func (m *mockExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	return m.metadata, m.err
}

func (m *mockExtractor) CanExtract(file filesync.FileInfo) bool {
	return m.canExtract
}

func TestChainedExtractor_Extract(t *testing.T) {
	tests := []struct {
		name       string
		extractors []filesync.MetadataExtractor
		file       filesync.FileInfo
		want       *filesync.ExtractedMetadata
		wantErr    bool
	}{
		{
			name: "single extractor success",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: true,
					metadata: &filesync.ExtractedMetadata{
						Title: "Test Title",
						Raw:   map[string]interface{}{"author": "Test Author"},
					},
				},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: &filesync.ExtractedMetadata{
				Title: "Test Title",
				Raw:   map[string]interface{}{"author": "Test Author"},
			},
			wantErr: false,
		},
		{
			name: "fill-gaps merge strategy",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: true,
					metadata: &filesync.ExtractedMetadata{
						Title: "First Title",
						Raw:   map[string]interface{}{"author": "First Author"},
					},
				},
				&mockExtractor{
					canExtract: true,
					metadata: &filesync.ExtractedMetadata{
						Title:       "Second Title", // Should not override
						Description: "Added Description",
						Raw:         map[string]interface{}{"publisher": "Publisher"},
					},
				},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: &filesync.ExtractedMetadata{
				Title:       "First Title", // From first extractor
				Description: "Added Description",
				Raw: map[string]interface{}{
					"author":    "First Author",
					"publisher": "Publisher",
				},
			},
			wantErr: false,
		},
		{
			name: "skip non-applicable extractors",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: false,
					metadata:   &filesync.ExtractedMetadata{Title: "Should Skip"},
				},
				&mockExtractor{
					canExtract: true,
					metadata:   &filesync.ExtractedMetadata{Title: "Should Use"},
				},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: &filesync.ExtractedMetadata{
				Title: "Should Use",
				Raw:   map[string]interface{}{},
			},
			wantErr: false,
		},
		{
			name: "partial failure - return partial results",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: true,
					metadata:   &filesync.ExtractedMetadata{Title: "First"},
				},
				&mockExtractor{
					canExtract: true,
					err:        &filesync.ExtractionError{Err: filesync.ErrNotFound},
				},
				&mockExtractor{
					canExtract: true,
					metadata:   &filesync.ExtractedMetadata{Description: "Third"},
				},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: &filesync.ExtractedMetadata{
				Title:       "First",
				Description: "Third",
				Raw:         map[string]interface{}{},
			},
			wantErr: false,
		},
		{
			name: "all extractors fail",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: true,
					err:        &filesync.ExtractionError{Err: filesync.ErrNotFound},
				},
				&mockExtractor{
					canExtract: true,
					err:        &filesync.ExtractionError{Err: filesync.ErrPermissionDenied},
				},
			},
			file:    filesync.FileInfo{Path: "/test/book.pdf"},
			wantErr: true,
		},
		{
			name: "merge tags without duplicates",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{
					canExtract: true,
					metadata: &filesync.ExtractedMetadata{
						Tags: []string{"tag1", "tag2"},
						Raw:  map[string]interface{}{},
					},
				},
				&mockExtractor{
					canExtract: true,
					metadata: &filesync.ExtractedMetadata{
						Tags: []string{"tag2", "tag3"},
						Raw:  map[string]interface{}{},
					},
				},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: &filesync.ExtractedMetadata{
				Tags: []string{"tag1", "tag2", "tag3"},
				Raw:  map[string]interface{}{},
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewChainedExtractor()
			for _, ex := range tt.extractors {
				c.extractors = append(c.extractors, ex)
			}

			ctx := context.Background()
			progress := make(chan filesync.Progress, 10)
			defer close(progress)

			got, err := c.Extract(ctx, tt.file, progress)

			if (err != nil) != tt.wantErr {
				t.Errorf("Extract() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			if !tt.wantErr {
				if got.Title != tt.want.Title {
					t.Errorf("Title = %v, want %v", got.Title, tt.want.Title)
				}
				if got.Description != tt.want.Description {
					t.Errorf("Description = %v, want %v", got.Description, tt.want.Description)
				}
				if len(got.Tags) != len(tt.want.Tags) {
					t.Errorf("Tags length = %v, want %v", len(got.Tags), len(tt.want.Tags))
				}
				for key, wantVal := range tt.want.Raw {
					if gotVal, exists := got.Raw[key]; !exists || gotVal != wantVal {
						t.Errorf("Raw[%s] = %v, want %v", key, gotVal, wantVal)
					}
				}
			}
		})
	}
}

func TestChainedExtractor_CanExtract(t *testing.T) {
	tests := []struct {
		name       string
		extractors []filesync.MetadataExtractor
		file       filesync.FileInfo
		want       bool
	}{
		{
			name: "at least one can extract",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{canExtract: false},
				&mockExtractor{canExtract: true},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: true,
		},
		{
			name: "none can extract",
			extractors: []filesync.MetadataExtractor{
				&mockExtractor{canExtract: false},
				&mockExtractor{canExtract: false},
			},
			file: filesync.FileInfo{Path: "/test/book.pdf"},
			want: false,
		},
		{
			name:       "empty extractors",
			extractors: []filesync.MetadataExtractor{},
			file:       filesync.FileInfo{Path: "/test/book.pdf"},
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c := NewChainedExtractor()
			for _, ex := range tt.extractors {
				c.extractors = append(c.extractors, ex)
			}

			if got := c.CanExtract(tt.file); got != tt.want {
				t.Errorf("CanExtract() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestChainedExtractor_ContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	extractor := NewChainedExtractor(
		WithExtractor(&mockExtractor{
			canExtract: true,
			metadata:   &filesync.ExtractedMetadata{Title: "Test"},
		}),
	)

	file := filesync.FileInfo{Path: "/test/book.pdf"}
	progress := make(chan filesync.Progress, 10)
	defer close(progress)

	_, err := extractor.Extract(ctx, file, progress)
	if err == nil {
		t.Error("Expected error for cancelled context")
	}

	var extractionErr *filesync.ExtractionError
	if !filesync.IsError(err, &extractionErr) {
		t.Errorf("Expected ExtractionError, got %T", err)
	}
}

func TestMergeMetadata(t *testing.T) {
	now := time.Now()
	location := &filesync.GeoLocation{Latitude: 1.0, Longitude: 2.0}

	tests := []struct {
		name   string
		dest   *filesync.ExtractedMetadata
		source *filesync.ExtractedMetadata
		want   *filesync.ExtractedMetadata
	}{
		{
			name: "fill all empty fields",
			dest: &filesync.ExtractedMetadata{
				Raw: map[string]interface{}{},
			},
			source: &filesync.ExtractedMetadata{
				CreatedAt:     &now,
				CaptureDevice: "Scanner",
				Location:      location,
				Title:         "Title",
				Description:   "Desc",
				Tags:          []string{"tag1"},
				Raw:           map[string]interface{}{"author": "Author"},
			},
			want: &filesync.ExtractedMetadata{
				CreatedAt:     &now,
				CaptureDevice: "Scanner",
				Location:      location,
				Title:         "Title",
				Description:   "Desc",
				Tags:          []string{"tag1"},
				Raw:           map[string]interface{}{"author": "Author"},
			},
		},
		{
			name: "preserve existing fields",
			dest: &filesync.ExtractedMetadata{
				Title: "Existing Title",
				Raw:   map[string]interface{}{"author": "Existing Author"},
			},
			source: &filesync.ExtractedMetadata{
				Title:       "New Title",
				Description: "New Description",
				Raw:         map[string]interface{}{"author": "New Author", "publisher": "Publisher"},
			},
			want: &filesync.ExtractedMetadata{
				Title:       "Existing Title",
				Description: "New Description",
				Raw: map[string]interface{}{
					"author":    "Existing Author",
					"publisher": "Publisher",
				},
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mergeMetadata(tt.dest, tt.source)

			if tt.dest.Title != tt.want.Title {
				t.Errorf("Title = %v, want %v", tt.dest.Title, tt.want.Title)
			}
			if tt.dest.Description != tt.want.Description {
				t.Errorf("Description = %v, want %v", tt.dest.Description, tt.want.Description)
			}
			if tt.dest.CaptureDevice != tt.want.CaptureDevice {
				t.Errorf("CaptureDevice = %v, want %v", tt.dest.CaptureDevice, tt.want.CaptureDevice)
			}
		})
	}
}

func TestNewChainedExtractor_WithOptions(t *testing.T) {
	mock1 := &mockExtractor{canExtract: true}
	mock2 := &mockExtractor{canExtract: true}

	extractor := NewChainedExtractor(
		WithExtractor(mock1),
		WithExtractor(mock2),
	)

	if len(extractor.extractors) != 2 {
		t.Errorf("Expected 2 extractors, got %d", len(extractor.extractors))
	}
}
