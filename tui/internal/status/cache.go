// cache.go - Status data caching system
//
// ## Metadata
//
// TUI status caching system for performance optimization.
//
// ### Purpose
//
// Provide intelligent caching of status data to minimize filesystem and network overhead
// while maintaining real-time status accuracy for time-sensitive information and
// operational metrics across the status aggregation system.
//
// ### Instructions
//
// #### Cache Management
//
// ##### TTL-Based Expiration
//
// Implement time-to-live based cache expiration to ensure status data remains fresh
// while reducing redundant status collection operations from multiple sources.
//
// ##### Thread-Safe Operations
//
// Provide thread-safe cache operations with read-write locking to support concurrent
// access from multiple status collection goroutines and UI rendering operations.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing status reporting patterns that inform cache structure
// and expiration strategies for consistent performance optimization.

package status

import (
	"sync"
	"time"
)

// StatusCache manages cached status data
type StatusCache struct {
	data  map[string]*CachedStatus
	mutex sync.RWMutex
	ttl   time.Duration
}

// CachedStatus represents cached status with expiration
type CachedStatus struct {
	data      *StatusData
	timestamp time.Time
	ttl       time.Duration
}

// NewStatusCache creates a new status cache
func NewStatusCache(ttl time.Duration) *StatusCache {
	return &StatusCache{
		data: make(map[string]*CachedStatus),
		ttl:  ttl,
	}
}

// Set updates cached status data
func (c *StatusCache) Set(key string, data *StatusData) {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	c.data[key] = &CachedStatus{
		data:      data,
		timestamp: time.Now(),
		ttl:       c.ttl,
	}
}

// Get retrieves cached status data
func (c *StatusCache) Get(key string) (*StatusData, bool) {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	cached, exists := c.data[key]
	if !exists || cached.IsExpired() {
		return nil, false
	}

	return cached.data, true
}

// IsExpired checks if cached status has expired
func (cs *CachedStatus) IsExpired() bool {
	return time.Since(cs.timestamp) > cs.ttl
}

// Clear removes expired entries from the cache
func (c *StatusCache) Clear() {
	c.mutex.Lock()
	defer c.mutex.Unlock()

	for key, cached := range c.data {
		if cached.IsExpired() {
			delete(c.data, key)
		}
	}
}

// Size returns the number of cached entries
func (c *StatusCache) Size() int {
	c.mutex.RLock()
	defer c.mutex.RUnlock()

	return len(c.data)
}
