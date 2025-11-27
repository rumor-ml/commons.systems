package print

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/commons-systems/filesync"
	"github.com/pdfcpu/pdfcpu/pkg/api"
	"github.com/pdfcpu/pdfcpu/pkg/pdfcpu/model"
)

// PDFMetadataExtractor extracts metadata from PDF files
type PDFMetadataExtractor struct{}

// NewPDFMetadataExtractor creates a new PDFMetadataExtractor
func NewPDFMetadataExtractor() *PDFMetadataExtractor {
	return &PDFMetadataExtractor{}
}

// Extract implements filesync.MetadataExtractor
func (e *PDFMetadataExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	// Open PDF file
	f, err := os.Open(file.Path)
	if err != nil {
		return nil, &filesync.ExtractionError{
			File: file,
			Err:  fmt.Errorf("file not accessible: %w", err),
		}
	}
	defer f.Close()

	// Extract PDF info
	conf := model.NewDefaultConfiguration()
	info, err := api.PDFInfo(f, file.Path, nil, conf)
	if err != nil {
		return nil, &filesync.ExtractionError{
			File: file,
			Err:  fmt.Errorf("failed to read PDF info: %w", err),
		}
	}

	metadata := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	// Extract title
	if info.Title != "" {
		metadata.Title = info.Title
	}

	// Extract author
	if info.Author != "" {
		metadata.Raw["author"] = info.Author
	}

	// Extract subject as description
	if info.Subject != "" {
		metadata.Description = info.Subject
	}

	// Extract keywords as tags
	if len(info.Keywords) > 0 {
		// Keywords is now a []string
		tags := make([]string, 0, len(info.Keywords))
		for _, keyword := range info.Keywords {
			trimmed := strings.TrimSpace(keyword)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}
		metadata.Tags = tags
	}

	// Extract creation date
	if info.CreationDate != "" {
		createdAt, err := parseInfoDate(info.CreationDate)
		if err == nil {
			metadata.CreatedAt = &createdAt
		}
	}

	// Extract producer (could be the scanner/capture device)
	if info.Producer != "" {
		metadata.Raw["producer"] = info.Producer
	}

	// Extract creator (software that created the original document)
	if info.Creator != "" {
		metadata.Raw["creator"] = info.Creator
	}

	return metadata, nil
}

// CanExtract implements filesync.MetadataExtractor
func (e *PDFMetadataExtractor) CanExtract(file filesync.FileInfo) bool {
	ext := strings.ToLower(filepath.Ext(file.Path))
	return ext == ".pdf" || file.MimeType == "application/pdf"
}

// parseInfoDate parses PDF info date format (D:YYYYMMDDHHmmSSOHH'mm)
// Example: D:20230115120000+00'00
func parseInfoDate(dateStr string) (time.Time, error) {
	// Remove D: prefix if present
	dateStr = strings.TrimPrefix(dateStr, "D:")

	// Try various date formats used in PDF
	formats := []string{
		"20060102150405-07'00'",
		"20060102150405+07'00'",
		"20060102150405Z07'00'",
		"20060102150405",
		"20060102",
	}

	// Clean up timezone format (remove quotes)
	dateStr = strings.ReplaceAll(dateStr, "'", "")

	for _, format := range formats {
		cleanFormat := strings.ReplaceAll(format, "'", "")
		if t, err := time.Parse(cleanFormat, dateStr); err == nil {
			return t, nil
		}
	}

	return time.Time{}, fmt.Errorf("unable to parse date: %s", dateStr)
}
