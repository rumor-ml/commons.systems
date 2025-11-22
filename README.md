# Commons.Systems Monorepo

A monorepo for commons.systems projects.

## Projects

This monorepo hosts multiple static sites with shared infrastructure and CI/CD pipelines.

### Fellspiral
A tactical tabletop RPG with detailed combat mechanics featuring initiative-based gameplay, zones, and strategic decision-making.

- **Site**: `/fellspiral/site` - Static website showcasing game rules
- **Tests**: `/fellspiral/tests` - E2E and integration tests
- **Docs**: `/fellspiral/rules.md` - Game rules documentation

### Video Browser
A video navigation interface for exploring video files stored in GCS bucket `rml-media/video`.

- **Site**: `/videobrowser/site` - Interactive video browser with playback
- **Tests**: `/videobrowser/tests` - E2E tests for video browser functionality

---

## Table of Contents

- [Quick Start](#quick-start)
- [GitHub Authentication](#github-authentication)
- [Monorepo Architecture](#monorepo-architecture)
- [Adding a New Site](#adding-a-new-site)
- [CICD Requirements](#cicd-requirements)
- [Code Standards](#code-standards)
- [CI/CD Pipeline](#cicd-pipeline)
- [Architecture](#architecture)
- [Testing](#testing)
- [Contributing](#contributing)
- [Cost](#cost)
- [Troubleshooting](#troubleshooting)

---

## Quick Start

Deploy the to GCP with **zero local setup** and **one local command**.

### GitHub Codespaces

1. **Open in Codespaces**:
   - Click the green "Code" button on GitHub
   - Select "Codespaces" tab
   - Click "Create codespace on your-branch"
   - Wait for container to build

2. **Enable the Service Usage API** (one-time prerequisite):
   - Go to: https://console.developers.google.com/apis/api/serviceusage.googleapis.com/overview?project=YOUR_PROJECT_ID
   - Click "Enable"
   - Wait 1-2 minutes for propagation

3. **Run the setup script**:
   ```bash
   python3 setup.py
   ```

   **The script handles everything**:
   - Gathers all inputs upfront (project ID defaults to gcloud config)
   - Enables all required GCP APIs (Firebase, Cloud Run, Artifact Registry, etc.)
   - Sets up Workload Identity Federation
   - Creates service accounts with IAM permissions
   - Configures Artifact Registry
   - Initializes Firebase on your GCP project
   - Optionally creates GitHub secrets automatically

3. <!-- UPDATE THIS: what is the next state for a user that deploys after cloning the repo -->

---

## GitHub Authentication

All sites in this monorepo use GitHub OAuth for authentication via Firebase Authentication. This provides secure, user-friendly sign-in with GitHub accounts.

### Features

- ✅ **GitHub OAuth 2.0** - Secure authentication via GitHub
- ✅ **Shared Auth Library** - DRY authentication components (`shared/auth/`)
- ✅ **Reusable UI Components** - Login button, user profile display
- ✅ **Firebase Integration** - Leverages Firebase Authentication
- ✅ **Security Rules** - Firestore and Storage rules require authentication
- ✅ **Persistent Sessions** - Auto-login on return visits

### Quick Setup

Run the interactive setup script:

```bash
python3 scripts/setup-github-auth.py
```

This script will guide you through:
1. Creating a GitHub OAuth App
2. Configuring Firebase Authentication
3. Deploying security rules
4. Testing authentication locally

### Manual Setup

#### 1. Create GitHub OAuth App

1. Go to [GitHub Settings → Developer settings → OAuth Apps](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name**: Commons Systems Auth (or your choice)
   - **Homepage URL**: `https://your-site.run.app`
   - **Authorization callback URL**: `https://chalanding.firebaseapp.com/__/auth/handler`
4. Click **"Register application"**
5. Generate and copy the **Client Secret**

#### 2. Configure Firebase Authentication

1. Go to [Firebase Console → Authentication → Sign-in method](https://console.firebase.google.com/project/chalanding/authentication/providers)
2. Enable **GitHub** provider
3. Enter your **Client ID** and **Client Secret**
4. Note the callback URL: `https://chalanding.firebaseapp.com/__/auth/handler`
5. Save

#### 3. Deploy Security Rules

```bash
# Deploy Firestore and Storage security rules
firebase deploy --only firestore:rules,storage:rules --project chalanding
```

#### 4. Test Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev              # Fellspiral
npm run dev:videobrowser # Videobrowser

# Open browser and click "Sign in with GitHub"
```

### How It Works

#### Authentication Flow

1. User clicks **"Sign in with GitHub"** button
2. GitHub OAuth popup opens
3. User authorizes the app
4. Firebase exchanges OAuth code for auth token
5. User is signed in across all sites
6. Auth state persists in localStorage

#### Shared Auth Library

Location: `shared/auth/`

The library provides:
- **Core Auth** (`github-auth.js`) - Firebase GitHub OAuth integration
- **State Management** (`auth-state.js`) - Persistent auth state
- **UI Components**:
  - `createAuthButton()` - Login/logout button
  - `createUserProfile()` - User info display
  - `createAuthGuard()` - Protected content wrapper

#### Site Integration

Each site initializes auth in its entry point:

```javascript
// fellspiral/site/src/scripts/auth-init.js
import { initAuth, initAuthState, createAuthButton, createUserProfile } from '@commons/auth';

export function initializeAuth() {
  initAuth(firebaseConfig);
  initAuthState();

  // Add auth UI to navbar
  const authButton = createAuthButton({ ... });
  const userProfile = createUserProfile({ ... });
  // ...
}
```

#### Security Rules

**Firestore** (`firestore.rules`):
```
// Require authentication for all operations
allow read: if request.auth != null;
allow create: if request.auth != null
              && request.resource.data.createdBy == request.auth.uid;
```

**Storage** (`storage.rules`):
```
// Require authentication for video access
match /video/{videoFile} {
  allow read: if request.auth != null;
}
```

### Production Deployment

When deploying to production:

1. **Update OAuth callback URLs** in GitHub OAuth App:
   - Add production domains: `https://your-production-url.run.app/__/auth/handler`
   - Keep development URLs for local testing

2. **Deploy security rules**:
   ```bash
   firebase deploy --only firestore:rules,storage:rules --project chalanding
   ```

3. **Push to trigger CI/CD**:
   ```bash
   git add .
   git commit -m "Add GitHub authentication"
   git push
   ```

### Testing Authentication

Auth tests are included in each site's test suite:

```bash
# Test fellspiral auth
npm test --workspace=fellspiral/tests

# Test videobrowser auth
npm test --workspace=videobrowser/tests
```

Tests verify:
- Auth UI components render correctly
- Buttons and profiles are visible/hidden based on state
- Styling is applied correctly
- Components are in the correct locations

### Troubleshooting

**Popup blocked by browser:**
- Enable popups for your domain
- Use browser settings to allow OAuth popups

**"Invalid callback URL":**
- Verify GitHub OAuth App callback URL matches Firebase: `https://chalanding.firebaseapp.com/__/auth/handler`

**"User must be authenticated" errors:**
- Ensure security rules are deployed
- Check Firebase console for authentication status
- Verify user is signed in before protected operations

**Auth state not persisting:**
- Check browser localStorage is enabled
- Clear cache and cookies, then sign in again

For more details, see:
- **[Authentication Architecture](ARCHITECTURE_AUTH.md)** - How single OAuth app works across all sites
- [Shared Auth Library Documentation](shared/auth/README.md) - Full API reference
- [Firebase Authentication Docs](https://firebase.google.com/docs/auth/web/github-auth)
- [GitHub OAuth Apps Guide](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app)

---

## Monorepo Architecture

This repository is structured as a monorepo hosting multiple static sites with shared infrastructure.

### Structure

```
commons.systems/
├── fellspiral/              # Fellspiral RPG site
│   ├── site/               # Vite project + Docker
│   └── tests/              # Playwright tests
├── videobrowser/           # Video Browser site
│   ├── site/               # Vite project + Docker
│   └── tests/              # Playwright tests
├── playwright-server/      # Shared test infrastructure
├── infrastructure/         # Shared Terraform infrastructure
│   └── terraform/
│       ├── main.tf         # Core infrastructure
│       └── sites.tf        # Site-specific Artifact Registry repos
└── .github/workflows/      # CI/CD workflows
```

### Key Principles

1. **Each site is independent** - Sites can be developed, tested, and deployed separately
2. **Shared infrastructure** - Common resources (Artifact Registry repos, test server) are reused
3. **Workspace-based builds** - npm workspaces manage dependencies and builds
4. **Path-based CI/CD** - Workflows only trigger when relevant files change
5. **Cost-effective** - Each site costs ~$0.20/month (Cloud Run with scale-to-zero)

### Infrastructure Pattern

Each site uses Cloud Run for deployment and Terraform provisions:
- Production Artifact Registry (for Docker images)
- Preview Artifact Registry (for feature branch previews)
- Automated cleanup policies (keep 10 production, 3 preview versions)
- IAM permissions for GitHub Actions

Sites share:
- Terraform state backend (GCS)
- Service accounts for deployment
- Playwright server for testing

**Benefits of Cloud Run:**
- Managed HTTPS with automatic SSL certificates
- Global load balancing included
- Scale to zero when idle (~$0.20/month per site)
- Fast deployments (~2 minutes)
- Easy rollback via revision management
- Feature branch preview deployments

---

## Adding a New Site

Follow this reproducible process to add a new site to the monorepo.

### Step 1: Create Site Structure

```bash
# Create directory structure
mkdir -p newsite/site/src
mkdir -p newsite/tests/e2e

# Create site package.json
cat > newsite/site/package.json <<'EOF'
{
  "name": "@commons/newsite-site",
  "version": "1.0.0",
  "description": "Description of your new site",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
EOF

# Create vite.config.js (adjust port as needed)
cat > newsite/site/vite.config.js <<'EOF'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3002,  // Use unique port
    open: true
  }
})
EOF

# Create tests package.json
cat > newsite/tests/package.json <<'EOF'
{
  "name": "@commons/newsite-tests",
  "version": "1.0.0",
  "description": "Test suite for New Site",
  "type": "module",
  "scripts": {
    "test": "playwright test",
    "test:ui": "playwright test --ui",
    "test:headed": "playwright test --headed",
    "test:deployed": "DEPLOYED=true playwright test",
    "test:report": "playwright show-report"
  },
  "devDependencies": {
    "@playwright/test": "^1.40.0",
    "http-server": "^14.1.1"
  }
}
EOF

# Create playwright.config.js
cat > newsite/tests/playwright.config.js <<'EOF'
import { defineConfig, devices } from '@playwright/test';

const isDeployed = process.env.DEPLOYED === 'true';
const baseURL = isDeployed
  ? process.env.DEPLOYED_URL || 'https://newsite.commons.systems'
  : 'http://localhost:3002';  // Match Vite port

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : undefined,
  reporter: [['html'], ['list'], ['json', { outputFile: 'test-results.json' }]],
  use: {
    baseURL,
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        },
      },
    },
  ],
  webServer: isDeployed ? undefined : {
    command: process.env.CI
      ? 'npx http-server ../site/dist -p 3002 -s'
      : 'cd ../site && npm run dev',
    url: 'http://localhost:3002',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
EOF

# Create Dockerfile
cat > newsite/site/Dockerfile <<'EOF'
# Multi-stage build for efficient image size
FROM node:20-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm install --production=false
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /build/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm /etc/nginx/conf.d/default.conf.default 2>/dev/null || true
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
EOF

# Create nginx.conf
cat > newsite/site/nginx.conf <<'EOF'
server {
    listen 8080;
    server_name _;
    root /usr/share/nginx/html;
    index index.html;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location ~* \.html$ {
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location / {
        try_files $uri $uri/ /index.html;
        expires -1;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
    }

    location /health {
        access_log off;
        return 200 "healthy
";
        add_header Content-Type text/plain;
    }
}
EOF

# Create .dockerignore
cat > newsite/site/.dockerignore <<'EOF'
node_modules
dist
.git
.github
*.md
.gitignore
.env*
*.log
.DS_Store
EOF

```

### Step 2: Update Root package.json

Add your site to the workspaces and scripts:

```json
{
  "workspaces": [
    "fellspiral/site",
    "fellspiral/tests",
    "videobrowser/site",
    "videobrowser/tests",
    "newsite/site",
    "newsite/tests"
  ],
  "scripts": {
    "dev:newsite": "npm run dev --workspace=newsite/site",
    "build:newsite": "npm run build --workspace=newsite/site",
    "test:newsite": "npm test --workspace=newsite/tests",
    "test:newsite:deployed": "npm run test:deployed --workspace=newsite/tests",
    "preview:newsite": "npm run preview --workspace=newsite/site"
  }
}
```

### Step 3: Add Infrastructure

Edit `infrastructure/terraform/sites.tf` to add Artifact Registry repositories for your site:

```hcl
# New Site - Production and Preview registries
resource "google_artifact_registry_repository" "newsite_production" {
  location      = var.region
  repository_id = "newsite-production"
  description   = "Production Docker images for New Site"
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions { keep_count = 10 }
  }

  cleanup_policies {
    id     = "delete-old-untagged"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"  # 7 days
    }
  }
}

resource "google_artifact_registry_repository_iam_member" "newsite_production_writer" {
  project    = var.project_id
  location   = google_artifact_registry_repository.newsite_production.location
  repository = google_artifact_registry_repository.newsite_production.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_service_account.github_actions.email}"
}

# Add preview registry similarly...

# Add outputs
output "newsite_production_registry" {
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.newsite_production.repository_id}"
  description = "New Site production Artifact Registry URL"
}
```

### Step 4: Create CI/CD Workflows

Create `.github/workflows/ci-newsite.yml`:

```yaml
name: CI - New Site

on:
  push:
    branches: ['**']
    paths:
      - 'newsite/**'
      - '.github/workflows/ci-newsite.yml'
      - 'package.json'

jobs:
  test:
    name: Build & Test New Site
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm install
      - run: npm run build:newsite
      - run: cd newsite/tests && npx playwright install --with-deps chromium
      - run: npm run test:newsite -- --project=chromium
        env:
          CI: true
```

Create `.github/workflows/deploy-newsite.yml` (copy and modify from `deploy-videobrowser.yml`).

### Step 5: Implement Your Site

1. Create HTML, CSS, and JavaScript in `newsite/site/src/`
2. Docker files (Dockerfile, nginx.conf, .dockerignore) are already created in Step 1
2. Create basic tests in `newsite/tests/e2e/`
3. Test locally: `npm run dev:newsite`
4. Build and test: `npm run build:newsite && npm run test:newsite`
5. Test Docker build: `cd newsite/site && docker build -t newsite:test .`

### Step 6: Deploy

1. Commit and push to your branch
2. CI workflow will run automatically
3. Merge to main to deploy:
   - Infrastructure workflow creates Artifact Registry repositories
   - Deploy workflow builds Docker image and deploys to Cloud Run
   - Site will be available at the Cloud Run URL with managed HTTPS

### Example: Video Browser

See the `videobrowser/` directory for a complete reference implementation that:
- Fetches videos from GCS bucket using the Storage JSON API
- Displays videos in a browsable interface with search
- Includes video player with keyboard shortcuts
- Has comprehensive E2E tests

---

## CI/CD Requirements

- All workflows use Nix for consistent environments across local development and CI/CD.
- Single script CI/CD initialization for all required auth.
- Infrastructure as code.
- Infrastucture hosted on GCP.
- Tests must run locally and in CI.
- Run tests on push.
- Run infrastructure as code, deployment, and deployment validation on push to main.
- If deployment validation fails, automated rollback.
- Manual health checks (scheduled checks disabled by default).
- CI completes < 15 minutes.

## Code Standards

### HTML
- Use semantic HTML5 elements
- Include proper accessibility attributes
- Keep markup clean and readable

### CSS
- Follow BEM naming where appropriate
- Use CSS custom properties (variables)
- Mobile-first responsive design
- Keep selectors specific but not complex

### JavaScript
- Use modern ES6+ syntax
- Write clear, self-documenting code
- Add comments for complex logic
- Avoid global variables

---

## CI/CD Pipeline

The repository uses GitHub Actions workflows that ensure code quality and safe deployments.

### Workflow Pattern

```
Push to any branch
    └─> CI workflow runs
        ├─> Build & Test
        └─> Lint Check

Push to main
    └─> CI workflow runs
         └─> (on success) IAC workflow runs
              └─> (on success) Concurrently:
                   ├─> Deploy to GCP
                   │    ├─> Verify CI succeeded
                   │    ├─> Build site
                   │    ├─> Deploy to Cloud Storage
                   │    ├─> Test deployed site
                   │    └─> (on failure) Rollback to previous version
                   │
                   └─> Deploy Playwright Server (only if playwright-server/ changed)
                        ├─> Build Docker image
                        ├─> Deploy to Cloud Run
                        └─> Test deployment
```

### Workflows

- **CI - Test Suite** (`.github/workflows/ci.yml`)
  - Runs on every push to any branch
  - Builds site, runs Playwright tests, and lints code
  - Must succeed before deployment can proceed

- **Infrastructure as Code** (`.github/workflows/infrastructure.yml`)
  - Runs on push to main (after CI succeeds)
  - Manages GCP infrastructure via Terraform
  - Creates/updates buckets, CDN, static IP, etc.

- **Deploy to GCP** (`.github/workflows/deploy.yml`)
  - Triggers after IAC workflow completes
  - Verifies CI also succeeded before deploying
  - Deploys site to Cloud Storage
  - Runs deployment tests
  - Automatically rolls back on test failure

- **Deploy Playwright Server** (`.github/workflows/deploy-playwright-server.yml`)
  - Triggers after IAC workflow completes
  - Only runs if `playwright-server/` directory has changes
  - Builds and deploys containerized Playwright server to Cloud Run

- **Health Check** (`.github/workflows/health-check.yml`)
  - Manual trigger only (scheduled checks disabled)
  - Runs deployment tests against production site
  - Creates issue on failure

### Deployment Safety

- **Prerequisite verification**: Deploy only runs if both CI and IAC succeed
- **No duplicate runs**: Deploy triggers once per commit (after IAC completes)
- **Automated rollback**: On test failure, automatically restores previous version
- **Conditional deploys**: Playwright server only deploys when relevant files change

---

## Cost

Optimize infrastructure for cost.

### Estimated Monthly Cost (Per Site)

| Service | Cost | Notes |
|---------|------|-------|
| Cloud Run (scale-to-zero) | ~$0.10/month | Minimal idle time, fast cold starts |
| Artifact Registry Storage | ~$0.05/month | Docker images with cleanup policies |
| Cloud Run Requests | ~$0.03/month | 1000 requests |
| Egress | ~$0.02/month | 1GB outbound traffic |
| **Total per site** | **~$0.20/month** | With moderate traffic |
| **Two sites (current)** | **~$0.40/month** | Fellspiral + Video Browser |

### Cost Optimization Features

- **Scale to zero**: Cloud Run instances shut down when not in use
- **Image cleanup**: Automatic deletion of old Docker images (keep 10 production, 3 preview)
- **Fast cold starts**: ~2-3 second startup with nginx alpine (~5MB images)
- **Efficient caching**: nginx handles gzip compression and cache headers
- **Managed SSL**: Free HTTPS certificates included
- **No load balancer costs**: Cloud Run includes global load balancing
