// discovery_types.go - Re-export discovery types for app package

package app

import "github.com/natb1/tui/pkg/discovery"

// Re-export types from pkg/discovery to maintain compatibility
type Project = discovery.Project
type ProjectMetadata = discovery.ProjectMetadata
type ProjectStatus = discovery.ProjectStatus
type ProjectDiscoveryCompleteMsg = discovery.ProjectDiscoveryCompleteMsg