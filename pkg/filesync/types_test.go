package filesync

import (
	"strings"
	"testing"
)

// TestProgress_Validate_Valid tests that valid Progress structs pass validation
func TestProgress_Validate_Valid(t *testing.T) {
	tests := []struct {
		name     string
		progress Progress
	}{
		{
			name: "valid operation progress",
			progress: Progress{
				Type:           ProgressTypeOperation,
				Operation:      "uploading",
				File:           "/path/to/file.jpg",
				BytesProcessed: 50,
				TotalBytes:     100,
				Percentage:     50.0,
				Message:        "Uploading",
			},
		},
		{
			name: "valid status progress",
			progress: Progress{
				Type:       ProgressTypeStatus,
				Operation:  "stats-flush",
				Percentage: 0,
				Message:    "Stats update recovered",
			},
		},
		{
			name: "valid error progress",
			progress: Progress{
				Type:       ProgressTypeError,
				Operation:  "upload-failed",
				Percentage: 0,
				Message:    "Upload failed",
			},
		},
		{
			name: "zero percentage",
			progress: Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 0,
				TotalBytes:     100,
				Percentage:     0,
			},
		},
		{
			name: "100 percentage",
			progress: Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 100,
				TotalBytes:     100,
				Percentage:     100,
			},
		},
		{
			name: "zero total bytes (status message)",
			progress: Progress{
				Type:           ProgressTypeStatus,
				BytesProcessed: 0,
				TotalBytes:     0,
				Percentage:     0,
			},
		},
		{
			name: "bytes equal total",
			progress: Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 1024,
				TotalBytes:     1024,
				Percentage:     100,
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.progress.Validate()
			if err != nil {
				t.Errorf("Validate() failed for valid progress: %v", err)
			}
		})
	}
}

// TestProgress_Validate_InvalidPercentage tests percentage validation
func TestProgress_Validate_InvalidPercentage(t *testing.T) {
	tests := []struct {
		name       string
		percentage float64
		wantErr    string
	}{
		{
			name:       "negative percentage",
			percentage: -1.0,
			wantErr:    "percentage must be 0-100, got -1.00",
		},
		{
			name:       "percentage over 100",
			percentage: 101.0,
			wantErr:    "percentage must be 0-100, got 101.00",
		},
		{
			name:       "percentage 150",
			percentage: 150.5,
			wantErr:    "percentage must be 0-100, got 150.50",
		},
		{
			name:       "very negative percentage",
			percentage: -999.99,
			wantErr:    "percentage must be 0-100, got -999.99",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			progress := Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 50,
				TotalBytes:     100,
				Percentage:     tt.percentage,
			}

			err := progress.Validate()
			if err == nil {
				t.Errorf("Validate() should have failed for percentage %.2f", tt.percentage)
				return
			}

			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Validate() error = %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestProgress_Validate_NegativeBytes tests that negative byte values fail validation
func TestProgress_Validate_NegativeBytes(t *testing.T) {
	tests := []struct {
		name           string
		bytesProcessed int64
		totalBytes     int64
		wantErr        string
	}{
		{
			name:           "negative bytesProcessed",
			bytesProcessed: -1,
			totalBytes:     100,
			wantErr:        "bytesProcessed cannot be negative, got -1",
		},
		{
			name:           "negative totalBytes",
			bytesProcessed: 50,
			totalBytes:     -100,
			wantErr:        "totalBytes cannot be negative, got -100",
		},
		{
			name:           "both negative",
			bytesProcessed: -50,
			totalBytes:     -100,
			wantErr:        "bytesProcessed cannot be negative", // First check fails
		},
		{
			name:           "large negative bytesProcessed",
			bytesProcessed: -999999,
			totalBytes:     100,
			wantErr:        "bytesProcessed cannot be negative, got -999999",
		},
		{
			name:           "large negative totalBytes",
			bytesProcessed: 0,
			totalBytes:     -999999,
			wantErr:        "totalBytes cannot be negative, got -999999",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			progress := Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: tt.bytesProcessed,
				TotalBytes:     tt.totalBytes,
				Percentage:     50.0,
			}

			err := progress.Validate()
			if err == nil {
				t.Errorf("Validate() should have failed for negative bytes")
				return
			}

			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Validate() error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestProgress_Validate_BytesExceedTotal tests that bytesProcessed > totalBytes fails
func TestProgress_Validate_BytesExceedTotal(t *testing.T) {
	tests := []struct {
		name           string
		bytesProcessed int64
		totalBytes     int64
		wantErr        string
	}{
		{
			name:           "bytesProcessed exceeds totalBytes by 1",
			bytesProcessed: 101,
			totalBytes:     100,
			wantErr:        "bytesProcessed (101) cannot exceed totalBytes (100)",
		},
		{
			name:           "bytesProcessed much larger than totalBytes",
			bytesProcessed: 1000,
			totalBytes:     100,
			wantErr:        "bytesProcessed (1000) cannot exceed totalBytes (100)",
		},
		{
			name:           "totalBytes zero, bytesProcessed positive (status message)",
			bytesProcessed: 0,
			totalBytes:     0,
			wantErr:        "", // Should be valid - no error expected
		},
		{
			name:           "bytesProcessed exceeds by large amount",
			bytesProcessed: 999999,
			totalBytes:     1024,
			wantErr:        "bytesProcessed (999999) cannot exceed totalBytes (1024)",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			progress := Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: tt.bytesProcessed,
				TotalBytes:     tt.totalBytes,
				Percentage:     50.0,
			}

			err := progress.Validate()

			if tt.wantErr == "" {
				// This case should be valid
				if err != nil {
					t.Errorf("Validate() failed unexpectedly: %v", err)
				}
			} else {
				// This case should fail
				if err == nil {
					t.Errorf("Validate() should have failed when bytesProcessed > totalBytes")
					return
				}

				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Errorf("Validate() error = %q, want substring %q", err.Error(), tt.wantErr)
				}
			}
		})
	}
}

// TestProgress_Validate_InvalidType tests that invalid ProgressType values fail
func TestProgress_Validate_InvalidType(t *testing.T) {
	tests := []struct {
		name    string
		ptype   ProgressType
		wantErr string
	}{
		{
			name:    "empty string type",
			ptype:   "",
			wantErr: "invalid progress type",
		},
		{
			name:    "random string type",
			ptype:   "invalid",
			wantErr: "invalid progress type",
		},
		{
			name:    "typo in operation",
			ptype:   "operaton",
			wantErr: "invalid progress type",
		},
		{
			name:    "typo in status",
			ptype:   "stat",
			wantErr: "invalid progress type",
		},
		{
			name:    "uppercase type",
			ptype:   "OPERATION",
			wantErr: "invalid progress type",
		},
		{
			name:    "numeric type",
			ptype:   "123",
			wantErr: "invalid progress type",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			progress := Progress{
				Type:           tt.ptype,
				BytesProcessed: 50,
				TotalBytes:     100,
				Percentage:     50.0,
			}

			err := progress.Validate()
			if err == nil {
				t.Errorf("Validate() should have failed for invalid type %q", tt.ptype)
				return
			}

			if !strings.Contains(err.Error(), tt.wantErr) {
				t.Errorf("Validate() error = %q, want substring %q", err.Error(), tt.wantErr)
			}
		})
	}
}

