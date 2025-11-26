package config

import "os"

type Config struct {
	Port         string
	GCPProjectID string
	Environment  string
}

func Load() Config {
	return Config{
		Port:         getEnv("PORT", "8080"),
		GCPProjectID: getEnv("GCP_PROJECT_ID", "chalanding"),
		Environment:  getEnv("GO_ENV", "production"),
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
