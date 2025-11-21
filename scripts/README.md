# Automation Scripts

This directory contains automation scripts for Firebase and GCP infrastructure setup.

## Firebase Configuration Scripts

### `get-firebase-config.sh`

Retrieves Firebase web app configuration from GCP programmatically.

**Usage:**
```bash
./scripts/get-firebase-config.sh [PROJECT_ID]
```

**What it does:**
1. Lists existing Firebase web apps in the project
2. Creates a new web app if none exist
3. Retrieves the Firebase configuration (API key, auth domain, etc.)
4. Outputs the configuration as JSON to stdout

**Requirements:**
- `gcloud` CLI authenticated
- `jq` and `curl` installed
- Firebase enabled on the GCP project

**Output:**
```json
{
  "apiKey": "AIza...",
  "authDomain": "project.firebaseapp.com",
  "projectId": "project-id",
  "storageBucket": "bucket-name",
  "messagingSenderId": "123456789",
  "appId": "1:123456789:web:abc123"
}
```

---

### `inject-firebase-config.sh`

Injects Firebase configuration into a JavaScript config file, replacing placeholder values.

**Usage:**
```bash
./scripts/inject-firebase-config.sh <path-to-firebase-config.js> [PROJECT_ID]
```

**Example:**
```bash
./scripts/inject-firebase-config.sh videobrowser/site/src/firebase-config.js chalanding
```

**What it does:**
1. Calls `get-firebase-config.sh` to retrieve the config
2. Overwrites the specified JavaScript file with real values
3. Preserves the JSDoc comments

**Requirements:**
- `get-firebase-config.sh` in the same directory
- All requirements from `get-firebase-config.sh`

---

### `deploy-firebase-storage-rules.sh`

Deploys Firebase Storage security rules using the Firebase Management API (no Firebase CLI required).

**Usage:**
```bash
./scripts/deploy-firebase-storage-rules.sh <rules-file> [BUCKET_NAME]
```

**Example:**
```bash
./scripts/deploy-firebase-storage-rules.sh videobrowser/storage.rules rml-media
```

**What it does:**
1. Reads the security rules file
2. Creates a new ruleset in Firebase
3. Releases the ruleset to the specified storage bucket

**Requirements:**
- `gcloud` CLI authenticated with Firebase access
- `jq` and `curl` installed
- Firebase enabled on the GCP project

**Note:** This script uses the Firebase Management API directly, so it works in CI/CD environments without requiring the Firebase CLI.

---

## CI/CD Integration

These scripts are automatically used in the GitHub Actions deployment workflow:

**`deploy-videobrowser.yml`:**
```yaml
- name: Inject Firebase configuration
  run: |
    scripts/inject-firebase-config.sh \
      videobrowser/site/src/firebase-config.js \
      ${{ env.GCP_PROJECT_ID }}

- name: Deploy Firebase Storage rules
  run: |
    scripts/deploy-firebase-storage-rules.sh \
      videobrowser/storage.rules \
      rml-media
```

This ensures that:
1. The Firebase config is fetched fresh on each deployment
2. Storage rules are deployed before the app is built
3. No manual configuration is required

---

## Local Development

For local development, you need to manually inject the Firebase config once:

```bash
# Set your GCP project
gcloud config set project chalanding

# Inject config
./scripts/inject-firebase-config.sh videobrowser/site/src/firebase-config.js

# Deploy rules
./scripts/deploy-firebase-storage-rules.sh videobrowser/storage.rules rml-media
```

After this, the `videobrowser/site/src/firebase-config.js` file will have real values and your local dev server will work.

**Note:** The `firebase-config.js` file is safe to commit with real values since Firebase configuration is public-safe (it only contains project identifiers, not secrets). Access control is managed via Firebase Storage security rules.

---

## Troubleshooting

### "Firebase may not be enabled on this project"

**Solution:**
1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Select your existing GCP project
4. Follow the setup wizard

Alternatively, enable via API (already done if you ran `setup.py`):
```bash
gcloud services enable firebase.googleapis.com \
  firebaserules.googleapis.com \
  firebasestorage.googleapis.com
```

### "Permission denied" errors

**Solution:**
Grant the service account Firebase permissions:
```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/firebase.admin"
```

### Script not executable

**Solution:**
```bash
chmod +x scripts/*.sh
```
