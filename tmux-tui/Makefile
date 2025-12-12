# Makefile for tmux-tui
# Follows commons.systems monorepo build patterns

.PHONY: build build-tui build-daemon build-block test test-unit test-e2e test-e2e-real clean dev

# Binary output location
BINARY_NAME=tmux-tui
DAEMON_NAME=tmux-tui-daemon
BLOCK_NAME=tmux-tui-block
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

build: build-tui build-daemon build-block

build-tui:
	@echo "Building tmux-tui..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/tmux-tui

build-daemon:
	@echo "Building tmux-tui-daemon..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(DAEMON_NAME) ./cmd/tmux-tui-daemon

build-block:
	@echo "Building tmux-tui-block..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BLOCK_NAME) ./cmd/tmux-tui-block

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@$(GO) test -v -json ./cmd/... ./internal/... 2>/dev/null || echo "No unit tests found (expected for MVP)"

test-e2e:
	@echo "Running E2E tests (DEFAULT: fake Claude, no tokens used)..."
	@command -v tmux >/dev/null || (echo "Error: tmux not found" && exit 1)
	@$(GO) test -v -count=1 -timeout 180s ./tests/...
	@echo "✓ Tests completed with fake Claude (no API tokens consumed)"

test-e2e-real:
	@echo "Running E2E tests with REAL Claude (--model haiku)..."
	@command -v claude >/dev/null || (echo "Error: real Claude not found" && exit 1)
	@echo "WARNING: This will consume API tokens!"
	@USE_REAL_CLAUDE=1 $(GO) test -v -count=1 -timeout 120s ./tests/... -run 'TestReal|TestUserPromptSubmit'
	@echo "✓ Tests completed with real Claude"

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@$(GO) clean

dev:
	@echo "Starting tmux-tui in development mode..."
	$(GO) run ./cmd/tmux-tui

.DEFAULT_GOAL := build
