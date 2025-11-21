# Video Browser

A web application for browsing and playing videos stored in Firebase Storage (backed by Google Cloud Storage).

## Features

- 📁 Browse videos from Firebase Storage bucket
- ▶️ HTML5 video player with native controls
- 🔍 Search and filter videos
- ⌨️ Keyboard shortcuts for navigation
- 📱 Responsive design (mobile & desktop)
- 🔒 Private bucket access via Firebase signed URLs

## Architecture

The application uses **Firebase Storage** to serve videos from a private GCS bucket:

```
User Browser → Firebase SDK (client-side)
                    ↓
            Firebase Storage API
                    ↓
            Auto-generated signed URLs
                    ↓
            Private GCS bucket (rml-media)
```

**Why Firebase Storage?**
- ✅ No backend API required
- ✅ Automatic signed URL generation
- ✅ Client-side access control via security rules
- ✅ Built on GCS but with simpler SDK
- ✅ Videos served directly from GCS (efficient)

## Setup

### Automated Setup (Recommended)

Firebase configuration and storage rules are **automatically deployed** via CI/CD. No manual setup required!

**Prerequisites:**
1. Run `python3 setup.py` at the repository root (enables Firebase APIs)
2. Ensure the `rml-media` GCS bucket exists with videos in `video/` directory

**How it works:**
- The deployment workflow automatically:
  1. Fetches Firebase configuration from GCP
  2. Injects it into `firebase-config.js` during build
  3. Deploys Firebase Storage security rules
  4. Builds and deploys the application

See [`scripts/README.md`](../scripts/README.md) for details on the automation scripts.

### Manual Setup (Development Only)

For local development, inject the Firebase config once:

```bash
# From repository root
./scripts/inject-firebase-config.sh videobrowser/site/src/firebase-config.js
./scripts/deploy-firebase-storage-rules.sh videobrowser/storage.rules rml-media
```

### Firebase Console Setup (One-time)

If Firebase is not yet enabled on your GCP project:

1. Go to https://console.firebase.google.com/
2. Click "Add project"
3. Select your existing GCP project (`chalanding`)
4. Follow the setup wizard

Alternatively, the `setup.py` script enables required APIs automatically:
```bash
python3 setup.py  # Enables firebase.googleapis.com and related APIs
```

### Storage Security Rules

Rules are defined in `storage.rules` and deployed automatically:

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /video/{allPaths=**} {
      allow read: if true;  // Public read access
      allow write: if false; // No public writes
    }
  }
}
```

**Deployment:** Automatic via CI/CD workflow (no Firebase CLI needed)

## Development

### Install Dependencies

```bash
cd site
npm install
```

### Run Development Server

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
npm run build
```

Output will be in `site/dist/` directory.

## Deployment

The application is deployed to **Google Cloud Run** via GitHub Actions:

### Workflows

- **CI**: `.github/workflows/ci-videobrowser.yml` - Runs tests on every push
- **Production**: `.github/workflows/deploy-videobrowser.yml` - Deploys to Cloud Run
- **Feature Branches**: `.github/workflows/deploy-feature-branch-videobrowser.yml` - Preview deployments

### Cloud Run Configuration

- **Service**: `videobrowser-site`
- **Region**: `us-central1`
- **Container**: Nginx serving static files
- **Port**: 8080

### Deployment Process

1. Push to branch
2. CI workflow builds and tests
3. Docker image built and pushed to Artifact Registry
4. Cloud Run service updated with new image

## Project Structure

```
videobrowser/
├── site/                      # Frontend application
│   ├── src/
│   │   ├── index.html        # Main HTML page
│   │   ├── scripts/
│   │   │   └── main.js       # Main application logic (Firebase SDK)
│   │   ├── styles/
│   │   │   └── main.css      # Styling
│   │   └── firebase-config.js # Firebase configuration
│   ├── package.json          # Dependencies (includes Firebase)
│   ├── vite.config.js        # Build configuration
│   ├── Dockerfile            # Production container
│   └── nginx.conf            # Nginx configuration
├── tests/
│   └── e2e/
│       └── homepage.spec.js  # Playwright E2E tests
├── firebase.json             # Firebase configuration
├── .firebaserc               # Firebase project settings
├── storage.rules             # Firebase Storage security rules
└── README.md                 # This file
```

## How It Works

### Video Loading Process

1. **Initialize Firebase**: App initializes Firebase SDK with project config
2. **List Videos**: `listAll()` gets all items in `video/` directory
3. **Get Metadata**: For each video, fetch size, updated date, content type
4. **Generate URLs**: Firebase automatically generates signed URLs via `getDownloadURL()`
5. **Display**: Videos shown in list with metadata
6. **Play**: Clicking a video loads the signed URL into the HTML5 player

### Signed URLs

Firebase Storage automatically generates time-limited signed URLs that allow access to private bucket files:

- **Validity**: URLs typically valid for ~1 hour
- **Automatic**: No backend code needed
- **Secure**: Can't access files without valid signature
- **Direct**: Videos stream directly from GCS (not through Firebase)

### Key Code Snippets

**Listing videos:**
```javascript
const videosRef = ref(storage, 'video/');
const result = await listAll(videosRef);
```

**Getting signed URL:**
```javascript
const downloadUrl = await getDownloadURL(itemRef);
videoElement.src = downloadUrl;
```

## Keyboard Shortcuts

- **Space**: Play/pause video
- **Left/Right Arrow**: Skip backward/forward 5 seconds
- **Up/Down Arrow**: Navigate video list

## Troubleshooting

### "Failed to load videos" Error

1. **Check Firebase config**: Ensure `firebase-config.js` has correct values
2. **Verify bucket**: Confirm `rml-media` bucket exists in GCP
3. **Check rules**: Run `firebase deploy --only storage` to update rules
4. **Browser console**: Check for specific error messages

### Videos not playing

1. **Check bucket path**: Videos must be in `video/` directory
2. **Verify permissions**: Storage rules must allow read access
3. **File format**: Ensure videos are in supported format (.mp4, .webm, etc.)

### CORS errors

Firebase Storage handles CORS automatically. If you see CORS errors, check:
1. Firebase is properly initialized
2. Bucket name matches in config
3. Browser is not blocking third-party cookies

## Migration from Public GCS

This application was migrated from direct public GCS API access to Firebase Storage with automated configuration:

**Before:**
- Direct calls to `storage.googleapis.com/storage/v1/b/...`
- Required public bucket access
- URLs: `https://storage.googleapis.com/rml-media/video/...`
- Manual configuration management

**After:**
- Firebase SDK client-side calls
- Private bucket with security rules
- Automatic signed URL generation
- No backend required
- **Fully automated** Firebase config injection via CI/CD
- **Automated** security rules deployment

**Infrastructure as Code:**
- Firebase configuration fetched programmatically via GCP APIs
- Storage rules deployed via Firebase Management API
- No Firebase CLI required in CI/CD
- See `scripts/` directory for automation details

## License

Part of the commons.systems monorepo.
