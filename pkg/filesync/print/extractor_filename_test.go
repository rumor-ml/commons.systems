package print

import (
	"context"
	"testing"

	"github.com/commons-systems/filesync"
)

func TestFilenameExtractor_Extract(t *testing.T) {
	tests := []struct {
		name       string
		filename   string
		wantTitle  string
		wantAuthor string
		wantSeries string
		wantVolume string
		wantISBN   string
	}{
		{
			name:       "author dash title pattern",
			filename:   "John Smith - The Great Book.pdf",
			wantTitle:  "The Great Book",
			wantAuthor: "John Smith",
		},
		{
			name:       "title with author in parentheses",
			filename:   "The Great Book (John Smith).epub",
			wantTitle:  "The Great Book",
			wantAuthor: "John Smith",
		},
		{
			name:       "series with hash number",
			filename:   "Star Wars #01 - A New Hope.pdf",
			wantTitle:  "A New Hope",
			wantSeries: "Star Wars",
			wantVolume: "01",
		},
		{
			name:       "series with vol prefix",
			filename:   "Harry Potter Vol 1 - The Philosopher's Stone.epub",
			wantTitle:  "The Philosopher's Stone",
			wantSeries: "Harry Potter",
			wantVolume: "1",
		},
		{
			name:      "ISBN in brackets",
			filename:  "Some Book [ISBN-13: 9781234567890].pdf",
			wantTitle: "Some Book",
			wantISBN:  "9781234567890",
		},
		{
			name:      "ISBN in parentheses",
			filename:  "Another Book (ISBN: 1234567890).epub",
			wantTitle: "Another Book",
			wantISBN:  "1234567890",
		},
		{
			name:      "no pattern match - use filename as title",
			filename:  "JustASimpleFilename.pdf",
			wantTitle: "JustASimpleFilename",
		},
		{
			name:       "complex filename with author and ISBN",
			filename:   "George Orwell - 1984 [ISBN: 9780451524935].pdf",
			wantTitle:  "1984",
			wantAuthor: "George Orwell",
			wantISBN:   "9780451524935",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e := NewFilenameExtractor()
			file := filesync.FileInfo{Path: "/test/" + tt.filename}
			ctx := context.Background()
			progress := make(chan filesync.Progress, 10)
			defer close(progress)

			metadata, err := e.Extract(ctx, file, progress)
			if err != nil {
				t.Errorf("Extract() error = %v", err)
				return
			}

			if metadata.Title != tt.wantTitle {
				t.Errorf("Title = %v, want %v", metadata.Title, tt.wantTitle)
			}

			if tt.wantAuthor != "" {
				author, ok := metadata.Raw["author"].(string)
				if !ok || author != tt.wantAuthor {
					t.Errorf("Author = %v, want %v", author, tt.wantAuthor)
				}
			}

			if tt.wantSeries != "" {
				series, ok := metadata.Raw["series"].(string)
				if !ok || series != tt.wantSeries {
					t.Errorf("Series = %v, want %v", series, tt.wantSeries)
				}
			}

			if tt.wantVolume != "" {
				volume, ok := metadata.Raw["volume"].(string)
				if !ok || volume != tt.wantVolume {
					t.Errorf("Volume = %v, want %v", volume, tt.wantVolume)
				}
			}

			if tt.wantISBN != "" {
				isbn, ok := metadata.Raw["isbn"].(string)
				if !ok || isbn != tt.wantISBN {
					t.Errorf("ISBN = %v, want %v", isbn, tt.wantISBN)
				}
			}
		})
	}
}

func TestFilenameExtractor_CanExtract(t *testing.T) {
	e := NewFilenameExtractor()

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
			name: "any file",
			file: filesync.FileInfo{Path: "/test/anything.txt"},
			want: true,
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

func TestFilenameExtractor_EdgeCases(t *testing.T) {
	e := NewFilenameExtractor()
	ctx := context.Background()
	progress := make(chan filesync.Progress, 10)
	defer close(progress)

	tests := []struct {
		name     string
		filename string
	}{
		{
			name:     "empty filename",
			filename: "",
		},
		{
			name:     "filename with multiple dashes",
			filename: "Author - Title - Subtitle.pdf",
		},
		{
			name:     "filename with special characters",
			filename: "Author's Name - Book: The Title!.pdf",
		},
		{
			name:     "filename with multiple extensions",
			filename: "Book.tar.gz",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file := filesync.FileInfo{Path: "/test/" + tt.filename}
			metadata, err := e.Extract(ctx, file, progress)
			if err != nil {
				t.Errorf("Extract() should not error on edge cases, got: %v", err)
			}
			if metadata == nil {
				t.Error("Extract() should return metadata even for edge cases")
			}
		})
	}
}
