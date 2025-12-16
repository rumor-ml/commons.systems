package streaming

import (
	"log"
	"runtime/debug"
	"strings"
)

// Panic Recovery Strategy
//
// This package handles panics that occur during concurrent operations in the streaming system.
// The strategy distinguishes between expected shutdown-related panics (which are suppressed)
// and unexpected panics (which are re-raised for proper error handling).
//
// Components and their panic patterns:
//
// 1. SessionBroadcaster (broadcaster.go):
//    - Recovers from "send on closed channel" when clients disconnect during broadcast
//    - This is normal when client channels are closed while broadcaster is sending events
//    - Panic occurs in broadcast() method when iterating over clients
//
// 2. StreamMerger (merger.go):
//    - Recovers from "send on closed channel" in Firestore subscription callbacks
//    - Callbacks may attempt to send after m.done channel is closed
//    - Also handles "close of closed channel" if cleanup happens twice
//
// 3. Progress Forwarder (merger.go):
//    - Recovers from "send on closed channel" when progressCh is closed during forwarding
//    - Normal during context cancellation or pipeline completion
//
// 4. Network Operations (SSE, HTTP):
//    - Recovers from "write: broken pipe" when client disconnects mid-response
//    - Recovers from "use of closed network connection" during shutdown
//    - These are normal when clients navigate away or close connections
//
// Expected vs Unexpected Panics:
// - Expected: Shutdown-related race conditions (see expectedPanicPatterns)
// - Unexpected: Logic errors, nil pointer dereferences, array out of bounds
//
// Error Handling Flow:
// 1. All panics are logged with full stack traces
// 2. Expected panics are suppressed (logged as INFO)
// 3. Unexpected panics are re-raised for HTTP 500 responses

// expectedPanicPatterns lists panic message patterns that are expected during normal shutdown.
// These represent race conditions between goroutines terminating and attempting channel operations.
var expectedPanicPatterns = []string{
	"send on closed channel",         // Sending to closed client/progress/event channel
	"close of closed channel",        // Double-close during cleanup
	"write: broken pipe",             // Client disconnected during SSE write
	"use of closed network connection", // Network connection closed during operation
}

// IsExpectedPanic checks if a panic is an expected shutdown-related race condition.
// These panics occur during normal shutdown when goroutines are terminating concurrently.
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

	// Check against all expected panic patterns
	for _, pattern := range expectedPanicPatterns {
		if strings.Contains(panicMsg, pattern) {
			return true
		}
	}

	return false
}

// HandlePanic logs panics and re-panics unexpected ones to let HTTP recovery middleware handle them.
// This ensures unexpected errors return HTTP 500 to users instead of being silently suppressed.
//
// Expected panics (shutdown-related races) are logged and suppressed.
// Unexpected panics are logged with stack traces and re-raised for proper error handling.
//
// Use /sandbox to manage panic suppression patterns if needed.
func HandlePanic(r interface{}, context string) {
	if r == nil {
		return
	}

	// Log all panics with stack trace for debugging
	log.Printf("PANIC recovered in %s: %v\n%s", context, r, debug.Stack())

	// If it's an expected shutdown-related panic, log as INFO and suppress
	if IsExpectedPanic(r) {
		log.Printf("INFO: Expected shutdown panic in %s - this is normal during concurrent cleanup: %v", context, r)
		return
	}

	// For unexpected panics, always re-panic to let HTTP recovery middleware handle them
	// This ensures users get proper HTTP 500 errors instead of silent failures
	log.Printf("FATAL: Unexpected panic in %s - re-panicking to allow proper error handling", context)
	panic(r)
}
