# Makefile for {{APP_NAME}}
# Follows commons.systems monorepo build patterns

.PHONY: build test test-unit test-e2e clean dev

# Binary output location
BINARY_NAME={{APP_NAME}}
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

build:
	@echo "Building {{APP_NAME}}..."
	@mkdir -p $(BUILD_DIR)
	$(GO) build $(GOFLAGS) $(LDFLAGS) -o $(BUILD_DIR)/$(BINARY_NAME) ./cmd/{{APP_NAME}}

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@$(GO) test -v ./cmd/... ./internal/...

test-e2e:
	@echo "Running E2E tests..."
	@$(GO) test -v ./tests/...

clean:
	@echo "Cleaning build artifacts..."
	@rm -rf $(BUILD_DIR)
	@$(GO) clean

dev:
	@echo "Starting {{APP_NAME}} in development mode..."
	$(GO) run ./cmd/{{APP_NAME}}

.DEFAULT_GOAL := build
