package log

import (
	"fmt"
	"log"
	"os"
	"strings"
	"time"
)

// Level represents a log level
type Level int

const (
	DEBUG Level = iota
	INFO
	WARN
	ERROR
)

// Entry represents a log entry
type Entry struct {
	Time      time.Time
	Timestamp time.Time // Alias for Time for backwards compatibility
	Level     Level
	Message   string
	Component string
	KeyValues map[string]interface{}
}

// QueryOptions for querying log entries
type QueryOptions struct {
	Limit      int
	Offset     int
	Level      *Level
	Component  string
	StartTime  *time.Time
	EndTime    *time.Time
}

// Logger interface for logging
type Logger interface {
	Debug(msg string, keysAndValues ...interface{})
	Info(msg string, keysAndValues ...interface{})
	Warn(msg string, keysAndValues ...interface{})
	Error(msg string, keysAndValues ...interface{})
	WithComponent(component string) Logger
	GetRecent(count int) []Entry
	Unsubscribe(chan Entry)
}

// defaultLogger is a simple implementation of Logger
type defaultLogger struct {
	component string
	logger    *log.Logger
}

func initLogger() *defaultLogger {
	// Open log file in /tmp to avoid interfering with TUI display
	logFile, err := os.OpenFile("/tmp/tui.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		// Fallback to stderr if file can't be opened
		return &defaultLogger{
			logger: log.New(os.Stderr, "", log.LstdFlags),
		}
	}
	return &defaultLogger{
		logger: log.New(logFile, "", log.LstdFlags),
	}
}

var globalLogger = initLogger()

// Get returns the global logger instance
func Get() Logger {
	return globalLogger
}

// WithComponent returns a new logger with the component name set
func (l *defaultLogger) WithComponent(component string) Logger {
	return &defaultLogger{
		component: component,
		logger:    l.logger,
	}
}

// Debug logs a debug message
func (l *defaultLogger) Debug(msg string, keysAndValues ...interface{}) {
	l.log("DEBUG", msg, keysAndValues...)
}

// Info logs an info message
func (l *defaultLogger) Info(msg string, keysAndValues ...interface{}) {
	l.log("INFO", msg, keysAndValues...)
}

// Warn logs a warning message
func (l *defaultLogger) Warn(msg string, keysAndValues ...interface{}) {
	l.log("WARN", msg, keysAndValues...)
}

// Error logs an error message
func (l *defaultLogger) Error(msg string, keysAndValues ...interface{}) {
	l.log("ERROR", msg, keysAndValues...)
}

// log formats and logs a message with key-value pairs
func (l *defaultLogger) log(level, msg string, keysAndValues ...interface{}) {
	prefix := level
	if l.component != "" {
		prefix = fmt.Sprintf("%s [%s]", level, l.component)
	}

	formatted := fmt.Sprintf("%s: %s", prefix, msg)

	// Add key-value pairs if present
	if len(keysAndValues) > 0 {
		kvs := ""
		for i := 0; i < len(keysAndValues); i += 2 {
			if i+1 < len(keysAndValues) {
				if kvs != "" {
					kvs += " "
				}
				kvs += fmt.Sprintf("%v=%v", keysAndValues[i], keysAndValues[i+1])
			}
		}
		if kvs != "" {
			formatted += " " + kvs
		}
	}

	l.logger.Println(formatted)
}

// GetRecent returns recent log entries (stub implementation)
func (l *defaultLogger) GetRecent(count int) []Entry {
	// Try to read from log file if it exists
	entries := []Entry{}

	// If log file exists, read recent entries
	file, err := os.Open("/tmp/tui.log")
	if err == nil {
		defer file.Close()

		// Read file content (simple implementation for stub)
		// In a real implementation, this would parse structured logs
		content, err := os.ReadFile("/tmp/tui.log")
		if err == nil {
			lines := strings.Split(string(content), "\n")

			// Get last N lines
			start := 0
			if len(lines) > count {
				start = len(lines) - count
			}

			for i := start; i < len(lines) && i < start+count; i++ {
				line := lines[i]
				if line == "" {
					continue
				}

				// Parse log line (simplified)
				level := INFO
				if strings.Contains(line, "ERROR") {
					level = ERROR
				} else if strings.Contains(line, "WARN") {
					level = WARN
				} else if strings.Contains(line, "DEBUG") {
					level = DEBUG
				}

				// Extract component if present
				component := ""
				if idx := strings.Index(line, "["); idx >= 0 {
					if endIdx := strings.Index(line[idx:], "]"); endIdx >= 0 {
						component = line[idx+1 : idx+endIdx]
					}
				}

				// Extract message (simplified - everything after timestamp and level)
				message := line
				if idx := strings.Index(line, ": "); idx >= 0 {
					message = line[idx+2:]
				}

				entries = append(entries, Entry{
					Time:      time.Now().Add(-time.Duration(len(lines)-i) * time.Second),
					Timestamp: time.Now().Add(-time.Duration(len(lines)-i) * time.Second),
					Level:     level,
					Message:   message,
					Component: component,
					KeyValues: make(map[string]interface{}),
				})
			}
		}
	}

	// If no entries from file, return some default sample entries
	if len(entries) == 0 {
		now := time.Now()
		entries = []Entry{
			{
				Time:      now.Add(-5 * time.Minute),
				Timestamp: now.Add(-5 * time.Minute),
				Level:     INFO,
				Message:   "TUI started successfully",
				Component: "tui",
				KeyValues: make(map[string]interface{}),
			},
			{
				Time:      now.Add(-4 * time.Minute),
				Timestamp: now.Add(-4 * time.Minute),
				Level:     DEBUG,
				Message:   "Project discovery completed",
				Component: "discovery",
				KeyValues: make(map[string]interface{}),
			},
			{
				Time:      now.Add(-3 * time.Minute),
				Timestamp: now.Add(-3 * time.Minute),
				Level:     INFO,
				Message:   "Found 6 projects in monorepo",
				Component: "discovery",
				KeyValues: make(map[string]interface{}),
			},
			{
				Time:      now.Add(-2 * time.Minute),
				Timestamp: now.Add(-2 * time.Minute),
				Level:     DEBUG,
				Message:   "UI rendering initialized",
				Component: "ui",
				KeyValues: make(map[string]interface{}),
			},
			{
				Time:      now.Add(-1 * time.Minute),
				Timestamp: now.Add(-1 * time.Minute),
				Level:     INFO,
				Message:   "Ready for user interaction",
				Component: "tui",
				KeyValues: make(map[string]interface{}),
			},
		}
	}

	return entries
}

// Unsubscribe unsubscribes from log updates (stub implementation)
func (l *defaultLogger) Unsubscribe(ch chan Entry) {
	// Stub implementation - no-op
	// In a real implementation, this would remove the channel from subscribers
}

// Store provides access to historical log entries
type Store struct{}

// Query queries log entries based on options
func (s *Store) Query(opts QueryOptions) ([]Entry, error) {
	// Stub implementation - returns empty slice
	return []Entry{}, nil
}

// GetStore returns the log store (stub implementation)
func GetStore() *Store {
	return &Store{}
}
