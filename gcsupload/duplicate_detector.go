package gcsupload

import (
	"context"
	"fmt"

	"cloud.google.com/go/firestore"
	"google.golang.org/api/iterator"
)

// FirestoreDuplicateDetector checks for duplicates using Firestore metadata
type FirestoreDuplicateDetector struct {
	client         *firestore.Client
	metadataFields []string // Fields to use for duplicate detection
}

// NewFirestoreDuplicateDetector creates a new Firestore-based duplicate detector
func NewFirestoreDuplicateDetector(client *firestore.Client, metadataFields []string) *FirestoreDuplicateDetector {
	return &FirestoreDuplicateDetector{
		client:         client,
		metadataFields: metadataFields,
	}
}

// IsDuplicate checks if a file with matching metadata already exists
func (d *FirestoreDuplicateDetector) IsDuplicate(ctx context.Context, metadata map[string]interface{}) (bool, error) {
	// Build query based on metadata fields
	query := d.client.CollectionGroup("files")

	for _, field := range d.metadataFields {
		if val, ok := metadata[field]; ok {
			metadataField := fmt.Sprintf("metadata.%s", field)
			query = query.Where(metadataField, "==", val)
		}
	}

	// Limit to one result since we only care if any exist
	query = query.Limit(1)

	iter := query.Documents(ctx)
	defer iter.Stop()

	_, err := iter.Next()
	if err == iterator.Done {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("failed to query for duplicates: %w", err)
	}

	return true, nil
}
