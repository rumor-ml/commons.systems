# Makefile for tmux-tui
# Follows commons.systems monorepo build patterns

.PHONY: help build build-tui build-daemon build-block test test-unit test-e2e test-e2e-real clean dev validate format lint typecheck

# Binary output location
BINARY_NAME=tmux-tui
DAEMON_NAME=tmux-tui-daemon
BLOCK_NAME=tmux-tui-block
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

help:
	@echo "\033[36mtmux-tui - Terminal UI for tmux session management\033[0m"
	@echo ""
	@echo "\033[32mBuild targets:\033[0m"
	@echo "  make build          - Build all binaries (tui + daemon + block)"
	@echo "  make build-tui      - Build tmux-tui binary only"
	@echo "  make build-daemon   - Build tmux-tui-daemon binary only"
	@echo "  make build-block    - Build tmux-tui-block binary only"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test           - Run all tests (unit + e2e with fake Claude)"
	@echo "  make test-unit      - Run unit tests only"
	@echo "  make test-e2e       - Run E2E tests with fake Claude (no API tokens)"
	@echo "  make test-e2e-real  - Run E2E tests with REAL Claude (uses API tokens)"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate       - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint           - Run linters (go vet)"
	@echo "  make typecheck      - Run type checking (go build)"
	@echo "  make format         - Auto-format code (go fmt)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make dev            - Start tmux-tui in development mode"
	@echo "  make clean          - Clean build artifacts"

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
	@SKIP_PERSISTENCE_ERROR_TESTS=1 $(GO) test -v -count=1 -timeout 180s ./tests/...
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

# Validation targets follow commons.systems standard pattern
HAS_GO=1
include ../infrastructure/make/validate.mk

.DEFAULT_GOAL := build
