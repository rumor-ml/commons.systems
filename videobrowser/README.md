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

### Prerequisites

1. **Firebase Project**: The GCP project `chalanding` must have Firebase enabled
2. **Firebase CLI**: Install globally via `npm install -g firebase-tools`
3. **GCS Bucket**: The `rml-media` bucket must exist with videos in `video/` directory

### Initial Firebase Setup

```bash
# Navigate to videobrowser directory
cd videobrowser

# Login to Firebase
firebase login

# Link to your project
firebase use chalanding

# Deploy storage rules
firebase deploy --only storage
```

### Get Firebase Configuration

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select project `chalanding`
3. Go to **Project Settings** > **Your apps** > **Web app**
4. Copy the Firebase configuration
5. Update `site/src/firebase-config.js` with the real values:

```javascript
export const firebaseConfig = {
  apiKey: "YOUR_ACTUAL_API_KEY",
  authDomain: "chalanding.firebaseapp.com",
  projectId: "chalanding",
  storageBucket: "rml-media",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId: "YOUR_APP_ID"
};
```

### Storage Security Rules

The `storage.rules` file controls access to the bucket:

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

To update rules:
```bash
firebase deploy --only storage
```

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

This application was migrated from direct public GCS API access to Firebase Storage:

**Before:**
- Direct calls to `storage.googleapis.com/storage/v1/b/...`
- Required public bucket access
- URLs: `https://storage.googleapis.com/rml-media/video/...`

**After:**
- Firebase SDK client-side calls
- Private bucket with security rules
- Automatic signed URL generation
- No backend required

## License

Part of the commons.systems monorepo.
