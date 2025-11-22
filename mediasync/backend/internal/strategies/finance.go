package strategies

import (
	"context"
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// FinanceStrategy handles financial statements (bank statements, invoices, etc.)
type FinanceStrategy struct {
	enabled bool
}

// NewFinanceStrategy creates a new finance strategy
func NewFinanceStrategy(enabled bool) *FinanceStrategy {
	return &FinanceStrategy{
		enabled: enabled,
	}
}

// Name returns the strategy name
func (s *FinanceStrategy) Name() string {
	return "finance"
}

// FileExtensions returns supported finance file extensions
func (s *FinanceStrategy) FileExtensions() []string {
	return []string{".pdf", ".csv", ".xls", ".xlsx", ".ofx", ".qfx"}
}

// IsEnabled returns whether this strategy is enabled
func (s *FinanceStrategy) IsEnabled() bool {
	return s.enabled
}

// ExtractMetadata extracts metadata from a finance file
func (s *FinanceStrategy) ExtractMetadata(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error) {
	logs = []string{}
	metadata = make(map[string]interface{})

	// TODO: Implement PDF text extraction, CSV parsing, OFX parsing
	logs = append(logs, "Finance metadata extraction not yet implemented - using filename")

	fileName := filepath.Base(filePath)
	ext := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(fileName, ext)

	metadata["filename"] = fileName
	metadata["basename"] = baseName
	metadata["extension"] = ext
	metadata["mediaType"] = "finance"

	// Try to extract date from filename (YYYY-MM-DD or YYYYMMDD format)
	datePattern := regexp.MustCompile(`(\d{4})-?(\d{2})-?(\d{2})`)
	if matches := datePattern.FindStringSubmatch(baseName); matches != nil {
		dateStr := matches[1] + "-" + matches[2] + "-" + matches[3]
		if date, err := time.Parse("2006-01-02", dateStr); err == nil {
			metadata["date"] = date.Format("2006-01-02")
			metadata["year"] = date.Year()
			metadata["month"] = int(date.Month())
			logs = append(logs, "Extracted date from filename: "+dateStr)
		}
	}

	// Try to extract institution name
	// Common patterns: "Bank_Statement", "Chase_", "BankOfAmerica_"
	lowerName := strings.ToLower(baseName)
	institutions := []string{"chase", "wellsfargo", "bankofamerica", "citi", "usbank", "pnc", "capitalone"}
	for _, inst := range institutions {
		if strings.Contains(lowerName, inst) {
			metadata["institution"] = strings.Title(inst)
			logs = append(logs, "Detected institution: "+strings.Title(inst))
			break
		}
	}

	return metadata, logs, nil
}

// NormalizePath generates a normalized GCS path for finance files
func (s *FinanceStrategy) NormalizePath(metadata map[string]interface{}, fileName string) (string, error) {
	// Default format: year/month/institution_date.ext
	// Fallback: uncategorized/filename

	year, _ := metadata["year"].(int)
	month, _ := metadata["month"].(int)
	institution, _ := metadata["institution"].(string)
	date, _ := metadata["date"].(string)

	if year == 0 {
		year = time.Now().Year()
	}
	if month == 0 {
		month = int(time.Now().Month())
	}
	if institution == "" {
		institution = "Unknown"
	}

	institution = sanitizePathComponent(institution)
	ext := filepath.Ext(fileName)

	// Build filename: institution_date.ext or institution.ext
	var finalName string
	if date != "" {
		finalName = institution + "_" + date + ext
	} else {
		finalName = institution + ext
	}

	// Build path: year/month/filename
	monthStr := time.Month(month).String()
	return filepath.Join(
		fmt.Sprintf("%d", year),
		monthStr,
		finalName,
	), nil
}
