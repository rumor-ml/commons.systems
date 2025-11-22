package log

import (
	"fmt"
	"log"
	"os"
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
	// Stub implementation - returns empty slice
	return []Entry{}
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
