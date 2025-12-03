package firebase

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// FirebaseConfig represents the firebase.json structure
type FirebaseConfig struct {
	Hosting []HostingConfig `json:"hosting"`
}

// HostingConfig represents a hosting site configuration
type HostingConfig struct {
	Site   string                 `json:"site"`
	Public string                 `json:"public"`
	Other  map[string]interface{} `json:"-"`
}

// readFirebaseConfig reads the firebase.json file and returns the list of sites
func readFirebaseConfig() ([]string, error) {
	// Get the repository root (2 levels up from infrastructure/internal/firebase)
	currentDir, err := os.Getwd()
	if err != nil {
		return nil, err
	}

	// Try to find firebase.json in the repository root
	firebaseJSONPath := filepath.Join(currentDir, "..", "..", "..", "firebase.json")

	// If that doesn't exist, try current directory
	if _, err := os.Stat(firebaseJSONPath); os.IsNotExist(err) {
		firebaseJSONPath = "firebase.json"
	}

	data, err := os.ReadFile(firebaseJSONPath)
	if err != nil {
		return nil, err
	}

	var config FirebaseConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, err
	}

	sites := make([]string, 0, len(config.Hosting))
	for _, hosting := range config.Hosting {
		if hosting.Site != "" {
			sites = append(sites, hosting.Site)
		}
	}

	return sites, nil
}

// UpdateConfig updates firebase.json with actual site names
func UpdateConfig(siteMappings map[string]string) error {
	// Check if any sites have alternative names
	needsUpdate := false
	for orig, actual := range siteMappings {
		if orig != actual {
			needsUpdate = true
			break
		}
	}

	if !needsUpdate {
		return nil
	}

	output.Info("Updating Firebase configuration files with actual site names...")

	// Find firebase.json
	currentDir, err := os.Getwd()
	if err != nil {
		return err
	}

	firebaseJSONPath := filepath.Join(currentDir, "..", "..", "..", "firebase.json")
	if _, err := os.Stat(firebaseJSONPath); os.IsNotExist(err) {
		firebaseJSONPath = "firebase.json"
	}

	// Read the file
	data, err := os.ReadFile(firebaseJSONPath)
	if err != nil {
		return fmt.Errorf("failed to read firebase.json: %w", err)
	}

	// Parse as generic JSON to preserve structure
	var config map[string]interface{}
	if err := json.Unmarshal(data, &config); err != nil {
		return fmt.Errorf("failed to parse firebase.json: %w", err)
	}

	// Update site names in hosting array
	if hosting, ok := config["hosting"].([]interface{}); ok {
		for _, h := range hosting {
			if hostingMap, ok := h.(map[string]interface{}); ok {
				if site, ok := hostingMap["site"].(string); ok {
					if actualSite, exists := siteMappings[site]; exists && site != actualSite {
						hostingMap["site"] = actualSite
						output.Info(fmt.Sprintf("  Updated firebase.json: %s -> %s", site, actualSite))
					}
				}
			}
		}
	}

	// Write back
	updatedData, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal firebase.json: %w", err)
	}

	if err := os.WriteFile(firebaseJSONPath, append(updatedData, '\n'), 0644); err != nil {
		return fmt.Errorf("failed to write firebase.json: %w", err)
	}

	output.Success("Firebase configuration files updated")
	return nil
}
