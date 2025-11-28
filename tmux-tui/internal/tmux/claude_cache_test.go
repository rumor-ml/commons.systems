package tmux

import (
	"sync"
	"testing"
	"time"
)

// mustNewCache is a helper that creates a cache or fails the test
func mustNewCache(t *testing.T, ttl time.Duration) *ClaudePaneCache {
	t.Helper()
	cache, err := NewClaudePaneCache(ttl)
	if err != nil {
		t.Fatalf("Failed to create cache: %v", err)
	}
	return cache
}

func TestClaudePaneCache_HitMiss(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	// Cache miss
	_, found := cache.Get("1234")
	if found {
		t.Error("Expected cache miss, got hit")
	}

	// Set value
	cache.Set("1234", true)

	// Cache hit
	value, found := cache.Get("1234")
	if !found {
		t.Error("Expected cache hit, got miss")
	}
	if !value {
		t.Error("Expected value=true, got false")
	}

	// Set another value
	cache.Set("5678", false)

	// Cache hit for second value
	value, found = cache.Get("5678")
	if !found {
		t.Error("Expected cache hit for second value, got miss")
	}
	if value {
		t.Error("Expected value=false, got true")
	}

	// First value still in cache
	value, found = cache.Get("1234")
	if !found {
		t.Error("Expected first value still in cache")
	}
	if !value {
		t.Error("Expected first value=true, got false")
	}
}

func TestClaudePaneCache_TTLExpiration(t *testing.T) {
	cache := mustNewCache(t, 100*time.Millisecond)

	// Set value
	cache.Set("1234", true)

	// Immediate read should succeed
	value, found := cache.Get("1234")
	if !found {
		t.Error("Expected immediate cache hit")
	}
	if !value {
		t.Error("Expected value=true")
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Should be expired
	_, found = cache.Get("1234")
	if found {
		t.Error("Expected cache miss after TTL expiration")
	}
}

func TestClaudePaneCache_Concurrent(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)
	var wg sync.WaitGroup

	// Concurrent writes
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			panePID := string(rune('0' + (id % 10)))
			cache.Set(panePID, id%2 == 0)
		}(i)
	}

	// Concurrent reads
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			panePID := string(rune('0' + (id % 10)))
			cache.Get(panePID)
		}(i)
	}

	wg.Wait()

	// Verify cache is in valid state
	if cache.Size() > 10 {
		t.Errorf("Expected at most 10 entries, got %d", cache.Size())
	}
}

func TestClaudePaneCache_Invalidate(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	// Set values
	cache.Set("1234", true)
	cache.Set("5678", false)

	// Verify both exist
	if _, found := cache.Get("1234"); !found {
		t.Error("Expected 1234 to be in cache")
	}
	if _, found := cache.Get("5678"); !found {
		t.Error("Expected 5678 to be in cache")
	}

	// Invalidate one
	cache.Invalidate("1234")

	// Verify 1234 is gone
	if _, found := cache.Get("1234"); found {
		t.Error("Expected 1234 to be invalidated")
	}

	// Verify 5678 still exists
	if _, found := cache.Get("5678"); !found {
		t.Error("Expected 5678 to still be in cache")
	}

	// Invalidating non-existent entry should be safe
	cache.Invalidate("9999")
}

func TestClaudePaneCache_Cleanup(t *testing.T) {
	cache := mustNewCache(t, 100*time.Millisecond)

	// Add several entries
	cache.Set("1234", true)
	cache.Set("5678", false)
	cache.Set("9999", true)

	// Verify all exist
	if cache.Size() != 3 {
		t.Errorf("Expected 3 entries, got %d", cache.Size())
	}

	// Wait for expiration
	time.Sleep(150 * time.Millisecond)

	// Run cleanup
	cache.Cleanup()

	// Verify all expired entries removed
	if cache.Size() != 0 {
		t.Errorf("Expected 0 entries after cleanup, got %d", cache.Size())
	}
}

