package print

import (
	"archive/zip"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"github.com/commons-systems/filesync"
)

// EPUBMetadataExtractor extracts metadata from EPUB files
type EPUBMetadataExtractor struct{}

// NewEPUBMetadataExtractor creates a new EPUBMetadataExtractor
func NewEPUBMetadataExtractor() *EPUBMetadataExtractor {
	return &EPUBMetadataExtractor{}
}

// Extract implements filesync.MetadataExtractor
func (e *EPUBMetadataExtractor) Extract(ctx context.Context, file filesync.FileInfo, progress chan<- filesync.Progress) (*filesync.ExtractedMetadata, error) {
	// Open EPUB file as ZIP archive
	reader, err := zip.OpenReader(file.Path)
	if err != nil {
		return nil, &filesync.ExtractionError{
			File: file,
			Err:  fmt.Errorf("failed to open EPUB file: %w", err),
		}
	}
	defer reader.Close()

	// Find and parse container.xml to locate OPF file
	opfPath, err := findOPFPath(reader)
	if err != nil {
		return nil, &filesync.ExtractionError{
			File: file,
			Err:  fmt.Errorf("failed to find OPF file: %w", err),
		}
	}

	// Parse OPF file
	opfData, err := readOPFFile(reader, opfPath)
	if err != nil {
		return nil, &filesync.ExtractionError{
			File: file,
			Err:  fmt.Errorf("failed to read OPF file: %w", err),
		}
	}

	// Extract metadata from OPF
	metadata := extractOPFMetadata(opfData)
	return metadata, nil
}

// CanExtract implements filesync.MetadataExtractor
func (e *EPUBMetadataExtractor) CanExtract(file filesync.FileInfo) bool {
	ext := strings.ToLower(filepath.Ext(file.Path))
	return ext == ".epub" || file.MimeType == "application/epub+zip"
}

// findOPFPath locates the OPF file path from container.xml
func findOPFPath(reader *zip.ReadCloser) (string, error) {
	// Look for META-INF/container.xml
	for _, f := range reader.File {
		if f.Name == "META-INF/container.xml" {
			rc, err := f.Open()
			if err != nil {
				return "", err
			}
			defer rc.Close()

			data, err := io.ReadAll(rc)
			if err != nil {
				return "", err
			}

			var container struct {
				Rootfiles struct {
					Rootfile []struct {
						FullPath  string `xml:"full-path,attr"`
						MediaType string `xml:"media-type,attr"`
					} `xml:"rootfile"`
				} `xml:"rootfiles"`
			}

			if err := xml.Unmarshal(data, &container); err != nil {
				return "", err
			}

			// Find the OPF file
			for _, rf := range container.Rootfiles.Rootfile {
				if rf.MediaType == "application/oebps-package+xml" {
					return rf.FullPath, nil
				}
			}

			return "", fmt.Errorf("OPF file not found in container.xml")
		}
	}

	return "", fmt.Errorf("container.xml not found")
}

// readOPFFile reads and returns the OPF file content
func readOPFFile(reader *zip.ReadCloser, opfPath string) ([]byte, error) {
	for _, f := range reader.File {
		if f.Name == opfPath {
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			defer rc.Close()

			return io.ReadAll(rc)
		}
	}

	return nil, fmt.Errorf("OPF file %s not found in archive", opfPath)
}

// extractOPFMetadata parses OPF XML and extracts metadata
func extractOPFMetadata(data []byte) *filesync.ExtractedMetadata {
	var opf struct {
		Metadata struct {
			Title       []string `xml:"http://purl.org/dc/elements/1.1/ title"`
			Creator     []string `xml:"http://purl.org/dc/elements/1.1/ creator"`
			Publisher   []string `xml:"http://purl.org/dc/elements/1.1/ publisher"`
			Description []string `xml:"http://purl.org/dc/elements/1.1/ description"`
			Subject     []string `xml:"http://purl.org/dc/elements/1.1/ subject"`
			Identifier  []struct {
				Value  string `xml:",chardata"`
				Scheme string `xml:"scheme,attr"`
			} `xml:"http://purl.org/dc/elements/1.1/ identifier"`
			Meta []struct {
				Name    string `xml:"name,attr"`
				Content string `xml:"content,attr"`
			} `xml:"meta"`
		} `xml:"metadata"`
	}

	xml.Unmarshal(data, &opf)

	metadata := &filesync.ExtractedMetadata{
		Raw: make(map[string]interface{}),
	}

	// Extract title
	if len(opf.Metadata.Title) > 0 {
		metadata.Title = strings.TrimSpace(opf.Metadata.Title[0])
	}

	// Extract author (creator)
	if len(opf.Metadata.Creator) > 0 {
		metadata.Raw["author"] = strings.TrimSpace(opf.Metadata.Creator[0])
	}

	// Extract publisher
	if len(opf.Metadata.Publisher) > 0 {
		metadata.Raw["publisher"] = strings.TrimSpace(opf.Metadata.Publisher[0])
	}

	// Extract description
	if len(opf.Metadata.Description) > 0 {
		metadata.Description = strings.TrimSpace(opf.Metadata.Description[0])
	}

	// Extract subjects as tags
	if len(opf.Metadata.Subject) > 0 {
		tags := make([]string, 0, len(opf.Metadata.Subject))
		for _, subject := range opf.Metadata.Subject {
			trimmed := strings.TrimSpace(subject)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}
		metadata.Tags = tags
	}

	// Extract ISBN
	for _, id := range opf.Metadata.Identifier {
		scheme := strings.ToLower(id.Scheme)
		if scheme == "isbn" || strings.Contains(strings.ToLower(id.Value), "isbn") {
			metadata.Raw["isbn"] = strings.TrimSpace(id.Value)
			break
		}
	}

	// Extract Calibre series metadata
	var series, seriesIndex string
	for _, meta := range opf.Metadata.Meta {
		switch meta.Name {
		case "calibre:series":
			series = meta.Content
		case "calibre:series_index":
			seriesIndex = meta.Content
		}
	}

	if series != "" {
		metadata.Raw["series"] = series
		if seriesIndex != "" {
			metadata.Raw["volume"] = seriesIndex
		}
	}

	return metadata
}
