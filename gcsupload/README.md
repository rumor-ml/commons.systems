# GCS Upload Library

A Go library for managing file upload jobs to Google Cloud Storage with Firestore metadata storage and real-time progress tracking.

## Features

- **Abstract Interfaces**: Pluggable file discovery, metadata extraction, and path normalization
- **GCS Upload**: Efficient file uploads with progress tracking
- **Firestore Integration**: Job and file metadata storage for monitoring and querying
- **Duplicate Detection**: Avoid re-uploading files based on metadata fingerprints
- **Trash Management**: Move uploaded/skipped files to trash
- **Real-time Monitoring**: Track upload progress via Firestore queries

## Architecture

### Core Interfaces

The library provides several interfaces that you implement for your specific use case:

```go
// FileDiscoverer discovers files at a given path
type FileDiscoverer interface {
    Discover(ctx context.Context, basePath string) ([]string, error)
}

// MetadataExtractor extracts metadata from a file
type MetadataExtractor interface {
    Extract(ctx context.Context, filePath string) (metadata map[string]interface{}, logs []string, err error)
}

// PathNormalizer generates a normalized GCS path from file metadata
type PathNormalizer interface {
    Normalize(metadata map[string]interface{}, fileName string) (string, error)
}

// DuplicateDetector checks if a file already exists
type DuplicateDetector interface {
    IsDuplicate(ctx context.Context, metadata map[string]interface{}) (bool, error)
}
```

### Job Manager

The `JobManager` orchestrates the upload process:

1. **Create Job**: Initialize a new upload job in Firestore
2. **Discover Files**: Use `FileDiscoverer` to find files
3. **Process Each File**:
   - Extract metadata via `MetadataExtractor`
   - Check for duplicates via `DuplicateDetector`
   - Generate normalized path via `PathNormalizer`
   - Upload to GCS with progress tracking
   - Save metadata to Firestore
4. **Track Progress**: Real-time updates in Firestore for monitoring

## Usage

### Basic Example

```go
package main

import (
    "context"
    "github.com/rumor-ml/commons.systems/gcsupload"
)

func main() {
    ctx := context.Background()

    // Create job manager
    jobManager, err := gcsupload.NewJobManager(ctx, "your-project-id")
    if err != nil {
        panic(err)
    }
    defer jobManager.Close()

    // Create upload config
    config := &gcsupload.UploadConfig{
        JobName:           "My Upload Job",
        BasePath:          "/path/to/files",
        GCSBucket:         "my-bucket",
        GCSBasePath:       "uploads",
        FileDiscoverer:    myDiscoverer,
        MetadataExtractor: myExtractor,
        PathNormalizer:    myNormalizer,
        DuplicateDetector: myDetector,
    }

    // Create and start job
    job, err := jobManager.CreateJob(ctx, config)
    if err != nil {
        panic(err)
    }

    err = jobManager.StartJob(ctx, job.ID, config)
    if err != nil {
        panic(err)
    }

    // Monitor progress
    files, err := jobManager.GetJobFiles(ctx, job.ID)
    // ...
}
```

### Implementing Interfaces

See [audioupload/backend/internal/audio](../audioupload/backend/internal/audio) for a complete implementation example for audio files.

## Data Model

### UploadJob

Stored in Firestore collection `upload_jobs`:

```go
type UploadJob struct {
    ID             string          // Unique job ID
    Name           string          // User-friendly name
    BasePath       string          // Local path being uploaded
    GCSBucket      string          // Target GCS bucket
    GCSBasePath    string          // Base path in GCS
    Status         UploadJobStatus // pending, running, completed, cancelled, failed
    TotalFiles     int             // Total files discovered
    ProcessedFiles int             // Files processed so far
    UploadedFiles  int             // Successfully uploaded
    SkippedFiles   int             // Skipped (duplicates)
    FailedFiles    int             // Failed uploads
    CreatedAt      time.Time
    UpdatedAt      time.Time
    CompletedAt    *time.Time
}
```

### FileInfo

Stored in Firestore subcollection `upload_jobs/{jobId}/files`:

```go
type FileInfo struct {
    ID           string                 // Unique file ID
    LocalPath    string                 // Path on local filesystem
    FileName     string                 // File name
    FileSize     int64                  // Size in bytes
    Metadata     map[string]interface{} // Extracted metadata
    GCSPath      string                 // Uploaded GCS path
    Status       FileStatus             // discovered, processing, uploading, completed, skipped, failed
    Error        string                 // Error message if failed
    Logs         []string               // Processing logs
    Progress     float64                // Upload progress (0-100)
    DiscoveredAt time.Time
    UpdatedAt    time.Time
    CompletedAt  *time.Time
}
```

## Real-time Monitoring

Query Firestore to monitor job progress:

```javascript
// Listen to job updates
db.collection('upload_jobs').doc(jobId).onSnapshot(snapshot => {
  const job = snapshot.data();
  console.log(`Progress: ${job.processedFiles}/${job.totalFiles}`);
});

// Listen to file updates
db.collection('upload_jobs').doc(jobId).collection('files').onSnapshot(snapshot => {
  snapshot.docs.forEach(doc => {
    const file = doc.data();
    console.log(`${file.fileName}: ${file.status} (${file.progress}%)`);
  });
});
```

## Example Implementation: Audio Upload

The `audioupload` site provides a complete reference implementation:

- **AudioFileDiscoverer**: Discovers audio files (.mp3, .flac, .m4a, etc.)
- **MetadataExtractor**: Extracts ID3 tags, attempts MusicBrainz fingerprinting
- **PathNormalizer**: Organizes files as `artist/album/track - title.ext`
- **HTTP API**: Exposes RESTful endpoints for job management
- **Frontend**: Real-time monitoring with shared components

See `/audioupload` for the full implementation.

## Dependencies

- `cloud.google.com/go/firestore` - Firestore client
- `cloud.google.com/go/storage` - GCS client
- `github.com/google/uuid` - UUID generation

## License

MIT
