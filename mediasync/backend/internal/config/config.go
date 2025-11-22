package config

import (
	"os"
	"strings"
)

// Config holds mediasync configuration
type Config struct {
	GCPProjectID string
	GCSBucket    string
	Port         string

	// Strategy enablement flags
	EnableAudio   bool
	EnableVideo   bool
	EnablePrint   bool
	EnableFinance bool
}

// LoadFromEnv loads configuration from environment variables
func LoadFromEnv() *Config {
	return &Config{
		GCPProjectID: getEnv("GCP_PROJECT_ID", ""),
		GCSBucket:    getEnv("GCS_BUCKET", ""),
		Port:         getEnv("PORT", "8080"),

		// Strategies (default: all enabled)
		EnableAudio:   getEnvBool("ENABLE_AUDIO", true),
		EnableVideo:   getEnvBool("ENABLE_VIDEO", true),
		EnablePrint:   getEnvBool("ENABLE_PRINT", true),
		EnableFinance: getEnvBool("ENABLE_FINANCE", true),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvBool(key string, defaultValue bool) bool {
	value := os.Getenv(key)
	if value == "" {
		return defaultValue
	}
	// Parse common boolean strings
	value = strings.ToLower(strings.TrimSpace(value))
	return value == "true" || value == "1" || value == "yes" || value == "on"
}