func TestClaudePaneCache_CleanupPartial(t *testing.T) {
	cache := mustNewCache(t, 100*time.Millisecond)

	// Add entries
	cache.Set("1234", true)
	cache.Set("5678", false)

	// Wait a bit
	time.Sleep(60 * time.Millisecond)

	// Add more entries (these won't expire yet)
	cache.Set("9999", true)

	// Wait for first batch to expire
	time.Sleep(60 * time.Millisecond)

	// Run cleanup
	cache.Cleanup()

	// First two should be expired, third should remain
	if cache.Size() != 1 {
		t.Errorf("Expected 1 entry after cleanup, got %d", cache.Size())
	}

	// Verify the right entry remains
	if _, found := cache.Get("9999"); !found {
		t.Error("Expected 9999 to still be in cache")
	}
}

func TestClaudePaneCache_CleanupExcept(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	// Add several entries
	cache.Set("1234", true)
	cache.Set("5678", false)
	cache.Set("9999", true)
	cache.Set("1111", false)

	// Verify all exist
	if cache.Size() != 4 {
		t.Errorf("Expected 4 entries, got %d", cache.Size())
	}

	// Keep only some PIDs
	validPIDs := map[string]bool{
		"1234": true,
		"9999": true,
	}

	cache.CleanupExcept(validPIDs)

	// Verify only valid PIDs remain
	if cache.Size() != 2 {
		t.Errorf("Expected 2 entries after CleanupExcept, got %d", cache.Size())
	}

	// Verify correct entries remain
	if _, found := cache.Get("1234"); !found {
		t.Error("Expected 1234 to remain")
	}
	if _, found := cache.Get("9999"); !found {
		t.Error("Expected 9999 to remain")
	}

	// Verify others are gone
	if _, found := cache.Get("5678"); found {
		t.Error("Expected 5678 to be removed")
	}
	if _, found := cache.Get("1111"); found {
		t.Error("Expected 1111 to be removed")
	}
}

func TestClaudePaneCache_Size(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	if cache.Size() != 0 {
		t.Errorf("Expected empty cache, got size %d", cache.Size())
	}

	cache.Set("1234", true)
	if cache.Size() != 1 {
		t.Errorf("Expected size 1, got %d", cache.Size())
	}

	cache.Set("5678", false)
	if cache.Size() != 2 {
		t.Errorf("Expected size 2, got %d", cache.Size())
	}

	// Setting same key shouldn't increase size
	cache.Set("1234", false)
	if cache.Size() != 2 {
		t.Errorf("Expected size 2 after updating existing key, got %d", cache.Size())
	}

	cache.Invalidate("1234")
	if cache.Size() != 1 {
		t.Errorf("Expected size 1 after invalidate, got %d", cache.Size())
	}
}

func TestClaudePaneCache_CleanupExceptEmpty(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)
	cache.Set("1234", true)
	cache.Set("5678", false)

	// Verify entries exist
	if cache.Size() != 2 {
		t.Errorf("Expected 2 entries, got %d", cache.Size())
	}

	// Clean up with empty valid PIDs map - should remove everything
	cache.CleanupExcept(map[string]bool{})

	if cache.Size() != 0 {
		t.Errorf("Expected cache to be empty after CleanupExcept with empty map, got %d entries", cache.Size())
	}
}

func TestClaudePaneCache_InvalidTTL(t *testing.T) {
	// Test zero TTL
	_, err := NewClaudePaneCache(0)
	if err == nil {
		t.Error("Expected error for zero TTL, got nil")
	}

	// Test negative TTL
	_, err = NewClaudePaneCache(-1 * time.Second)
	if err == nil {
		t.Error("Expected error for negative TTL, got nil")
	}

	// Test valid TTL should not error
	_, err = NewClaudePaneCache(1 * time.Second)
	if err != nil {
		t.Errorf("Expected no error for valid TTL, got: %v", err)
	}
}
