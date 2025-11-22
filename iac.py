#!/usr/bin/env python3
"""
Infrastructure Setup and IaC Management
========================================

Handles both prerequisites and infrastructure as code (Terraform).
Can run interactively for one-time setup or non-interactively in CI/CD.

Modes:
  - Interactive (default): Prompts for configuration, handles pre-terraform setup
  - CI/CD (--ci): Non-interactive mode for continuous deployment
  - IaC only (--iac): Run only terraform operations (requires pre-setup)

This script is fully idempotent - you can run it multiple times safely.

Usage:
    # Interactive pre-terraform setup
    python3 setup.py

    # CI/CD mode (runs terraform automatically)
    python3 setup.py --ci

    # Run only terraform
    python3 setup.py --iac
"""

import subprocess
import sys
import json
import os
from pathlib import Path
from getpass import getpass

# Colors for terminal output
class Colors:
    GREEN = '\033[0;32m'
    YELLOW = '\033[1;33m'
    BLUE = '\033[0;34m'
    RED = '\033[0;31m'
    NC = '\033[0m'  # No Color

def print_header(text):
    print(f"\n{Colors.GREEN}{'='*60}{Colors.NC}")
    print(f"{Colors.GREEN}{text:^60}{Colors.NC}")
    print(f"{Colors.GREEN}{'='*60}{Colors.NC}\n")

def print_step(step_num, total_steps, text):
    print(f"{Colors.YELLOW}[{step_num}/{total_steps}] {text}{Colors.NC}")

def print_success(text):
    print(f"  {Colors.GREEN}→ {text}{Colors.NC}")

def print_info(text):
    print(f"  → {text}")

def print_error(text):
    print(f"{Colors.RED}Error: {text}{Colors.NC}")
    sys.exit(1)

def run_command(cmd, check=True, capture_output=True):
    """Run a shell command and return the result."""
    try:
        result = subprocess.run(
            cmd,
            shell=True,
            check=check,
            capture_output=capture_output,
            text=True
        )
        return result.stdout.strip() if capture_output else None
    except subprocess.CalledProcessError as e:
        if check:
            print_error(f"Command failed: {cmd}\n{e.stderr}")
        return None

def check_prerequisites():
    """Check if required tools are installed."""
    print_header("Checking Prerequisites")

    # Check for gcloud
    if not run_command("command -v gcloud", check=False):
        print_error("gcloud CLI is not installed\nInstall from: https://cloud.google.com/sdk/docs/install")
    print_success("gcloud CLI found")

    # Check for Python 3
    if sys.version_info < (3, 6):
        print_error("Python 3.6 or higher is required")
    print_success(f"Python {sys.version_info.major}.{sys.version_info.minor} found")

def authenticate_gcp():
    """Authenticate to GCP if needed."""
    print_header("GCP Authentication")

    active_account = run_command(
        'gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -n1',
        check=False
    )

    if not active_account:
        print_info("Not authenticated. Opening browser for authentication...")
        run_command("gcloud auth login", capture_output=False)
        active_account = run_command(
            'gcloud auth list --filter=status:ACTIVE --format="value(account)" | head -n1'
        )

    print_success(f"Authenticated as: {active_account}")

