package status

import (
	"testing"
	"time"
)

func TestNewStatusCache(t *testing.T) {
	ttl := 5 * time.Minute
	cache := NewStatusCache(ttl)

	if cache == nil {
		t.Fatal("NewStatusCache returned nil")
	}

	if cache.data == nil {
		t.Error("Cache data map not initialized")
	}

	if cache.ttl != ttl {
		t.Errorf("Expected TTL %v, got %v", ttl, cache.ttl)
	}

	if len(cache.data) != 0 {
		t.Errorf("Expected empty cache initially, got %d entries", len(cache.data))
	}
}

func TestStatusCacheSetAndGet(t *testing.T) {
	cache := NewStatusCache(5 * time.Minute)

	testData := &StatusData{
		Source:    "test-source",
		Timestamp: time.Now(),
		Data:      map[string]interface{}{"key": "value"},
		Health:    HealthHealthy,
	}

	// Set data
	cache.Set("test-key", testData)

	// Get data
	retrieved, exists := cache.Get("test-key")
	if !exists {
		t.Fatal("Expected data to exist in cache")
	}

	if retrieved == nil {
		t.Fatal("Retrieved data is nil")
	}

	if retrieved.Source != testData.Source {
		t.Errorf("Expected source %s, got %s", testData.Source, retrieved.Source)
	}

	if retrieved.Health != testData.Health {
		t.Errorf("Expected health %v, got %v", testData.Health, retrieved.Health)
	}
}

func TestStatusCacheGetNonExistent(t *testing.T) {
	cache := NewStatusCache(5 * time.Minute)

	data, exists := cache.Get("non-existent")
	if exists {
		t.Error("Expected data to not exist")
	}

	if data != nil {
		t.Error("Expected nil data for non-existent key")
	}
}

func TestCachedStatusIsExpired(t *testing.T) {
	// Create a cached status with very short TTL
	cached := &CachedStatus{
		data:      &StatusData{Source: "test"},
		timestamp: time.Now().Add(-2 * time.Second),
		ttl:       1 * time.Second, // Very short TTL
	}

	if !cached.IsExpired() {
		t.Error("Expected cached status to be expired")
	}

	// Create a non-expired cached status
	cached.timestamp = time.Now()
	cached.ttl = 1 * time.Hour

	if cached.IsExpired() {
		t.Error("Expected cached status to not be expired")
	}
}

func TestStatusCacheExpiration(t *testing.T) {
	// Create cache with very short TTL for testing
	cache := NewStatusCache(1 * time.Millisecond)

	testData := &StatusData{
		Source: "test-source",
		Health: HealthHealthy,
	}

	cache.Set("test-key", testData)

	// Immediately should exist
	_, exists := cache.Get("test-key")
	if !exists {
		t.Error("Data should exist immediately after setting")
	}

	// Wait for expiration
	time.Sleep(10 * time.Millisecond)

	// Should be expired now
	_, exists = cache.Get("test-key")
	if exists {
		t.Error("Data should be expired after TTL")
	}
}

func TestStatusCacheClear(t *testing.T) {
	cache := NewStatusCache(1 * time.Millisecond)

	// Add some test data
	cache.Set("key1", &StatusData{Source: "source1"})
	cache.Set("key2", &StatusData{Source: "source2"})

	if cache.Size() != 2 {
		t.Errorf("Expected cache size 2, got %d", cache.Size())
	}

	// Wait for expiration
	time.Sleep(10 * time.Millisecond)

	// Clear expired entries
	cache.Clear()

	if cache.Size() != 0 {
		t.Errorf("Expected cache size 0 after clearing expired entries, got %d", cache.Size())
	}
}

func TestStatusCacheSize(t *testing.T) {
	cache := NewStatusCache(5 * time.Minute)

	// Initially empty
	if cache.Size() != 0 {
		t.Errorf("Expected initial size 0, got %d", cache.Size())
	}

	// Add entries
	cache.Set("key1", &StatusData{Source: "source1"})
	cache.Set("key2", &StatusData{Source: "source2"})

	if cache.Size() != 2 {
		t.Errorf("Expected size 2, got %d", cache.Size())
	}

	// Add duplicate key (should not increase size)
	cache.Set("key1", &StatusData{Source: "updated-source1"})

	if cache.Size() != 2 {
		t.Errorf("Expected size to remain 2 after duplicate key, got %d", cache.Size())
	}
}

func TestStatusCacheConcurrency(t *testing.T) {
	cache := NewStatusCache(5 * time.Minute)

	// Test concurrent reads and writes
	done := make(chan bool, 2)

	// Writer goroutine
	go func() {
		for i := 0; i < 100; i++ {
			key := "key" + string(rune(i))
			data := &StatusData{Source: "source" + string(rune(i))}
			cache.Set(key, data)
		}
		done <- true
	}()

	// Reader goroutine
	go func() {
		for i := 0; i < 100; i++ {
			key := "key" + string(rune(i))
			cache.Get(key) // May or may not exist, just testing for race conditions
		}
		done <- true
	}()

	// Wait for both goroutines to complete
	<-done
	<-done

	// If we get here without race detector warnings, the test passes
}

func TestStatusCacheOverwrite(t *testing.T) {
	cache := NewStatusCache(5 * time.Minute)

	originalData := &StatusData{
		Source: "original-source",
		Health: HealthHealthy,
	}

	updatedData := &StatusData{
		Source: "updated-source",
		Health: HealthWarning,
	}

	// Set original data
	cache.Set("test-key", originalData)

	retrieved, _ := cache.Get("test-key")
	if retrieved.Source != "original-source" {
		t.Errorf("Expected original source, got %s", retrieved.Source)
	}

	// Overwrite with updated data
	cache.Set("test-key", updatedData)

	retrieved, _ = cache.Get("test-key")
	if retrieved.Source != "updated-source" {
		t.Errorf("Expected updated source, got %s", retrieved.Source)
	}

	if retrieved.Health != HealthWarning {
		t.Errorf("Expected updated health %v, got %v", HealthWarning, retrieved.Health)
	}
}
