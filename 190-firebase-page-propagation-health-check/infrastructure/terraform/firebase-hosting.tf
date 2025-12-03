# Firebase Hosting Sites Configuration
# Note: Firebase Hosting sites are created via iac.py using Firebase Management API
# The google/google Terraform provider doesn't support google_firebase_hosting_site resource

# Enable Firebase Hosting API
resource "google_project_service" "firebasehosting" {
  service            = "firebasehosting.googleapis.com"
  disable_on_destroy = false
}

# Note: Sites defined in var.sites are created programmatically by iac.py
# See iac.py::create_firebase_hosting_sites() for implementation
#
# Sites are created using Firebase Management API:
# POST https://firebasehosting.googleapis.com/v1beta1/projects/{project}/sites
#
# The sites are configured in firebase.json and .firebaserc
