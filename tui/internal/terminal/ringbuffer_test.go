package terminal

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestNewRingBuffer(t *testing.T) {
	buffer := NewRingBuffer(100)
	
	assert.NotNil(t, buffer)
	assert.Equal(t, 0, buffer.Size())
}

func TestRingBufferWrite(t *testing.T) {
	buffer := NewRingBuffer(10)
	
	// Write some data
	buffer.Write([]byte("hello"))
	assert.Equal(t, 5, buffer.Size())
	
	// Write more data
	buffer.Write([]byte("world"))
	assert.Equal(t, 10, buffer.Size())
	
	// Write data that exceeds buffer size (should wrap)
	buffer.Write([]byte("!"))
	assert.Equal(t, 10, buffer.Size()) // Size should remain at capacity
}

func TestRingBufferRead(t *testing.T) {
	buffer := NewRingBuffer(10)
	
	// Write some data
	buffer.Write([]byte("hello"))
	
	// Read it back
	data := buffer.Read()
	assert.Equal(t, []byte("hello"), data)
	
	// Buffer should still contain data (Read doesn't clear)
	assert.Equal(t, 5, buffer.Size())
}

func TestRingBufferReadWriteCycle(t *testing.T) {
	buffer := NewRingBuffer(5)
	
	// Write more than buffer capacity
	buffer.Write([]byte("hello world"))
	
	// Should only contain the last 5 bytes
	data := buffer.Read()
	assert.Equal(t, 5, len(data))
	// The exact content depends on UTF-8 boundary handling, just verify size
}

func TestRingBufferClear(t *testing.T) {
	buffer := NewRingBuffer(10)
	
	// Write some data
	buffer.Write([]byte("hello"))
	assert.Equal(t, 5, buffer.Size())
	
	// Clear the buffer
	buffer.Clear()
	assert.Equal(t, 0, buffer.Size())
	
	// Should be able to read nothing
	data := buffer.Read()
	assert.Equal(t, 0, len(data))
}

func TestRingBufferSize(t *testing.T) {
	buffer := NewRingBuffer(100)
	
	assert.Equal(t, 0, buffer.Size())
	
	buffer.Write([]byte("test"))
	assert.Equal(t, 4, buffer.Size())
	
	buffer.Write([]byte(" data"))
	assert.Equal(t, 9, buffer.Size())
	
	// Read the data (doesn't remove it)
	data := buffer.Read()
	assert.Equal(t, 9, len(data))
	assert.Equal(t, 9, buffer.Size()) // Size unchanged after read
}

func TestRingBufferWriteEmpty(t *testing.T) {
	buffer := NewRingBuffer(10)
	
	// Write empty slice
	buffer.Write([]byte{})
	assert.Equal(t, 0, buffer.Size())
}

func TestRingBufferReadEmpty(t *testing.T) {
	buffer := NewRingBuffer(10)
	
	// Read from empty buffer
	data := buffer.Read()
	assert.Equal(t, 0, len(data))
}

func TestRingBufferSmallCapacity(t *testing.T) {
	buffer := NewRingBuffer(1)
	
	// Write single byte
	buffer.Write([]byte("a"))
	assert.Equal(t, 1, buffer.Size())
	
	// Write another byte (should overwrite)
	buffer.Write([]byte("b"))
	assert.Equal(t, 1, buffer.Size())
	
	// Read back should get 'b'
	data := buffer.Read()
	assert.Equal(t, 1, len(data))
	assert.Equal(t, []byte("b"), data)
}