def gather_user_inputs():
    """Gather all user inputs upfront before running automation steps."""
    print_header("Configuration")

    # Get project ID from gcloud config or prompt
    default_project = run_command('gcloud config get-value project 2>/dev/null', check=False)
    if default_project and default_project.strip():
        default_project = default_project.strip()
        print(f"{Colors.BLUE}Using GCP Project from gcloud config:{Colors.NC} {default_project}")
        use_default = input(f"{Colors.YELLOW}Use this project? (Y/n): {Colors.NC}").strip().lower()

        if use_default in ['', 'y', 'yes']:
            project_id = default_project
        else:
            project_id = input(f"{Colors.BLUE}Enter your GCP Project ID: {Colors.NC}").strip()
            if not project_id:
                print_error("Project ID cannot be empty")
    else:
        project_id = input(f"{Colors.BLUE}Enter your GCP Project ID: {Colors.NC}").strip()
        if not project_id:
            print_error("Project ID cannot be empty")

    repo_owner = os.environ.get('GITHUB_REPO_OWNER', 'rumor-ml')
    repo_name = os.environ.get('GITHUB_REPO_NAME', 'commons.systems')

    print(f"\n{Colors.BLUE}GitHub Repository:{Colors.NC} {repo_owner}/{repo_name}")
    print(f"{Colors.YELLOW}(Set GITHUB_REPO_OWNER and GITHUB_REPO_NAME env vars to change){Colors.NC}")

    config = {
        'project_id': project_id,
        'repo_owner': repo_owner,
        'repo_name': repo_name,
        'region': 'us-central1'
    }

    # Check if GitHub token secret exists
    print(f"\n{Colors.BLUE}Checking for existing GitHub API token secret...{Colors.NC}")
    secret_exists = run_command(
        f'gcloud secrets describe GITHUB_API_TOKEN --project={project_id} 2>/dev/null',
        check=False
    )

    if secret_exists:
        print_info("GitHub API token secret already exists")
        update_token = input(f"{Colors.YELLOW}Update with a new token? (y/N): {Colors.NC}").strip().lower()
        config['update_github_token'] = (update_token == 'y')

        if config['update_github_token']:
            print(f"\n{Colors.BLUE}Enter your GitHub Personal Access Token:{Colors.NC}")
            print("(Token will not be visible as you type)")
            config['github_token'] = getpass("")
        else:
            config['github_token'] = None
    else:
        print_info("GitHub API token secret not found")
        create_token = input(f"{Colors.YELLOW}Create GitHub API token secret now? (Y/n): {Colors.NC}").strip().lower()

        if create_token in ['', 'y', 'yes']:
            print("\nTo create a GitHub token:")
            print("  1. Go to GitHub Settings → Developer settings → Personal access tokens")
            print("  2. Click 'Generate new token (classic)'")
            print("  3. Give it a name like 'CI Logs Proxy'")
            print("  4. Select scopes: 'repo' (for private repos) or 'public_repo' (for public)")
            print("  5. Click 'Generate token' and copy it")
            print(f"\n{Colors.BLUE}Enter your GitHub Personal Access Token:{Colors.NC}")
            print("(Token will not be visible as you type)")
            config['github_token'] = getpass("")
            config['update_github_token'] = True
        else:
            config['github_token'] = None
            config['update_github_token'] = False
            print_info("Skipping GitHub token creation")

    # Check if gh CLI is available and ask about auto-creating secrets
    gh_available = run_command("command -v gh", check=False)
    config['auto_create_secrets'] = False

    if gh_available:
        gh_auth_status = run_command("gh auth status 2>&1", check=False)

        if gh_auth_status and "Logged in" in gh_auth_status:
            gh_user = run_command("gh api user -q .login 2>/dev/null", check=False) or "unknown"
            print(f"\n{Colors.BLUE}GitHub CLI authenticated as:{Colors.NC} {gh_user}")

            print(f"\n{Colors.YELLOW}Auto-create GitHub secrets after setup?{Colors.NC}")
            print(f"This will add secrets to {repo_owner}/{repo_name}:")
            print("  - GCP_PROJECT_ID")
            print("  - GCP_WORKLOAD_IDENTITY_PROVIDER")
            print("  - GCP_SERVICE_ACCOUNT")

            auto_secrets = input(f"{Colors.BLUE}Auto-create secrets? (Y/n): {Colors.NC}").strip().lower()
            config['auto_create_secrets'] = auto_secrets in ['', 'y', 'yes']

    print(f"\n{Colors.GREEN}Configuration gathered. Starting automated setup...{Colors.NC}\n")
    return config

def get_project_info():
    """Get project ID and GitHub repo info (deprecated - now done in gather_user_inputs)."""
    # This function is kept for compatibility but shouldn't be called
    # in the new flow
    pass

def enable_apis(config):
    """Enable all required GCP APIs (idempotent - safe to run multiple times)."""
    print_step(1, 5, "Enabling required GCP APIs...")

    # Set project
    run_command(f"gcloud config set project {config['project_id']}", capture_output=False)

    # First, try to enable the Service Usage API (required to enable other APIs)
    print_info("Checking Service Usage API...")
    service_usage_check = run_command(
        f"gcloud services enable serviceusage.googleapis.com --project={config['project_id']} 2>&1",
        check=False
    )

    if service_usage_check and "SERVICE_DISABLED" in service_usage_check:
        print(f"\n{Colors.RED}{'='*70}{Colors.NC}")
        print(f"{Colors.RED}ERROR: Service Usage API is not enabled{Colors.NC}")
        print(f"{Colors.RED}{'='*70}{Colors.NC}\n")
        print(f"{Colors.YELLOW}The Service Usage API must be enabled before other APIs can be enabled.{Colors.NC}")
        print(f"{Colors.YELLOW}This is a one-time manual step.{Colors.NC}\n")
        print(f"{Colors.BLUE}Please enable it by clicking this link:{Colors.NC}")
        print(f"https://console.developers.google.com/apis/api/serviceusage.googleapis.com/overview?project={config['project_id']}\n")
        print(f"{Colors.YELLOW}Steps:{Colors.NC}")
        print("1. Click the link above")
        print("2. Click the 'Enable' button")
        print("3. Wait 1-2 minutes for it to propagate")
        print("4. Run this setup script again\n")
        sys.exit(1)

    apis = [
        'compute.googleapis.com',
        'storage.googleapis.com',
        'cloudresourcemanager.googleapis.com',
        'run.googleapis.com',
        'artifactregistry.googleapis.com',
        'secretmanager.googleapis.com',
        'iam.googleapis.com',
        'iamcredentials.googleapis.com',
        'sts.googleapis.com',
        'firebase.googleapis.com',
        'firebaserules.googleapis.com',
        'firebasestorage.googleapis.com',
        'firebasehosting.googleapis.com',     # Firebase Hosting
        'identitytoolkit.googleapis.com'      # Identity Platform (Firebase Auth)
    ]

    # Note: gcloud services enable is idempotent - already enabled APIs are skipped
    print_info("Enabling project APIs...")
    result = run_command(f"gcloud services enable {' '.join(apis)} --quiet 2>&1", check=False)

    if result and "SERVICE_DISABLED" in result and "serviceusage.googleapis.com" in result:
        print(f"\n{Colors.YELLOW}Service Usage API was just enabled. Retrying...{Colors.NC}")
        import time
        time.sleep(5)
        run_command(f"gcloud services enable {' '.join(apis)} --quiet")

    print_success("APIs enabled (already-enabled APIs skipped)")

