package config

import (
	"os"
	"strconv"
)

type Config struct {
	Port         string
	GCPProjectID string
	Environment  string
	// Filesync configuration
	SyncRootDir    string
	GCSBucketName  string
	ConcurrentJobs int
}

func Load() Config {
	return Config{
		Port:           getEnv("PORT", "8080"),
		GCPProjectID:   getEnv("GCP_PROJECT_ID", "chalanding"),
		Environment:    getEnv("GO_ENV", "production"),
		SyncRootDir:    getEnv("SYNC_ROOT_DIR", "~/Downloads"),
		GCSBucketName:  getEnv("GCS_BUCKET_NAME", "rml-media"),
		ConcurrentJobs: getEnvInt("CONCURRENT_JOBS", 8),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func getEnvInt(key string, defaultValue int) int {
	if value := os.Getenv(key); value != "" {
		if intValue, err := strconv.Atoi(value); err == nil {
			return intValue
		}
	}
	return defaultValue
}
