#!/usr/bin/env python3
"""Debug GCP deployment prerequisites."""

import os
import json
import subprocess
import sys

PROJECT_ID = "chalanding"
REGION = "us-central1"
SERVICE_ACCOUNT = "github-actions-sa@chalanding.iam.gserviceaccount.com"

def get_gcp_token():
    """Get GCP access token."""
    try:
        result = subprocess.run(
            ["bash", "-c", "source get_gcp_token.sh 2>/dev/null && echo $GCP_ACCESS_TOKEN"],
            capture_output=True,
            text=True,
            timeout=10
        )
        token = result.stdout.strip()
        if token and len(token) > 10:
            return token
    except Exception as e:
        print(f"Error getting token: {e}")
    return None

def check_api_enabled(token, api_name):
    """Check if a GCP API is enabled."""
    import urllib.request

    url = f"https://serviceusage.googleapis.com/v1/projects/{PROJECT_ID}/services/{api_name}"
    headers = {'Authorization': f'Bearer {token}'}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())
            return data.get('state') == 'ENABLED'
    except Exception as e:
        return None

def check_artifact_registry(token):
    """Check Artifact Registry repositories."""
    import urllib.request

    url = f"https://artifactregistry.googleapis.com/v1/projects/{PROJECT_ID}/locations/{REGION}/repositories"
    headers = {'Authorization': f'Bearer {token}'}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())
            return data.get('repositories', [])
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return "PERMISSION_DENIED"
        elif e.code == 404:
            return "API_NOT_ENABLED"
        return f"ERROR_{e.code}"
    except Exception as e:
        return f"ERROR: {e}"

def check_cloud_run_services(token):
    """Check Cloud Run services."""
    import urllib.request

    url = f"https://run.googleapis.com/v2/projects/{PROJECT_ID}/locations/{REGION}/services"
    headers = {'Authorization': f'Bearer {token}'}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read())
            return data.get('services', [])
    except urllib.error.HTTPError as e:
        if e.code == 403:
            return "PERMISSION_DENIED"
        elif e.code == 404:
            return "API_NOT_ENABLED"
        return f"ERROR_{e.code}"
    except Exception as e:
        return f"ERROR: {e}"

def main():
    print("=== GCP Deployment Prerequisites Debug ===\n")
    print(f"Project: {PROJECT_ID}")
    print(f"Region: {REGION}")
    print(f"Service Account: {SERVICE_ACCOUNT}")
    print()

    # Get token
    print("1. Getting GCP access token...")
    token = get_gcp_token()
    if not token:
        print("   ❌ Failed to get access token")
        print("\n   Required: GCP credentials in environment")
        return 1
    print(f"   ✅ Token acquired (length: {len(token)})")
    print()

    # Check APIs
    print("2. Checking required APIs...")
    apis = {
        'Cloud Run': 'run.googleapis.com',
        'Artifact Registry': 'artifactregistry.googleapis.com',
        'Cloud Build': 'cloudbuild.googleapis.com'
    }

    api_status = {}
    for name, api in apis.items():
        status = check_api_enabled(token, api)
        api_status[api] = status
        emoji = "✅" if status else "❌" if status is False else "❓"
        status_text = "ENABLED" if status else "DISABLED" if status is False else "UNKNOWN"
        print(f"   {emoji} {name}: {status_text}")
    print()

    # Check Artifact Registry
    print("3. Checking Artifact Registry repositories...")
    repos = check_artifact_registry(token)
    if isinstance(repos, str):
        if "PERMISSION_DENIED" in repos:
            print("   ❌ Permission denied - service account needs roles/artifactregistry.reader")
        elif "API_NOT_ENABLED" in repos:
            print("   ❌ Artifact Registry API not enabled")
        else:
            print(f"   ❌ Error: {repos}")
    elif isinstance(repos, list):
        print(f"   ✅ Found {len(repos)} repository(ies)")
        for repo in repos:
            name = repo['name'].split('/')[-1]
            print(f"      - {name}")

        # Check for required repos
        repo_names = [r['name'].split('/')[-1] for r in repos]
        if 'fellspiral-previews' not in repo_names:
            print("   ⚠️  Missing: fellspiral-previews repository")
        if 'fellspiral-production' not in repo_names:
            print("   ⚠️  Missing: fellspiral-production repository")
    print()

    # Check Cloud Run
    print("4. Checking Cloud Run services...")
    services = check_cloud_run_services(token)
    if isinstance(services, str):
        if "PERMISSION_DENIED" in services:
            print("   ❌ Permission denied - service account needs roles/run.viewer")
        elif "API_NOT_ENABLED" in services:
            print("   ❌ Cloud Run API not enabled")
        else:
            print(f"   ❌ Error: {services}")
    elif isinstance(services, list):
        print(f"   ✅ Found {len(services)} service(s)")
        for svc in services:
            name = svc['name'].split('/')[-1]
            print(f"      - {name}")
    print()

    # Generate recommendations
    print("=== Recommendations ===\n")

    recommendations = []

    # Check if APIs need to be enabled
    if not api_status.get('run.googleapis.com'):
        recommendations.append({
            'issue': 'Cloud Run API not enabled',
            'command': f'gcloud services enable run.googleapis.com --project={PROJECT_ID}'
        })

    if not api_status.get('artifactregistry.googleapis.com'):
        recommendations.append({
            'issue': 'Artifact Registry API not enabled',
            'command': f'gcloud services enable artifactregistry.googleapis.com --project={PROJECT_ID}'
        })

    # Check if repos need to be created
    if isinstance(repos, list):
        repo_names = [r['name'].split('/')[-1] for r in repos]
        if 'fellspiral-previews' not in repo_names:
            recommendations.append({
                'issue': 'fellspiral-previews repository missing',
                'command': f'gcloud artifacts repositories create fellspiral-previews --repository-format=docker --location={REGION} --description="Feature branch preview images" --project={PROJECT_ID}'
            })
        if 'fellspiral-production' not in repo_names:
            recommendations.append({
                'issue': 'fellspiral-production repository missing',
                'command': f'gcloud artifacts repositories create fellspiral-production --repository-format=docker --location={REGION} --description="Production site images" --project={PROJECT_ID}'
            })

    if recommendations:
        print("Run these commands to fix issues:\n")
        for i, rec in enumerate(recommendations, 1):
            print(f"{i}. {rec['issue']}")
            print(f"   {rec['command']}\n")
        return 1
    else:
        print("✅ All prerequisites met!")
        return 0

if __name__ == '__main__':
    sys.exit(main())