// TestProgress_Validate_AllValidTypes tests that all valid ProgressType constants pass
func TestProgress_Validate_AllValidTypes(t *testing.T) {
	validTypes := []ProgressType{
		ProgressTypeOperation,
		ProgressTypeStatus,
		ProgressTypeError,
	}

	for _, ptype := range validTypes {
		t.Run(string(ptype), func(t *testing.T) {
			progress := Progress{
				Type:           ptype,
				BytesProcessed: 50,
				TotalBytes:     100,
				Percentage:     50.0,
			}

			err := progress.Validate()
			if err != nil {
				t.Errorf("Validate() failed for valid type %q: %v", ptype, err)
			}
		})
	}
}

// TestProgress_Validate_EdgeCases tests edge cases and boundary conditions
func TestProgress_Validate_EdgeCases(t *testing.T) {
	tests := []struct {
		name     string
		progress Progress
		wantErr  bool
	}{
		{
			name: "percentage exactly 0",
			progress: Progress{
				Type:       ProgressTypeOperation,
				Percentage: 0.0,
			},
			wantErr: false,
		},
		{
			name: "percentage exactly 100",
			progress: Progress{
				Type:       ProgressTypeOperation,
				Percentage: 100.0,
			},
			wantErr: false,
		},
		{
			name: "percentage just over 100",
			progress: Progress{
				Type:       ProgressTypeOperation,
				Percentage: 100.1,
			},
			wantErr: true,
		},
		{
			name: "percentage just under 0",
			progress: Progress{
				Type:       ProgressTypeOperation,
				Percentage: -0.1,
			},
			wantErr: true,
		},
		{
			name: "very large valid bytes",
			progress: Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 1000000000000, // 1TB
				TotalBytes:     2000000000000, // 2TB
				Percentage:     50.0,
			},
			wantErr: false,
		},
		{
			name: "bytes equal at boundary",
			progress: Progress{
				Type:           ProgressTypeOperation,
				BytesProcessed: 9223372036854775807, // max int64
				TotalBytes:     9223372036854775807,
				Percentage:     100.0,
			},
			wantErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.progress.Validate()

			if tt.wantErr && err == nil {
				t.Errorf("Validate() should have failed but didn't")
			}

			if !tt.wantErr && err != nil {
				t.Errorf("Validate() failed unexpectedly: %v", err)
			}
		})
	}
}
