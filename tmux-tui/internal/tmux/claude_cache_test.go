package tmux

import (
	"fmt"
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

func TestClaudePaneCache_Clear(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	// Add several entries
	cache.Set("1234", true)
	cache.Set("5678", false)
	cache.Set("9999", true)

	// Verify all exist
	if cache.Size() != 3 {
		t.Errorf("Expected 3 entries, got %d", cache.Size())
	}

	// Clear all entries
	cache.Clear()

	// Verify cache is empty
	if cache.Size() != 0 {
		t.Errorf("Expected 0 entries after Clear(), got %d", cache.Size())
	}

	// Verify entries are actually gone
	if _, found := cache.Get("1234"); found {
		t.Error("Expected 1234 to be cleared")
	}
	if _, found := cache.Get("5678"); found {
		t.Error("Expected 5678 to be cleared")
	}
	if _, found := cache.Get("9999"); found {
		t.Error("Expected 9999 to be cleared")
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

func TestClaudePaneCache_CleanupExceptConcurrency(t *testing.T) {
	cache := mustNewCache(t, 30*time.Second)

	// Pre-populate
	for i := 0; i < 50; i++ {
		cache.Set(fmt.Sprintf("pane-%d", i), i%2 == 0)
	}

	validPIDs := make(map[string]bool)
	for i := 0; i < 25; i++ {
		validPIDs[fmt.Sprintf("pane-%d", i*2)] = true
	}

	var wg sync.WaitGroup

	// 100 concurrent operations
	for i := 0; i < 100; i++ {
		// Concurrent Gets
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			cache.Get(fmt.Sprintf("pane-%d", id%50))
		}(i)

		// Concurrent Sets
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			cache.Set(fmt.Sprintf("pane-%d", id%50), id%3 == 0)
		}(i)

		// Concurrent CleanupExcept
		if i%10 == 0 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				cache.CleanupExcept(validPIDs)
			}()
		}
	}

	wg.Wait()

	// Verify cache state is consistent
	// Note: Now that CleanupExcept also removes expired entries, the cache may be
	// slightly smaller than before. We allow a buffer of 15 to account for timing.
	finalSize := cache.Size()
	if finalSize > len(validPIDs)+15 {
		t.Errorf("Expected cache size <= %d, got %d",
			len(validPIDs)+15, finalSize)
	}
}

func TestClaudePaneCache_CleanupDuringExpiration(t *testing.T) {
	cache := mustNewCache(t, 50*time.Millisecond)

	// Set entries that will expire
	for i := 0; i < 20; i++ {
		cache.Set(fmt.Sprintf("expiring-%d", i), true)
	}

	time.Sleep(60 * time.Millisecond)

	// Set fresh entries
	validPIDs := make(map[string]bool)
	for i := 0; i < 10; i++ {
		panePID := fmt.Sprintf("fresh-%d", i)
		cache.Set(panePID, true)
		validPIDs[panePID] = true
	}

	var wg sync.WaitGroup

	// Race cleanup against expiration checks
	for i := 0; i < 50; i++ {
		wg.Add(3)

		go func(id int) {
			defer wg.Done()
			cache.Get(fmt.Sprintf("expiring-%d", id%20))
		}(i)

		go func(id int) {
			defer wg.Done()
			cache.Get(fmt.Sprintf("fresh-%d", id%10))
		}(i)

		go func() {
			defer wg.Done()
			cache.CleanupExcept(validPIDs)
		}()
	}

	wg.Wait()

	// Verify only fresh entries remain
	if cache.Size() != len(validPIDs) {
		t.Errorf("Expected %d entries, got %d", len(validPIDs), cache.Size())
	}

	for i := 0; i < 20; i++ {
		if _, found := cache.Get(fmt.Sprintf("expiring-%d", i)); found {
			t.Error("Expired entry should not be in cache")
		}
	}
}