def setup_workload_identity(config):
    """Set up Workload Identity Federation for keyless auth."""
    print_step(2, 5, "Setting up Workload Identity Federation...")

    # Get project number
    project_number = run_command(
        f'gcloud projects describe {config["project_id"]} --format="value(projectNumber)"'
    )

    pool_name = "github-actions"
    provider_name = "github"

    # Create Workload Identity Pool
    pool_exists = run_command(
        f'gcloud iam workload-identity-pools describe {pool_name} --location=global --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if not pool_exists:
        run_command(
            f'gcloud iam workload-identity-pools create {pool_name} '
            f'--location=global --project={config["project_id"]} --display-name="GitHub Actions Pool" --quiet'
        )
        print_success("Workload Identity Pool created")
    else:
        print_info("Pool already exists")

    # Create Workload Identity Provider
    provider_exists = run_command(
        f'gcloud iam workload-identity-pools providers describe {provider_name} '
        f'--workload-identity-pool={pool_name} --location=global --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if not provider_exists:
        run_command(
            f'gcloud iam workload-identity-pools providers create-oidc {provider_name} '
            f'--workload-identity-pool={pool_name} --location=global --project={config["project_id"]} '
            f'--issuer-uri="https://token.actions.githubusercontent.com" '
            f'--attribute-mapping="google.subject=assertion.sub,'
            f'attribute.actor=assertion.actor,attribute.repository=assertion.repository" '
            f'--attribute-condition="assertion.repository==\'{config["repo_owner"]}/{config["repo_name"]}\'" '
            f'--quiet'
        )
        print_success("Workload Identity Provider created")
    else:
        print_info("Provider already exists")
        # Update the attribute condition to match the current repository
        print_info("Updating provider attribute condition...")
        run_command(
            f'gcloud iam workload-identity-pools providers update-oidc {provider_name} '
            f'--workload-identity-pool={pool_name} --location=global --project={config["project_id"]} '
            f'--attribute-condition="assertion.repository==\'{config["repo_owner"]}/{config["repo_name"]}\'" '
            f'--quiet',
            check=False
        )
        print_success("Provider updated with correct repository condition")

    # Store workload identity provider path
    config['workload_identity_provider'] = (
        f'projects/{project_number}/locations/global/workloadIdentityPools/'
        f'{pool_name}/providers/{provider_name}'
    )

def create_service_account(config):
    """Create service account and bind to Workload Identity."""
    print_step(3, 5, "Creating GitHub Actions service account...")

    sa_name = "github-actions-terraform"
    sa_email = f"{sa_name}@{config['project_id']}.iam.gserviceaccount.com"

    # Create service account
    sa_exists = run_command(
        f'gcloud iam service-accounts describe {sa_email} 2>/dev/null',
        check=False
    )

    if not sa_exists:
        run_command(
            f'gcloud iam service-accounts create {sa_name} '
            f'--display-name="GitHub Actions Terraform" --quiet'
        )
        print_success("Service account created")
    else:
        print_info("Service account already exists")

    # Bind Workload Identity (allow GitHub Actions to impersonate this service account)
    print_info("Configuring Workload Identity binding...")

    # The correct member principal
    member = f"principalSet://iam.googleapis.com/{config['workload_identity_provider']}/attribute.repository/{config['repo_owner']}/{config['repo_name']}"

    # Get existing IAM policy
    existing_bindings = run_command(
        f'gcloud iam service-accounts get-iam-policy {sa_email} --format=json 2>/dev/null',
        check=False
    )

    # Check if the correct binding exists
    binding_exists = False
    if existing_bindings:
        try:
            policy = json.loads(existing_bindings)
            for binding in policy.get('bindings', []):
                if binding.get('role') == 'roles/iam.workloadIdentityUser':
                    for existing_member in binding.get('members', []):
                        if existing_member == member:
                            binding_exists = True
                            print_info("Correct workload identity binding already exists")
                            break
                    # Note: We don't remove other bindings - they may be intentional
                    # Multiple workload identity bindings are valid (e.g., for different repos)
        except json.JSONDecodeError:
            pass

    # Add the correct binding if it doesn't exist
    if not binding_exists:
        run_command(
            f'gcloud iam service-accounts add-iam-policy-binding {sa_email} '
            f'--member="{member}" '
            f'--role="roles/iam.workloadIdentityUser" --quiet 2>/dev/null',
            check=False
        )
        print_success("Workload Identity binding created")

    print_info("(IAM permissions will be managed by Terraform)")
    config['service_account_email'] = sa_email

def setup_ci_logs_proxy(config):
    """Set up CI logs proxy prerequisites (Artifact Registry repo and secret)."""
    print_step(4, 5, "Setting up CI Logs Proxy prerequisites...")

    # Create Artifact Registry repository for Docker images
    print_info("Creating Artifact Registry repository...")
    repo_name = "cloud-run-images"
    region = "us-central1"

    repo_exists = run_command(
        f'gcloud artifacts repositories describe {repo_name} '
        f'--location={region} --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if not repo_exists:
        run_command(
            f'gcloud artifacts repositories create {repo_name} '
            f'--repository-format=docker '
            f'--location={region} '
            f'--description="Docker images for Cloud Run services" '
            f'--project={config["project_id"]}'
        )
        print_success(f"Artifact Registry repository '{repo_name}' created")
    else:
        print_info(f"Artifact Registry repository '{repo_name}' already exists")

    # Create Artifact Registry repositories for Fellspiral site deployments
    print_info("Creating Artifact Registry repositories for Fellspiral site...")

    # Production repository
    prod_repo = "fellspiral-production"
    prod_exists = run_command(
        f'gcloud artifacts repositories describe {prod_repo} '
        f'--location={region} --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if not prod_exists:
        run_command(
            f'gcloud artifacts repositories create {prod_repo} '
            f'--repository-format=docker '
            f'--location={region} '
            f'--description="Production Docker images for Fellspiral site" '
            f'--project={config["project_id"]}'
        )
        print_success(f"Artifact Registry repository '{prod_repo}' created")
    else:
        print_info(f"Artifact Registry repository '{prod_repo}' already exists")

    # Preview/feature branch repository
    preview_repo = "fellspiral-previews"
    preview_exists = run_command(
        f'gcloud artifacts repositories describe {preview_repo} '
        f'--location={region} --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if not preview_exists:
        run_command(
            f'gcloud artifacts repositories create {preview_repo} '
            f'--repository-format=docker '
            f'--location={region} '
            f'--description="Feature branch preview Docker images for Fellspiral site" '
            f'--project={config["project_id"]}'
        )
        print_success(f"Artifact Registry repository '{preview_repo}' created")
    else:
        print_info(f"Artifact Registry repository '{preview_repo}' already exists")

    # Create or update GitHub API token secret
    print_info("Setting up GitHub API token secret...")
    secret_name = "GITHUB_API_TOKEN"

    # Check if secret exists
    secret_exists = run_command(
        f'gcloud secrets describe {secret_name} --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    # Use pre-gathered token from config
    if config.get('update_github_token') and config.get('github_token'):
        if secret_exists:
            # Update existing secret
            proc = subprocess.Popen(
                f'gcloud secrets versions add {secret_name} --data-file=- --project={config["project_id"]}',
                shell=True,
                stdin=subprocess.PIPE
            )
            proc.communicate(input=config['github_token'].encode())
            print_success("GitHub API token secret updated")
        else:
            # Create new secret
            run_command(
                f'gcloud secrets create {secret_name} --replication-policy="automatic" '
                f'--project={config["project_id"]}'
            )
            proc = subprocess.Popen(
                f'gcloud secrets versions add {secret_name} --data-file=- --project={config["project_id"]}',
                shell=True,
                stdin=subprocess.PIPE
            )
            proc.communicate(input=config['github_token'].encode())
            print_success(f"GitHub API token secret created: {secret_name}")
    elif secret_exists:
        print_info(f"GitHub API token secret already exists (not updating)")
    else:
        print_info("Skipping GitHub API token secret creation")
        print(f"{Colors.YELLOW}You can create it later with:{Colors.NC}")
        print(f'  gcloud secrets create {secret_name} --replication-policy="automatic"')
        print(f'  echo -n "token" | gcloud secrets versions add {secret_name} --data-file=-')

    # Grant project-level Secret Manager admin role (so Terraform can manage secrets and IAM)
    # Terraform needs full admin access to both read secrets and set IAM policies
    if run_command(f'gcloud secrets describe {secret_name} --project={config["project_id"]} 2>/dev/null', check=False):
        print_info("Granting Terraform service account Secret Manager admin access...")

        # Grant to github-actions-terraform service account (used by Terraform runner)
        terraform_sa_email = f"github-actions-terraform@{config['project_id']}.iam.gserviceaccount.com"

        # Check if this service account exists
        sa_exists = run_command(
            f'gcloud iam service-accounts describe {terraform_sa_email} --project={config["project_id"]} 2>/dev/null',
            check=False
        )

        if sa_exists:
            # Check if already has admin permission
            project_policy = run_command(
                f'gcloud projects get-iam-policy {config["project_id"]} --format=json 2>/dev/null',
                check=False
            )

            has_admin_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/secretmanager.admin':
                            if member in binding.get('members', []):
                                has_admin_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_admin_permission:
                # Grant project-level secretmanager.admin role
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/secretmanager.admin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )

                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Secret Manager admin role")
                elif result and "PERMISSION_DENIED" in result:
                    print(f"\n{Colors.RED}ERROR: Failed to grant permission.{Colors.NC}")
                    print(f"{Colors.YELLOW}You may not have permission to modify project IAM policies.{Colors.NC}")
                    print(f"{Colors.YELLOW}Ask a project owner to run this command:{Colors.NC}")
                    print(f'gcloud projects add-iam-policy-binding {config["project_id"]} \\')
                    print(f'  --member="serviceAccount:{terraform_sa_email}" \\')
                    print(f'  --role="roles/secretmanager.admin"')
                    print("")
                else:
                    print_success("github-actions-terraform should now have Secret Manager admin access")
            else:
                print_info("github-actions-terraform already has Secret Manager admin permissions")

            # Grant additional permissions for Playwright server infrastructure
            print_info("Granting Terraform service account permissions for Playwright server...")

            # Check and grant Artifact Registry admin
            has_ar_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/artifactregistry.admin':
                            if member in binding.get('members', []):
                                has_ar_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_ar_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/artifactregistry.admin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Artifact Registry admin role")
            else:
                print_info("github-actions-terraform already has Artifact Registry admin permissions")

            # Check and grant Cloud Run admin
            has_run_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/run.admin':
                            if member in binding.get('members', []):
                                has_run_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_run_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/run.admin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Cloud Run admin role")
            else:
                print_info("github-actions-terraform already has Cloud Run admin permissions")

            # Check and grant Service Account User role
            has_sa_user_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/iam.serviceAccountUser':
                            if member in binding.get('members', []):
                                has_sa_user_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_sa_user_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/iam.serviceAccountUser" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Service Account User role")
            else:
                print_info("github-actions-terraform already has Service Account User permissions")

            # Grant Storage Admin (for buckets and state management)
            print_info("Granting Storage Admin permissions...")
            has_storage_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/storage.admin':
                            if member in binding.get('members', []):
                                has_storage_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_storage_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/storage.admin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Storage Admin role")
            else:
                print_info("github-actions-terraform already has Storage Admin permissions")

            # Grant Compute Load Balancer Admin (for CDN and load balancing)
            print_info("Granting Compute Load Balancer Admin permissions...")
            has_compute_lb_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/compute.loadBalancerAdmin':
                            if member in binding.get('members', []):
                                has_compute_lb_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_compute_lb_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/compute.loadBalancerAdmin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Compute Load Balancer Admin role")
            else:
                print_info("github-actions-terraform already has Compute Load Balancer Admin permissions")

            # Grant Compute Network Admin (for IP addresses)
            print_info("Granting Compute Network Admin permissions...")
            has_compute_net_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/compute.networkAdmin':
                            if member in binding.get('members', []):
                                has_compute_net_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_compute_net_permission:
                result = run_command(
                    f'gcloud projects add-iam-policy-binding {config["project_id"]} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/compute.networkAdmin" '
                    f'--condition=None --quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Compute Network Admin role")
            else:
                print_info("github-actions-terraform already has Compute Network Admin permissions")

            # Grant Service Account Token Creator (required for Workload Identity impersonation)
            print_info("Granting Service Account Token Creator permissions...")
            has_token_creator_permission = False
            if project_policy:
                try:
                    policy = json.loads(project_policy)
                    member = f"serviceAccount:{terraform_sa_email}"
                    for binding in policy.get('bindings', []):
                        if binding.get('role') == 'roles/iam.serviceAccountTokenCreator':
                            if member in binding.get('members', []):
                                has_token_creator_permission = True
                                break
                except json.JSONDecodeError:
                    pass

            if not has_token_creator_permission:
                # Grant on the service account itself (for self-impersonation)
                result = run_command(
                    f'gcloud iam service-accounts add-iam-policy-binding {terraform_sa_email} '
                    f'--member="serviceAccount:{terraform_sa_email}" '
                    f'--role="roles/iam.serviceAccountTokenCreator" '
                    f'--quiet 2>&1',
                    check=False
                )
                if result and ("Updated IAM policy" in result or "bindings:" in result):
                    print_success("github-actions-terraform granted Service Account Token Creator role")
            else:
                print_info("github-actions-terraform already has Service Account Token Creator permissions")
        else:
            print(f"\n{Colors.YELLOW}WARNING: github-actions-terraform service account not found.{Colors.NC}")
            print("This is expected if you haven't run Terraform yet.")
            print("The service account will be created by your first Terraform run.")

def initialize_firebase(config):
    """Initialize Firebase on the GCP project."""
    print_step(5, 5, "Initializing Firebase on GCP project...")

    # Check if Firebase is already initialized
    print_info("Checking if Firebase is already initialized...")
    check_result = run_command(
        f'curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" '
        f'-H "x-goog-user-project: {config["project_id"]}" '
        f'"https://firebase.googleapis.com/v1beta1/projects/{config["project_id"]}" '
        f'-w "\\n%{{http_code}}"',
        check=False
    )

    if check_result:
        lines = check_result.strip().split('\n')
        http_code = lines[-1] if lines else ""
        response_body = '\n'.join(lines[:-1]) if len(lines) > 1 else ""

        if http_code == "200":
            print_info("Firebase is already initialized on this project")
            try:
                # Try to parse and display project info
                import json
                project_data = json.loads(response_body)
                if 'projectId' in project_data:
                    print_success(f"Firebase project: {project_data.get('projectId')}")
            except:
                pass
            return

    # Initialize Firebase via API
    print_info("Firebase not initialized. Adding Firebase to project...")
    add_result = run_command(
        f'curl -s -X POST '
        f'-H "Authorization: Bearer $(gcloud auth print-access-token)" '
        f'-H "x-goog-user-project: {config["project_id"]}" '
        f'-H "Content-Type: application/json" '
        f'"https://firebase.googleapis.com/v1beta1/projects/{config["project_id"]}:addFirebase" '
        f'-w "\\n%{{http_code}}"',
        check=False
    )

    if add_result:
        lines = add_result.strip().split('\n')
        http_code = lines[-1] if lines else ""
        response_body = '\n'.join(lines[:-1]) if len(lines) > 1 else ""

        if http_code in ["200", "201"]:
            print_success("Successfully added Firebase to project")
            try:
                import json
                project_data = json.loads(response_body)
                if 'projectId' in project_data:
                    print_success(f"Firebase project ID: {project_data.get('projectId')}")
            except:
                pass
        else:
            # Check if error indicates Firebase already exists
            try:
                import json
                error_data = json.loads(response_body)
                error_msg = error_data.get('error', {}).get('message', '')

                if 'already exists' in error_msg.lower() or 'ALREADY_EXISTS' in error_msg:
                    print_info("Firebase is already initialized on this project")
                else:
                    print(f"\n{Colors.YELLOW}Warning: Could not initialize Firebase via API{Colors.NC}")
                    print(f"{Colors.YELLOW}Error: {error_msg}{Colors.NC}")
                    print(f"\n{Colors.YELLOW}You may need to initialize Firebase manually:{Colors.NC}")
                    print("1. Go to: https://console.firebase.google.com/")
                    print(f"2. Create a project and select existing GCP project: {config['project_id']}")
                    print("")
            except:
                print(f"\n{Colors.YELLOW}Warning: Could not initialize Firebase via API (HTTP {http_code}){Colors.NC}")
                print(f"{Colors.YELLOW}You may need to initialize Firebase manually at:{Colors.NC}")
                print("https://console.firebase.google.com/")

    # Inform about Firebase security rules deployment via IaC
    print(f"\n{Colors.INFO}ℹ  Firebase Security Rules:{Colors.NC}")
    print(f"{Colors.INFO}   - firestore.rules and storage.rules will be deployed automatically{Colors.NC}")
    print(f"{Colors.INFO}   - Managed via Terraform (infrastructure/terraform/firebase.tf){Colors.NC}")
    print(f"{Colors.INFO}   - Deploys when you push changes (IaC workflow){Colors.NC}")

def create_firebase_hosting_sites(project_id):
    """Create Firebase Hosting sites for all sites in the monorepo."""
    print_info("Creating Firebase Hosting sites...")

    # Sites defined in firebase.json
    sites = ["fellspiral", "videobrowser", "audiobrowser"]

    for site_id in sites:
        # Check if site already exists
        check_result = run_command(
            f'curl -s -H "Authorization: Bearer $(gcloud auth print-access-token)" '
            f'-H "x-goog-user-project: {project_id}" '
            f'"https://firebasehosting.googleapis.com/v1beta1/projects/{project_id}/sites/{site_id}" '
            f'-w "\\n%{{http_code}}"',
            check=False
        )

        if check_result:
            lines = check_result.strip().split('\n')
            http_code = lines[-1] if lines else ""
            response_body = '\n'.join(lines[:-1]) if len(lines) > 1 else ""

            if http_code == "200":
                print_info(f"  Site '{site_id}' already exists")
                continue
            elif http_code == "404":
                # Site doesn't exist, will create it
                pass
            else:
                # Unexpected response when checking - show it
                print_info(f"  Checking site '{site_id}' returned HTTP {http_code}")
                if response_body and len(response_body) < 200:
                    print_info(f"    Response: {response_body[:200]}")

        # Create the site (siteId is a query parameter, not in body)
        print_info(f"  Creating site '{site_id}'...")
        create_result = run_command(
            f'curl -s -X POST '
            f'-H "Authorization: Bearer $(gcloud auth print-access-token)" '
            f'-H "x-goog-user-project: {project_id}" '
            f'-H "Content-Type: application/json" '
            f'"https://firebasehosting.googleapis.com/v1beta1/projects/{project_id}/sites?siteId={site_id}" '
            f'-w "\\n%{{http_code}}"',
            check=False
        )

        if create_result:
            lines = create_result.strip().split('\n')
            http_code = lines[-1] if lines else ""
            response_body = '\n'.join(lines[:-1]) if len(lines) > 1 else ""

            if http_code in ["200", "201"]:
                print_success(f"  Created site '{site_id}'")
                try:
                    site_data = json.loads(response_body)
                    if 'defaultUrl' in site_data:
                        print_success(f"    URL: {site_data['defaultUrl']}")
                except:
                    pass
            else:
                # Check if error indicates site already exists or is reserved
                try:
                    error_data = json.loads(response_body)
                    error_msg = error_data.get('error', {}).get('message', '')

                    if 'already exists' in error_msg.lower() or 'ALREADY_EXISTS' in error_msg:
                        print_info(f"  Site '{site_id}' already exists")
                    elif 'reserved by another project' in error_msg.lower():
                        print(f"{Colors.YELLOW}  Warning: Site '{site_id}' is reserved by another Firebase project{Colors.NC}")
                        print(f"{Colors.YELLOW}  This usually means:{Colors.NC}")
                        print(f"{Colors.YELLOW}  1. You created this site in a different Firebase project{Colors.NC}")
                        print(f"{Colors.YELLOW}  2. You need to delete it from the other project or use it there{Colors.NC}")
                        print(f"{Colors.YELLOW}  3. Or use a different site name in firebase.json{Colors.NC}")
                        print(f"{Colors.YELLOW}  Check Firebase Console: https://console.firebase.google.com/{Colors.NC}")
                    else:
                        print(f"{Colors.YELLOW}  Warning: Could not create site '{site_id}' (HTTP {http_code}){Colors.NC}")
                        print(f"{Colors.YELLOW}  Error: {error_msg}{Colors.NC}")
                except:
                    print(f"{Colors.YELLOW}  Warning: Could not create site '{site_id}' (HTTP {http_code}){Colors.NC}")

    print_success("Firebase Hosting sites configured")

def generate_github_secrets(config):
    """Generate and display GitHub secrets."""
    print_header("Pre-Terraform Setup Complete! ✓")

    print(f"{Colors.BLUE}Configuration Summary:{Colors.NC}")
    print(f"  Project ID: {config['project_id']}")
    print(f"  Region: {config['region']}")
    print(f"  Service Account: {config['service_account_email']}")
    print(f"  Workload Identity: Configured")
    if run_command(f'gcloud secrets describe GITHUB_API_TOKEN --project={config["project_id"]} 2>/dev/null', check=False):
        print(f"  CI Logs Proxy Secret: Created")

    # Use pre-gathered decision about auto-creating secrets
    if config.get('auto_create_secrets'):
        print(f"\n{Colors.YELLOW}Creating GitHub secrets...{Colors.NC}")

        # Create secrets using gh CLI
        repo_full = f"{config['repo_owner']}/{config['repo_name']}"

        # Try to create secrets, capturing any errors
        success = True

        proc1 = subprocess.Popen(
            f'gh secret set GCP_PROJECT_ID -R {repo_full} 2>&1',
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout1, stderr1 = proc1.communicate(input=config['project_id'].encode())
        if proc1.returncode != 0:
            success = False

        proc2 = subprocess.Popen(
            f'gh secret set GCP_WORKLOAD_IDENTITY_PROVIDER -R {repo_full} 2>&1',
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout2, stderr2 = proc2.communicate(input=config['workload_identity_provider'].encode())
        if proc2.returncode != 0:
            success = False

        proc3 = subprocess.Popen(
            f'gh secret set GCP_SERVICE_ACCOUNT -R {repo_full} 2>&1',
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        stdout3, stderr3 = proc3.communicate(input=config['service_account_email'].encode())
        if proc3.returncode != 0:
            success = False

        if success:
            print_success("GitHub secrets created successfully!")
            print("")
            print(f"{Colors.GREEN}{'='*60}{Colors.NC}")
            print(f"{Colors.GREEN}  All Done! 🚀{Colors.NC}")
            print(f"{Colors.GREEN}{'='*60}{Colors.NC}")
            print("")
            print(f"{Colors.BLUE}Next steps:{Colors.NC}")
            print("1. Push changes to trigger the Infrastructure as Code workflow:")
            print("   git push origin your-branch")
            print("2. The IaC workflow will automatically:")
            print("   - Create Terraform state bucket")
            print("   - Run Terraform to create infrastructure (buckets, CDN, IAM roles)")
            print("   - Deploy the main site")
            print("   - Deploy the CI logs proxy (if on proxy branch)")
            print("")
            print(f"{Colors.GREEN}Fully automated deployment ready! 🎉{Colors.NC}\n")
            return
        else:
            print(f"\n{Colors.RED}Failed to create secrets automatically.{Colors.NC}")
            print(f"{Colors.YELLOW}This usually means you don't have admin access to the repository.{Colors.NC}")
            print(f"{Colors.YELLOW}You need to be a repository admin to create secrets via gh CLI.{Colors.NC}")
            print(f"\n{Colors.YELLOW}Falling back to manual instructions...{Colors.NC}\n")

    # Manual instructions
    print(f"\n{Colors.BLUE}GitHub Secrets Configuration:{Colors.NC}")
    print(f"\nGo to: https://github.com/{config['repo_owner']}/{config['repo_name']}/settings/secrets/actions")
    print("\nAdd these secrets:")

    print(f"\n{Colors.YELLOW}Secret 1: GCP_PROJECT_ID{Colors.NC}")
    print(f"{config['project_id']}")

    print(f"\n{Colors.YELLOW}Secret 2: GCP_WORKLOAD_IDENTITY_PROVIDER{Colors.NC}")
    print(f"{config['workload_identity_provider']}")

    print(f"\n{Colors.YELLOW}Secret 3: GCP_SERVICE_ACCOUNT{Colors.NC}")
    print(f"{config['service_account_email']}")

    print(f"\n{Colors.BLUE}Next Steps:{Colors.NC}")
    print("1. Add the 3 secrets above to GitHub")
    print("2. Push changes to trigger the Infrastructure as Code workflow:")
    print("   git push origin your-branch")
    print("3. The IaC workflow will automatically:")
    print("   - Create Terraform state bucket")
    print("   - Run Terraform to create infrastructure (buckets, CDN, IAM roles)")
    print("   - Deploy the main site")
    print("   - Deploy the CI logs proxy (if on proxy branch)")

    print(f"\n{Colors.GREEN}All infrastructure will be managed by Terraform!{Colors.NC}")
    print(f"{Colors.GREEN}Estimated monthly cost: ~$0.13 for typical traffic{Colors.NC}\n")

def create_terraform_state_bucket(project_id):
    """Create Terraform state bucket if it doesn't exist."""
    print_info("Creating Terraform state bucket...")

    bucket_name = "fellspiral-terraform-state"

    # Check if bucket exists
    bucket_exists = run_command(
        f'gcloud storage buckets describe gs://{bucket_name} --project={project_id} 2>/dev/null',
        check=False
    )

    if not bucket_exists:
        print_info(f"Creating bucket gs://{bucket_name}...")
        run_command(
            f'gcloud storage buckets create gs://{bucket_name} '
            f'--project={project_id} '
            f'--location=us-central1 '
            f'--uniform-bucket-level-access'
        )
        run_command(f'gcloud storage buckets update gs://{bucket_name} --versioning')
        print_success("Terraform state bucket created with versioning enabled")
    else:
        print_info("Terraform state bucket already exists")

    # Verify access
    run_command(
        f'gcloud storage buckets describe gs://{bucket_name} --project={project_id}',
        check=False,
        capture_output=False
    )

def run_terraform(project_id, terraform_dir="infrastructure/terraform"):
    """Run Terraform to apply infrastructure."""
    print_header("Running Terraform")

    # Change to terraform directory
    original_dir = os.getcwd()
    try:
        os.chdir(terraform_dir)

        # Create terraform.tfvars
        print_info("Creating terraform.tfvars...")
        with open('terraform.tfvars', 'w') as f:
            f.write(f'project_id  = "{project_id}"\n')
            f.write('region      = "us-central1"\n')
            f.write('environment = "production"\n')
        print_success("terraform.tfvars created")

        # Terraform init
        print_info("Running terraform init...")
        run_command("terraform init -reconfigure", capture_output=False)
        print_success("Terraform initialized")

        # Terraform validate
        print_info("Running terraform validate...")
        run_command("terraform validate -no-color", capture_output=False)
        print_success("Terraform configuration valid")

        # Terraform plan
        print_info("Running terraform plan...")
        run_command("terraform plan -no-color -out=tfplan", capture_output=False)
        print_success("Terraform plan created")

        # Terraform apply
        print_info("Running terraform apply...")
        run_command("terraform apply -auto-approve tfplan", capture_output=False)
        print_success("Terraform applied successfully")

    finally:
        os.chdir(original_dir)

def main():
    """Main setup function."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Infrastructure setup and IaC management"
    )
    parser.add_argument(
        '--ci',
        action='store_true',
        help='Run in CI/CD mode (non-interactive, runs terraform)'
    )
    parser.add_argument(
        '--iac',
        action='store_true',
        help='Run only infrastructure as code (terraform)'
    )
    parser.add_argument(
        '--skip-terraform',
        action='store_true',
        help='Skip terraform execution (only run pre-setup)'
    )

    args = parser.parse_args()

    try:
        if args.ci:
            # CI/CD mode - non-interactive
            print_header("Infrastructure Setup (CI/CD Mode)")

            # Get project ID from environment or gcloud config
            project_id = os.environ.get('GCP_PROJECT_ID')
            if not project_id:
                project_id = run_command('gcloud config get-value project 2>/dev/null', check=False)
                if project_id:
                    project_id = project_id.strip()

            if not project_id:
                print_error("GCP_PROJECT_ID not set and no default project configured")

            print_info(f"Using project: {project_id}")

            # Create Firebase Hosting sites (must be done before Terraform)
            create_firebase_hosting_sites(project_id)

            # Create terraform state bucket
            create_terraform_state_bucket(project_id)

            # Run terraform
            run_terraform(project_id)

            print_success("Infrastructure setup complete")

        elif args.iac:
            # IaC only mode
            print_header("Running Infrastructure as Code")

            # Get project ID
            project_id = os.environ.get('GCP_PROJECT_ID')
            if not project_id:
                project_id = run_command('gcloud config get-value project 2>/dev/null', check=False)
                if project_id:
                    project_id = project_id.strip()

            if not project_id:
                print_error("GCP_PROJECT_ID not set and no default project configured")

            print_info(f"Using project: {project_id}")

            # Create Firebase Hosting sites (must be done before Terraform)
            create_firebase_hosting_sites(project_id)

            # Create terraform state bucket
            create_terraform_state_bucket(project_id)

            # Run terraform
            run_terraform(project_id)

        else:
            # Interactive mode - original setup
            print_header("Fellspiral Pre-Terraform Setup")
            print("This script sets up prerequisites for Terraform.")
            print("All infrastructure will be managed by Terraform.\n")

            check_prerequisites()
            authenticate_gcp()

            # Gather all user inputs upfront
            config = gather_user_inputs()

            # Run automated setup steps
            enable_apis(config)
            setup_workload_identity(config)
            create_service_account(config)
            setup_ci_logs_proxy(config)
            initialize_firebase(config)
            generate_github_secrets(config)

            # Optionally run terraform
            if not args.skip_terraform:
                run_terraform_prompt = input(
                    f"\n{Colors.YELLOW}Run Terraform now to create infrastructure? (Y/n): {Colors.NC}"
                ).strip().lower()

                if run_terraform_prompt in ['', 'y', 'yes']:
                    create_terraform_state_bucket(config['project_id'])
                    run_terraform(config['project_id'])

    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Setup cancelled by user{Colors.NC}")
        sys.exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
