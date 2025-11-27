package tmux

import (
	"sync"
	"time"
)

// cacheEntry represents a cached result with expiration
type cacheEntry struct {
	isClaudePane bool
	expiresAt    time.Time
}

// ClaudePaneCache caches expensive process detection with TTL to prevent blinking
type ClaudePaneCache struct {
	mu    sync.RWMutex
	cache map[string]cacheEntry
	ttl   time.Duration
}

// NewClaudePaneCache creates a new cache with the specified TTL
func NewClaudePaneCache(ttl time.Duration) *ClaudePaneCache {
	if ttl <= 0 {
		panic("ClaudePaneCache: ttl must be positive")
	}
	return &ClaudePaneCache{
		cache: make(map[string]cacheEntry),
		ttl:   ttl,
	}
}

// Get retrieves a cached value if it exists and hasn't expired
// Returns (value, found). If found=false, the value should not be used.
func (c *ClaudePaneCache) Get(panePID string) (bool, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()

	entry, exists := c.cache[panePID]
	if !exists {
		return false, false
	}

	// Check if expired
	if time.Now().After(entry.expiresAt) {
		// Expired entries remain in cache until CleanupExcept() is called.
		// This keeps Get() lock-free and fast, trading memory for performance.
		// Cleanup is guaranteed at each GetTree() call via CleanupExcept().
		return false, false
	}

	return entry.isClaudePane, true
}

// Set stores a value in the cache with TTL
func (c *ClaudePaneCache) Set(panePID string, isClaudePane bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.cache[panePID] = cacheEntry{
		isClaudePane: isClaudePane,
		expiresAt:    time.Now().Add(c.ttl),
	}
}

// Invalidate removes a specific entry from the cache
func (c *ClaudePaneCache) Invalidate(panePID string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	delete(c.cache, panePID)
}

// Cleanup removes all expired entries from the cache
// This should be called periodically to prevent unbounded growth
func (c *ClaudePaneCache) Cleanup() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for pid, entry := range c.cache {
		if now.After(entry.expiresAt) {
			delete(c.cache, pid)
		}
	}
}

// CleanupExcept removes entries not in the provided set of valid PIDs
// This is useful for cleaning up cache entries for panes that no longer exist
func (c *ClaudePaneCache) CleanupExcept(validPIDs map[string]bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	for pid := range c.cache {
		if !validPIDs[pid] {
			delete(c.cache, pid)
		}
	}
}

// Size returns the current number of entries in the cache (for testing/debugging)
func (c *ClaudePaneCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()

	return len(c.cache)
}
