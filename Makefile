# Root Makefile for commons.systems monorepo
# Provides unified test and validation interface across all project types
# Delegates to infrastructure/scripts/ for test discovery and execution

.PHONY: help test test-unit test-integration test-e2e validate format lint typecheck clean

# Default target shows help
.DEFAULT_GOAL := help

# Colors for output
CYAN := \033[36m
GREEN := \033[32m
RESET := \033[0m

help:
	@echo "$(CYAN)commons.systems monorepo$(RESET)"
	@echo ""
	@echo "$(GREEN)Test targets:$(RESET)"
	@echo "  make test              - Run all tests (discovers and runs tests for all project types)"
	@echo "  make test-unit         - Run unit tests only"
	@echo "  make test-integration  - Run integration tests only"
	@echo "  make test-e2e          - Run end-to-end tests only"
	@echo ""
	@echo "$(GREEN)Validation targets:$(RESET)"
	@echo "  make validate          - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint              - Run linters based on project type"
	@echo "  make format            - Auto-format code based on project type"
	@echo "  make typecheck         - Run type checkers based on project type"
	@echo ""
	@echo "$(GREEN)Other targets:$(RESET)"
	@echo "  make clean             - Clean build artifacts"
	@echo ""
	@echo "Note: All test targets delegate to infrastructure/scripts/run-tests.sh"
	@echo "      which automatically discovers project types and runs appropriate tests."

# Test targets - delegate to infrastructure scripts
test:
	@echo "$(CYAN)Running all tests...$(RESET)"
	@./infrastructure/scripts/run-tests.sh

test-unit:
	@echo "$(CYAN)Running unit tests...$(RESET)"
	@./infrastructure/scripts/run-tests.sh --type unit

test-integration:
	@echo "$(CYAN)Running integration tests...$(RESET)"
	@./infrastructure/scripts/run-tests.sh --type integration

test-e2e:
	@echo "$(CYAN)Running E2E tests...$(RESET)"
	@./infrastructure/scripts/run-tests.sh --type e2e

# Validation pipeline
validate: lint typecheck test
	@echo "$(GREEN)✓ Validation complete$(RESET)"

# Format code based on project type
format:
	@echo "$(CYAN)Formatting code...$(RESET)"
	@if [ -f "go.mod" ]; then \
		echo "  Formatting Go code..."; \
		go fmt ./...; \
	fi
	@if [ -f "package.json" ]; then \
		echo "  Formatting TypeScript/JavaScript..."; \
		if command -v pnpm > /dev/null 2>&1; then \
			pnpm prettier --write .; \
		elif command -v npx > /dev/null 2>&1; then \
			npx prettier --write .; \
		fi; \
	fi
	@echo "$(GREEN)✓ Formatting complete$(RESET)"

# Run linters based on project type
lint:
	@echo "$(CYAN)Running linters...$(RESET)"
	@if [ -f "go.mod" ]; then \
		echo "  Running go vet..."; \
		go vet ./...; \
	fi
	@if [ -f "package.json" ]; then \
		echo "  Running eslint..."; \
		if command -v pnpm > /dev/null 2>&1; then \
			pnpm eslint . || true; \
		elif command -v npx > /dev/null 2>&1; then \
			npx eslint . || true; \
		fi; \
	fi
	@echo "$(GREEN)✓ Linting complete$(RESET)"

# Run type checkers
typecheck:
	@echo "$(CYAN)Running type checkers...$(RESET)"
	@if [ -f "go.mod" ]; then \
		echo "  Type checking Go code..."; \
		go build ./...; \
	fi
	@if [ -f "package.json" ] && [ -f "tsconfig.json" ]; then \
		echo "  Type checking TypeScript..."; \
		if command -v pnpm > /dev/null 2>&1; then \
			pnpm tsc --noEmit || true; \
		elif command -v npx > /dev/null 2>&1; then \
			npx tsc --noEmit || true; \
		fi; \
	fi
	@echo "$(GREEN)✓ Type checking complete$(RESET)"

# Clean build artifacts
clean:
	@echo "$(CYAN)Cleaning build artifacts...$(RESET)"
	@if [ -f "go.mod" ]; then \
		go clean; \
		rm -rf build/ bin/; \
	fi
	@if [ -f "package.json" ]; then \
		rm -rf dist/ build/ .next/ out/; \
	fi
	@rm -rf tmp/
	@echo "$(GREEN)✓ Cleanup complete$(RESET)"
