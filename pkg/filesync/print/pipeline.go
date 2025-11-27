package print

import (
	"context"

	"cloud.google.com/go/firestore"
	"cloud.google.com/go/storage"
	"github.com/commons-systems/filesync"
)

// NewPrintPipeline creates a complete print file sync pipeline with all components wired together
func NewPrintPipeline(
	ctx context.Context,
	gcsClient *storage.Client,
	firestoreClient *firestore.Client,
	bucket string,
	opts ...filesync.PipelineOption,
) (*filesync.Pipeline, error) {
	// Create discoverer (finds print media files)
	discoverer := NewDiscoverer()

	// Create metadata extractor (extracts metadata from PDFs, EPUBs, etc.)
	extractor := NewDefaultExtractor()

	// Create path normalizer (organizes files by author/title)
	normalizer := NewPathNormalizer()

	// Create uploader (uploads to GCS with deduplication)
	uploader := filesync.NewGCSUploader(
		gcsClient,
		firestoreClient,
		bucket,
		filesync.WithCollection("uploads"),
	)

	// Create session store (tracks sync sessions in Firestore)
	sessionStore := filesync.NewFirestoreSessionStore(firestoreClient)

	// Create file store (tracks individual file status in Firestore)
	fileStore := filesync.NewFirestoreFileStore(firestoreClient)

	// Create pipeline with all components
	pipeline, err := filesync.NewPipeline(
		discoverer,
		extractor,
		normalizer,
		uploader,
		sessionStore,
		fileStore,
		opts...,
	)
	if err != nil {
		return nil, err
	}

	return pipeline, nil
}
