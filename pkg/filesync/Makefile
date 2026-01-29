# Makefile for filesync package
# Follows commons.systems monorepo build patterns

.PHONY: help test test-unit test-integration validate format lint typecheck clean

help:
	@echo "\033[36mfilesync - File discovery and sync library\033[0m"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit + integration)"
	@echo "  make test-unit       - Run unit tests only"
	@echo "  make test-integration - Run integration tests"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (go vet)"
	@echo "  make typecheck       - Run type checking (go build)"
	@echo "  make format          - Auto-format code (go fmt)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

test: test-unit test-integration

test-unit:
	@echo "Running unit tests..."
	@go test -v -json -short ./...

test-integration:
	@echo "Running integration tests..."
	@../../infrastructure/scripts/run-go-tests.sh

# Validation pipeline
validate: lint typecheck test

format:
	@echo "Formatting code..."
	@go fmt ./...

lint:
	@echo "Running linters..."
	@go vet ./...

typecheck:
	@echo "Type checking..."
	@go build ./...

clean:
	@echo "Cleaning..."
	@go clean

.DEFAULT_GOAL := test
