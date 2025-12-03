package debug

import (
	"fmt"
	"os"
	"sync"
	"time"
)

const debugLogPath = "/tmp/claude/tui-debug.log"

var (
	// Debug logging enabled by default while investigating idle state detection issues.
	// Set TMUX_TUI_DEBUG=0 to disable.
	enabled = os.Getenv("TMUX_TUI_DEBUG") != "0"
	mu      sync.Mutex
)

func Log(format string, args ...interface{}) {
	if !enabled {
		return
	}
	mu.Lock()
	defer mu.Unlock()

	f, err := os.OpenFile(debugLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return
	}
	defer f.Close()

	timestamp := float64(time.Now().UnixNano()) / 1e9
	msg := fmt.Sprintf(format, args...)
	fmt.Fprintf(f, "[%.6f] %s\n", timestamp, msg)
}
