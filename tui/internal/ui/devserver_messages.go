// devserver_messages.go - Messages for dev server UI updates

package ui

import (
	"github.com/natb1/tui/internal/devserver"
)

// DevServerStatusUpdateMsg is sent when dev server status changes
type DevServerStatusUpdateMsg struct {
	Status devserver.StatusInfo
}

// DevServerRestartMsg triggers a dev server restart
type DevServerRestartMsg struct{}

// DevServerSetPathMsg sets a new path for the dev server
type DevServerSetPathMsg struct {
	Path string
}

// ActivatePathInputMsg activates path input mode
type ActivatePathInputMsg struct{}