package firebase

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/rumor-ml/commons.systems/infrastructure/internal/exec"
	"github.com/rumor-ml/commons.systems/infrastructure/internal/output"
)

// FirebaseProject represents a Firebase project response
type FirebaseProject struct {
	ProjectID string `json:"projectId"`
}

// InitializeProject initializes Firebase on the GCP project
func InitializeProject(projectID string) error {
	output.Info("Checking if Firebase is already initialized...")

	// Check if Firebase is already initialized
	result, err := exec.Run(fmt.Sprintf(
		`curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" "https://firebase.googleapis.com/v1beta1/projects/%s" -w "\n%%{http_code}"`,
		projectID, projectID), true)

	if err == nil && result.Stdout != "" {
		lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
		if len(lines) > 0 {
			httpCode := lines[len(lines)-1]
			if httpCode == "200" {
				output.Info("Firebase is already initialized on this project")
				return nil
			}
		}
	}

	// Initialize Firebase via API
	output.Info("Firebase not initialized. Adding Firebase to project...")
	result, err = exec.Run(fmt.Sprintf(
		`curl -s -X POST -H "Authorization: Bearer $(gcloud auth print-access-token)" -H "x-goog-user-project: %s" -H "Content-Type: application/json" "https://firebase.googleapis.com/v1beta1/projects/%s:addFirebase" -w "\n%%{http_code}"`,
		projectID, projectID), true)

	if err == nil && result.Stdout != "" {
		lines := strings.Split(strings.TrimSpace(result.Stdout), "\n")
		if len(lines) > 0 {
			httpCode := lines[len(lines)-1]
			responseBody := strings.Join(lines[:len(lines)-1], "\n")

			if httpCode == "200" || httpCode == "201" {
				output.Success("Successfully added Firebase to project")

				var project FirebaseProject
				if err := json.Unmarshal([]byte(responseBody), &project); err == nil && project.ProjectID != "" {
					output.Success(fmt.Sprintf("Firebase project ID: %s", project.ProjectID))
				}
				return nil
			}

			// Check if error indicates Firebase already exists
			if strings.Contains(responseBody, "already exists") || strings.Contains(responseBody, "ALREADY_EXISTS") {
				output.Info("Firebase is already initialized on this project")
				return nil
			}

			output.Warning("Could not initialize Firebase via API")
			output.Warning("You may need to initialize Firebase manually:")
			output.Info("1. Go to: https://console.firebase.google.com/")
			output.Info(fmt.Sprintf("2. Create a project and select existing GCP project: %s", projectID))
		}
	}

	return nil
}
