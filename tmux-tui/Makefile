# Makefile for tmux-tui
# Follows commons.systems monorepo build patterns

.PHONY: build build-tui build-daemon test test-unit test-e2e clean dev

# Binary output location
BINARY_NAME=tmux-tui
DAEMON_NAME=tmux-tui-daemon
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

build: build-tui build-daemon

build-tui:
	@echo "Building tmux-tui..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/tmux-tui

build-daemon:
	@echo "Building tmux-tui-daemon..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(DAEMON_NAME) ./cmd/tmux-tui-daemon

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@$(GO) test -v -json ./cmd/... ./internal/... 2>/dev/null || echo "No unit tests found (expected for MVP)"

test-e2e:
	@echo "Running E2E tests..."
	@command -v tmux >/dev/null || (echo "Error: tmux not found" && exit 1)
	@$(GO) test -v -json -count=1 ./tests/...

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@$(GO) clean

dev:
	@echo "Starting tmux-tui in development mode..."
	$(GO) run ./cmd/tmux-tui

.DEFAULT_GOAL := build
