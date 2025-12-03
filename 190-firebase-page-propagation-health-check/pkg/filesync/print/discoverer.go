package print

import "github.com/commons-systems/filesync"

// DefaultExtensions for print media
var DefaultExtensions = []string{".pdf", ".epub", ".cbz", ".cbr"}

// Discoverer discovers print media files
type Discoverer struct {
	*filesync.ExtensionDiscoverer
}

// NewDiscoverer creates a print discoverer with default extensions
func NewDiscoverer(opts ...filesync.DiscoveryOption) *Discoverer {
	// Prepend default options, allow override
	defaultOpts := []filesync.DiscoveryOption{
		filesync.WithExtensions(DefaultExtensions...),
		filesync.WithSkipHidden(true),
		filesync.WithComputeHash(true),
	}
	return &Discoverer{
		ExtensionDiscoverer: filesync.NewExtensionDiscoverer(append(defaultOpts, opts...)...),
	}
}
