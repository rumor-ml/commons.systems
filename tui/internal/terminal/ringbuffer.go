// ringbuffer.go - Ring buffer implementation for terminal output
//
// ## Metadata
//
// TUI ring buffer for efficient terminal output management.
//
// ### Purpose
//
// Provide a thread-safe ring buffer implementation that efficiently manages terminal
// output data with automatic size limits and UTF-8 boundary preservation to prevent
// data corruption and memory issues.
//
// ### Instructions
//
// #### Buffer Management
//
// ##### Data Storage
//
// Implement a circular buffer that automatically overwrites old data when capacity
// is reached while maintaining UTF-8 character boundaries to prevent corruption.
//
// ##### Thread Safety
//
// Ensure all operations are thread-safe for concurrent read/write access from
// multiple goroutines handling terminal I/O and UI rendering.
//
// ### Dependencies
//
// #### [ICF](https://github.com/rumor-ml/icf)
//
// Core framework providing patterns for data structure implementation and
// thread-safe operation management.

package terminal

import (
	"sync"
	"unicode/utf8"
)

// RingBuffer implements a thread-safe circular buffer for terminal output
type RingBuffer struct {
	data     []byte
	capacity int
	head     int // Write position
	tail     int // Read position
	size     int // Current data size
	mu       sync.RWMutex
}

// NewRingBuffer creates a new ring buffer with specified capacity
func NewRingBuffer(capacity int) *RingBuffer {
	return &RingBuffer{
		data:     make([]byte, capacity),
		capacity: capacity,
		head:     0,
		tail:     0,
		size:     0,
	}
}

// Write adds data to the ring buffer, overwriting old data if necessary
func (rb *RingBuffer) Write(data []byte) {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	// If data is larger than capacity, only keep the tail end
	if len(data) > rb.capacity {
		// Find valid UTF-8 start position
		start := len(data) - rb.capacity
		for start < len(data) && !utf8.Valid([]byte{data[start]}) {
			start++
		}
		data = data[start:]
		// Reset buffer with just this data
		copy(rb.data, data)
		rb.head = len(data)
		rb.tail = 0
		rb.size = len(data)
		return
	}

	// Write data to buffer
	for _, b := range data {
		rb.data[rb.head] = b
		rb.head = (rb.head + 1) % rb.capacity

		if rb.size < rb.capacity {
			rb.size++
		} else {
			// Buffer is full, advance tail to overwrite old data
			rb.tail = (rb.tail + 1) % rb.capacity
		}
	}

	// Ensure tail is at a valid UTF-8 boundary
	if rb.size == rb.capacity {
		// Find next valid UTF-8 start
		for i := 0; i < 4 && rb.tail < rb.capacity; i++ {
			if utf8.Valid([]byte{rb.data[rb.tail]}) {
				break
			}
			rb.tail = (rb.tail + 1) % rb.capacity
			rb.size--
		}
	}
}

// Read returns all data currently in the buffer
func (rb *RingBuffer) Read() []byte {
	rb.mu.RLock()
	defer rb.mu.RUnlock()

	if rb.size == 0 {
		return []byte{}
	}

	result := make([]byte, rb.size)

	if rb.tail < rb.head {
		// Data is contiguous
		copy(result, rb.data[rb.tail:rb.head])
	} else {
		// Data wraps around
		n := copy(result, rb.data[rb.tail:rb.capacity])
		copy(result[n:], rb.data[0:rb.head])
	}

	return result
}

// Clear empties the ring buffer
func (rb *RingBuffer) Clear() {
	rb.mu.Lock()
	defer rb.mu.Unlock()

	rb.head = 0
	rb.tail = 0
	rb.size = 0
}

// Size returns the current amount of data in the buffer
func (rb *RingBuffer) Size() int {
	rb.mu.RLock()
	defer rb.mu.RUnlock()
	return rb.size
}
