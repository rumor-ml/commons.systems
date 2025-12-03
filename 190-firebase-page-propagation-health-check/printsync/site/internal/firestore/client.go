package firestore

import (
	"context"

	"cloud.google.com/go/firestore"
)

type Client struct {
	*firestore.Client
}

func NewClient(ctx context.Context, projectID string) (*Client, error) {
	client, err := firestore.NewClient(ctx, projectID)
	if err != nil {
		return nil, err
	}

	return &Client{Client: client}, nil
}
