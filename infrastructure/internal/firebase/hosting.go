package firebase

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strings"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// FirebaseSite represents a Firebase Hosting site
type FirebaseSite struct {
	Name       string `json:"name"`
	DefaultURL string `json:"defaultUrl"`
}

// FirebaseSitesResponse represents the response from listing sites
type FirebaseSitesResponse struct {
	Sites []FirebaseSite `json:"sites"`
}

// ErrorResponse represents a Firebase API error response
type ErrorResponse struct {
	Error ErrorDetail `json:"error"`
}

// ErrorDetail contains error details
type ErrorDetail struct {
	Message string `json:"message"`
}

// CreateHostingSites creates Firebase Hosting sites for all sites in firebase.json
func CreateHostingSites(projectID string) (map[string]string, error) {
	output.Info("Creating Firebase Hosting sites...")

	// Read sites from firebase.json
	sites, err := readFirebaseConfig()
	if err != nil {
		output.Warning(fmt.Sprintf("Could not read firebase.json: %v", err))
		output.Info("Using default site list")
		sites = []string{"fellspiral", "videobrowser-7696a", "audiobrowser", "print-dfb47"}
	} else {
		output.Info(fmt.Sprintf("Found %d sites in firebase.json: %s", len(sites), strings.Join(sites, ", ")))
	}

	siteMappings := make(map[string]string)

	for _, siteID := range sites {
		actualSiteID := siteID

		// Check if site already exists
		result, _ := exec.Run(fmt.Sprintf(
			`curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" "https://firebasehosting.googleapis.com/v1beta1/projects/%s/sites/%s" -w "\n%%{http_code}"`,
			projectID, projectID, siteID), true)

		if result != nil && result.Stdout != "" {
			lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
			if len(lines) > 0 {
				httpCode := lines[len(lines)-1]
				if httpCode == "200" {
					output.Info(fmt.Sprintf("  Site '%s' already exists", siteID))
					siteMappings[siteID] = siteID
					continue
				}
			}
		}

		// Create the site
		output.Info(fmt.Sprintf("  Creating site '%s'...", actualSiteID))
		result, _ = exec.Run(fmt.Sprintf(
			`curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" -H "Content-Type: application/json" "https://firebasehosting.googleapis.com/v1beta1/projects/%s/sites?siteId=%s" -w "\n%%{http_code}"`,
			projectID, projectID, actualSiteID), true)

		if result != nil && result.Stdout != "" {
			lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
			if len(lines) > 0 {
				httpCode := lines[len(lines)-1]
				responseBody := strings.Join(lines[:len(lines)-1], "\n")

				if httpCode == "200" || httpCode == "201" {
					output.Success(fmt.Sprintf("  Created site '%s'", actualSiteID))
					siteMappings[siteID] = actualSiteID

					var site FirebaseSite
					if err := json.Unmarshal([]byte(responseBody), &site); err == nil && site.DefaultURL != "" {
						output.Success(fmt.Sprintf("    URL: %s", site.DefaultURL))
					}
					continue
				}

				// Handle errors
				var errResp ErrorResponse
				if err := json.Unmarshal([]byte(responseBody), &errResp); err == nil {
					errorMsg := errResp.Error.Message

					if strings.Contains(errorMsg, "already exists") || strings.Contains(errorMsg, "ALREADY_EXISTS") {
						output.Info(fmt.Sprintf("  Site '%s' already exists", actualSiteID))
						siteMappings[siteID] = actualSiteID
						continue
					}

					if strings.Contains(strings.ToLower(errorMsg), "reserved by another project") {
						// Try to find a related site that exists in our project
						alternativeSite := findAlternativeSite(projectID, siteID)
						if alternativeSite != "" {
							output.Success(fmt.Sprintf("  Found existing related site '%s' - using it instead", alternativeSite))
							siteMappings[siteID] = alternativeSite
							continue
						}

						// Extract suggested alternative name from error
						re := regexp.MustCompile(`try something like \x60([^\x60]+)\x60`)
						matches := re.FindStringSubmatch(errorMsg)
						if len(matches) > 1 {
							suggestedName := matches[1]
							output.Info(fmt.Sprintf("  Site '%s' is reserved by another project, trying '%s'...", actualSiteID, suggestedName))

							// Try to create suggested name
							retryResult, _ := exec.Run(fmt.Sprintf(
								`curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" -H "Content-Type: application/json" "https://firebasehosting.googleapis.com/v1beta1/projects/%s/sites?siteId=%s" -w "\n%%{http_code}"`,
								projectID, projectID, suggestedName), true)

							if retryResult != nil && retryResult.Stdout != "" {
								retryLines := strings.Split(strings.TrimSpace(retryResult.Stdout), "\n")
								if len(retryLines) > 0 {
									retryCode := retryLines[len(retryLines)-1]
									if retryCode == "200" || retryCode == "201" {
										output.Success(fmt.Sprintf("  Created site '%s' (alternative for '%s')", suggestedName, siteID))
										siteMappings[siteID] = suggestedName
										continue
									}
								}
							}
						}
					}

					output.Warning(fmt.Sprintf("  Could not create site '%s': %s", actualSiteID, errorMsg))
				}
			}
		}
	}

	output.Success("Firebase Hosting sites configured")
	return siteMappings, nil
}

// findAlternativeSite looks for an existing related site in the project
func findAlternativeSite(projectID, desiredSite string) string {
	result, _ := exec.Run(fmt.Sprintf(
		`curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" "https://firebasehosting.googleapis.com/v1beta1/projects/%s/sites"`,
		projectID, projectID), true)

	if result == nil || result.Stdout == "" {
		return ""
	}

	var sitesResp FirebaseSitesResponse
	if err := json.Unmarshal([]byte(result.Stdout), &sitesResp); err != nil {
		return ""
	}

	// Look for sites that start with our desired name
	for _, site := range sitesResp.Sites {
		siteName := site.Name
		if strings.Contains(siteName, "/") {
			parts := strings.Split(siteName, "/")
			siteName = parts[len(parts)-1]
		}

		if strings.HasPrefix(siteName, desiredSite+"-") {
			return siteName
		}
	}

	return ""
}
