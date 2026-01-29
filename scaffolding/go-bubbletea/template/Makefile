# Makefile for {{APP_NAME}}
# Follows commons.systems monorepo build patterns

.PHONY: help build test test-unit test-e2e clean dev validate format lint typecheck cover

# Binary output location
BINARY_NAME={{APP_NAME}}
BUILD_DIR=./build

# Go build flags
GO=go
GOFLAGS=-v
LDFLAGS=-ldflags "-s -w"

help:
	@echo "\033[36m{{APP_NAME}} - Bubble Tea TUI application\033[0m"
	@echo ""
	@echo "\033[32mBuild targets:\033[0m"
	@echo "  make build           - Build production binary to build/"
	@echo "  make dev             - Run in development mode"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit + E2E)"
	@echo "  make test-unit       - Run unit tests"
	@echo "  make test-e2e        - Run E2E tests"
	@echo "  make cover           - Generate coverage report"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (go vet)"
	@echo "  make typecheck       - Run type checking (go build)"
	@echo "  make format          - Auto-format code (go fmt)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

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

# Validation pipeline
validate: lint typecheck test

format:
	@echo "Formatting code..."
	@$(GO) fmt ./...

lint:
	@echo "Running linters..."
	@$(GO) vet ./...

typecheck:
	@echo "Type checking..."
	@$(GO) build ./...

cover:
	@$(GO) test -coverprofile=coverage.out ./...
	@$(GO) tool cover -html=coverage.out -o coverage.html

.DEFAULT_GOAL := build
