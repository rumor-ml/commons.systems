package streaming

import (
	"log"
	"os"
	"runtime/debug"
	"strings"
)

// IsExpectedPanic checks if a panic is an expected "send on closed channel" race condition
// that can occur during normal shutdown when goroutines are terminating concurrently.
func IsExpectedPanic(r interface{}) bool {
	if r == nil {
		return false
	}

	panicMsg := ""
	switch v := r.(type) {
	case string:
		panicMsg = v
	case error:
		panicMsg = v.Error()
	default:
		panicMsg = ""
	}

	return strings.Contains(panicMsg, "send on closed channel")
}

// HandlePanic logs panics and re-panics unexpected ones in non-production environments.
// This helps catch bugs in development while preventing crashes in production.
//
// Expected panics (like "send on closed channel") are logged and suppressed.
// Unexpected panics are logged with stack traces and re-raised in development mode.
//
// Set GO_ENV=production to suppress re-panicking in production environments.
func HandlePanic(r interface{}, context string) {
	if r == nil {
		return
	}

	// Log all panics with stack trace
	log.Printf("PANIC recovered in %s: %v\n%s", context, r, debug.Stack())

	// If it's an expected panic (send on closed channel), just log and return
	if IsExpectedPanic(r) {
		log.Printf("INFO: Expected panic (send on closed channel) in %s - this is normal during shutdown", context)
		return
	}

	// For unexpected panics, re-panic in non-production to catch bugs early
	if os.Getenv("GO_ENV") != "production" {
		log.Printf("FATAL: Unexpected panic in %s - re-panicking in development mode to surface bug", context)
		panic(r)
	}

	log.Printf("ERROR: Unexpected panic in %s - suppressed in production mode", context)
}
