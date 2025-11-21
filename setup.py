#!/usr/bin/env python3
"""
Fellspiral Pre-Terraform Setup
===============================

One-time setup for Terraform prerequisites.
This script ONLY handles what must be done before Terraform can run.

All infrastructure (buckets, CDN, IAM roles, etc.) is managed by Terraform.

This script is fully idempotent - you can run it multiple times safely.
Existing resources will be detected and skipped.

Usage:
    python3 setup.py
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

def get_project_info():
    """Get project ID and GitHub repo info from user."""
    print_header("Project Configuration")

    project_id = input(f"{Colors.BLUE}Enter your GCP Project ID: {Colors.NC}").strip()
    if not project_id:
        print_error("Project ID cannot be empty")

    repo_owner = os.environ.get('GITHUB_REPO_OWNER', 'rumor-ml')
    repo_name = os.environ.get('GITHUB_REPO_NAME', 'commons.systems')

    print(f"\n{Colors.BLUE}GitHub Repository:{Colors.NC} {repo_owner}/{repo_name}")
    print(f"{Colors.YELLOW}To change, set GITHUB_REPO_OWNER and GITHUB_REPO_NAME environment variables{Colors.NC}")

    return {
        'project_id': project_id,
        'repo_owner': repo_owner,
        'repo_name': repo_name,
        'region': 'us-central1'
    }

def enable_apis(config):
    """Enable all required GCP APIs (idempotent - safe to run multiple times)."""
    print_step(1, 4, "Enabling required GCP APIs...")

    # Set project
    run_command(f"gcloud config set project {config['project_id']}", capture_output=False)

    apis = [
        'compute.googleapis.com',
        'storage.googleapis.com',
        'cloudresourcemanager.googleapis.com',
        'run.googleapis.com',
        'artifactregistry.googleapis.com',
        'secretmanager.googleapis.com',
        'iam.googleapis.com',
        'iamcredentials.googleapis.com',
        'sts.googleapis.com'
    ]

    # Note: gcloud services enable is idempotent - already enabled APIs are skipped
    run_command(f"gcloud services enable {' '.join(apis)} --quiet")
    print_success("APIs enabled (already-enabled APIs skipped)")

def setup_workload_identity(config):
    """Set up Workload Identity Federation for keyless auth."""
    print_step(2, 4, "Setting up Workload Identity Federation...")

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
    print_step(3, 4, "Creating GitHub Actions service account...")

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
    print_step(4, 4, "Setting up CI Logs Proxy prerequisites...")

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

    # Create GitHub API token secret
    print_info("Setting up GitHub API token secret...")
    secret_name = "GITHUB_API_TOKEN"

    # Check if secret exists
    secret_exists = run_command(
        f'gcloud secrets describe {secret_name} --project={config["project_id"]} 2>/dev/null',
        check=False
    )

    if secret_exists:
        print_info(f"Secret {secret_name} already exists")
        update = input(f"{Colors.YELLOW}Update with a new token? (y/N): {Colors.NC}").strip().lower()

        if update == 'y':
            print(f"\n{Colors.BLUE}Enter your GitHub Personal Access Token:{Colors.NC}")
            print("(Token will not be visible as you type)")
            token = getpass("")

            if token:
                proc = subprocess.Popen(
                    f'gcloud secrets versions add {secret_name} --data-file=- --project={config["project_id"]}',
                    shell=True,
                    stdin=subprocess.PIPE
                )
                proc.communicate(input=token.encode())
                print_success("Secret updated")
            else:
                print_info("Skipping secret update")
    else:
        print(f"\n{Colors.BLUE}Creating GitHub API token secret...{Colors.NC}")
        print("\nTo create a GitHub token:")
        print("  1. Go to GitHub Settings → Developer settings → Personal access tokens")
        print("  2. Click 'Generate new token (classic)'")
        print("  3. Give it a name like 'CI Logs Proxy'")
        print("  4. Select scopes: 'repo' (for private repos) or 'public_repo' (for public)")
        print("  5. Click 'Generate token' and copy it")
        print(f"\n{Colors.BLUE}Enter your GitHub Personal Access Token:{Colors.NC}")
        print("(Token will not be visible as you type)")
        token = getpass("")

        if token:
            run_command(
                f'gcloud secrets create {secret_name} --replication-policy="automatic" '
                f'--project={config["project_id"]}'
            )
            proc = subprocess.Popen(
                f'gcloud secrets versions add {secret_name} --data-file=- --project={config["project_id"]}',
                shell=True,
                stdin=subprocess.PIPE
            )
            proc.communicate(input=token.encode())
            print_success(f"Secret created: {secret_name}")
        else:
            print_info("Skipping secret creation")
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

    # Check if gh CLI is available
    gh_available = run_command("command -v gh", check=False)

    if gh_available:
        print(f"\n{Colors.BLUE}GitHub CLI detected!{Colors.NC}")

        # Check GitHub authentication
        print_info("Checking GitHub authentication...")
        gh_auth_status = run_command("gh auth status 2>&1", check=False)

        if gh_auth_status and "Logged in" in gh_auth_status:
            gh_user = run_command("gh api user -q .login 2>/dev/null", check=False) or "unknown"
            print_success(f"Authenticated as: {gh_user}")

            print(f"\n{Colors.YELLOW}Do you want to automatically create GitHub secrets?{Colors.NC}")
            print(f"This will add the following secrets to {config['repo_owner']}/{config['repo_name']}:")
            print("  - GCP_PROJECT_ID")
            print("  - GCP_WORKLOAD_IDENTITY_PROVIDER")
            print("  - GCP_SERVICE_ACCOUNT")
            print("")

            create_secrets = input(f"{Colors.BLUE}Create secrets automatically? (y/N): {Colors.NC}").strip().lower()

            if create_secrets == 'y':
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
            else:
                print_info("Skipping automatic secret creation.")
        else:
            print_info("Not authenticated to GitHub.")
            print(f"{Colors.YELLOW}Run 'gh auth login' to authenticate, then run this script again for automatic secret creation.{Colors.NC}")
    else:
        print(f"\n{Colors.YELLOW}GitHub CLI (gh) not found.{Colors.NC}")
        print("Install it from: https://cli.github.com/")
        print("Then run: gh auth login")

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

def main():
    """Main setup function."""
    print_header("Fellspiral Pre-Terraform Setup")
    print("This script sets up prerequisites for Terraform.")
    print("All infrastructure will be managed by Terraform.\n")

    try:
        check_prerequisites()
        authenticate_gcp()
        config = get_project_info()

        enable_apis(config)
        setup_workload_identity(config)
        create_service_account(config)
        setup_ci_logs_proxy(config)
        generate_github_secrets(config)

    except KeyboardInterrupt:
        print(f"\n\n{Colors.YELLOW}Setup cancelled by user{Colors.NC}")
        sys.exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {e}")

if __name__ == "__main__":
    main()
