# Makefile for {{APP_NAME}}
# Firebase + Go fullstack application
# Follows commons.systems monorepo build patterns

.PHONY: help build dev test test-unit test-e2e clean install validate format lint typecheck

help:
	@echo "\033[36m{{APP_NAME}} - Firebase + Go fullstack application\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development server"
	@echo "  make build           - Build production bundle"
	@echo "  make install         - Install dependencies"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit + E2E)"
	@echo "  make test-unit       - Run unit tests (Go)"
	@echo "  make test-e2e        - Run Playwright E2E tests"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (go vet + ESLint)"
	@echo "  make typecheck       - Run type checking (go build + tsc)"
	@echo "  make format          - Auto-format code (go fmt + Prettier)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

# Development
dev:
	@cd site && make dev

# Build
build:
	@cd site && make build

# Tests
test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@cd site && go test -v ./cmd/... ./internal/...

test-e2e:
	@echo "Running Playwright E2E tests..."
	@cd tests && pnpm test

# Validation targets follow commons.systems standard pattern
# Note: Firebase template has Go code in site/ subdirectory, so we use custom targets
.PHONY: validate format lint typecheck
validate: lint typecheck test

format:
	@echo "Formatting code..."
	@cd site && go fmt ./...
	@cd tests && pnpm prettier --write .

lint:
	@echo "Running linters..."
	@cd site && go vet ./...
	# TODO(#1875): Remove || true to properly fail on lint errors
	@cd tests && pnpm eslint . || true

typecheck:
	@echo "Type checking..."
	@cd site && go build ./...
	@cd tests && pnpm tsc --noEmit || true

# Cleanup
clean:
	@cd site && make clean
	@rm -rf tests/test-results tests/playwright-report

# Install dependencies
install:
	@cd site && make install
	@cd tests && pnpm install

.DEFAULT_GOAL := build
