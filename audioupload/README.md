# Audio Upload Manager

A web application for uploading and organizing audio files to Google Cloud Storage with automatic metadata extraction and duplicate detection.

## Features

- **Audio File Discovery**: Automatically finds audio files (.mp3, .flac, .m4a, .wav, .ogg, .aac, .wma)
- **Metadata Extraction**: Reads ID3 tags from audio files
- **MusicBrainz Integration**: (Planned) Fingerprint audio and fetch metadata from MusicBrainz
- **Normalized Paths**: Organizes files in GCS as `artist/album/track - title.ext`
- **Duplicate Detection**: Skips files that already exist based on metadata
- **Real-time Monitoring**: Track upload progress with live updates
- **Trash Management**: Move uploaded/skipped files to trash

## Architecture

### Backend (Go)

- **HTTP API**: RESTful API for job management
- **GCS Upload**: Uses the `gcsupload` library for upload orchestration
- **Audio Processing**: Custom implementations of discovery, metadata extraction, and normalization

**Key Files**:
- `backend/cmd/server/main.go` - HTTP server and API endpoints
- `backend/internal/audio/discovery.go` - Audio file discovery
- `backend/internal/audio/metadata.go` - ID3 tag extraction and MusicBrainz integration
- `backend/internal/audio/normalizer.go` - Path normalization

### Frontend (JavaScript/Vite)

- **Vite**: Modern build tool for fast development
- **Shared Components**: Reusable upload UI components from `/shared-components`
- **Real-time Updates**: Polls API for job and file status updates

**Key Files**:
- `site/index.html` - Main page
- `site/src/scripts/main.js` - Application logic
- `site/src/styles/main.css` - Custom styles

## API Endpoints

### Jobs

- `POST /api/jobs` - Create and start a new upload job
  ```json
  {
    "name": "My Audio Upload",
    "basePath": "/path/to/audio/files",
    "gcsBasePath": "audio-uploads"
  }
  ```

- `GET /api/jobs/{id}` - Get job details
- `GET /api/jobs/{id}/files` - Get all files for a job
- `POST /api/jobs/{id}/cancel` - Cancel a running job
- `POST /api/jobs/{id}/trash` - Move uploaded/skipped files to trash

### Health

- `GET /health` - Health check endpoint

## Development

### Prerequisites

- Go 1.21+
- Node.js 20+
- npm
- GCP project with Firestore and Cloud Storage enabled

### Backend Setup

```bash
cd audioupload/backend

# Set environment variables
export GCP_PROJECT_ID=your-project-id
export GCS_BUCKET=your-bucket-name
export PORT=8080

# Run the server
go run cmd/server/main.go
```

### Frontend Setup

```bash
cd audioupload/site

# Install dependencies
npm install

# Run dev server (proxies API to localhost:8080)
npm run dev

# Build for production
npm run build
```

### Running with Docker

```bash
# From repository root
docker build -f audioupload/Dockerfile -t audioupload .

docker run -p 8080:8080 \
  -e GCP_PROJECT_ID=your-project-id \
  -e GCS_BUCKET=your-bucket-name \
  -e GOOGLE_APPLICATION_CREDENTIALS=/path/to/credentials.json \
  -v /path/to/credentials.json:/path/to/credentials.json \
  audioupload
```

## Deployment

The site is automatically deployed to Cloud Run on push to main via GitHub Actions.

Manual deployment:
1. Go to Actions → "Manual Deploy - Audioupload"
2. Select branch
3. Click "Run workflow"

The workflow:
1. Runs local tests (build, lint)
2. Builds Docker image (Go backend + Vite frontend)
3. Deploys to Cloud Run
4. Runs Playwright tests against deployed site

## Environment Variables

- `GCP_PROJECT_ID` - Google Cloud project ID (required)
- `GCS_BUCKET` - GCS bucket for uploads (required)
- `PORT` - HTTP server port (default: 8080)
- `GOOGLE_APPLICATION_CREDENTIALS` - Path to service account JSON (for local dev)

## Testing

```bash
# Frontend tests
cd audioupload/tests
npm test

# Deployed tests
npm run test:deployed
```

## Shared Components

This site uses shared upload components from `/shared-components/upload`:

- **UploadJobStarter** - Form for creating upload jobs
- **UploadJobMonitor** - Real-time progress monitoring with file table
- **UploadJobControls** - Job control actions (cancel, trash)

These components can be reused in other sites that need upload functionality.

## Future Enhancements

- [ ] Complete MusicBrainz fingerprinting integration
- [ ] ID3 tag writing after MusicBrainz lookup
- [ ] Batch job creation (multiple directories)
- [ ] Advanced filtering and search in job monitor
- [ ] Email notifications on job completion
- [ ] S3-compatible storage support

## License

MIT
