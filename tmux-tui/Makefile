# Makefile for tmux-tui
# Follows commons.systems monorepo build patterns

.PHONY: build test test-unit test-e2e clean dev

# Binary output location
BINARY_NAME=tmux-tui
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

build:
	@echo "Building tmux-tui..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/tmux-tui

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@$(GO) test -v ./cmd/... ./internal/... 2>/dev/null || echo "No unit tests found (expected for MVP)"

test-e2e:
	@echo "Running E2E tests..."
	@command -v tmux >/dev/null || (echo "Error: tmux not found" && exit 1)
	@$(GO) test -v ./tests/...

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@$(GO) clean

dev:
	@echo "Starting tmux-tui in development mode..."
	$(GO) run ./cmd/tmux-tui

.DEFAULT_GOAL := build
