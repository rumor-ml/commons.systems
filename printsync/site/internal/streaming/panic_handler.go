package streaming

import (
	"log"
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

// HandlePanic logs panics and re-panics unexpected ones to let HTTP recovery middleware handle them.
// This ensures unexpected errors return HTTP 500 to users instead of being silently suppressed.
//
// Expected panics (like "send on closed channel") are logged and suppressed.
// Unexpected panics are logged with stack traces and re-raised for proper error handling.
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

	// For unexpected panics, always re-panic to let HTTP recovery middleware handle them
	log.Printf("FATAL: Unexpected panic in %s - re-panicking to allow proper error handling", context)
	panic(r)
}
