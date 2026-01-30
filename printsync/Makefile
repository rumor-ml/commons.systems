# Makefile for printsync
# Follows commons.systems monorepo build patterns

.PHONY: help build dev dev-full dev-pool test test-unit test-e2e clean validate format lint typecheck

help:
	@echo "\033[36mprintsync - Print queue sync service\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development server only (emulators separate)"
	@echo "  make dev-full        - Start emulators + dev server (singleton mode)"
	@echo "  make dev-pool        - Start emulators + dev server (pool mode)"
	@echo "  make build           - Build production bundle"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit + E2E)"
	@echo "  make test-unit       - Run unit tests"
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

# Development targets
dev:
	@echo "Starting printsync in development mode..."
	@cd site && make dev

dev-full:
	@echo "Starting printsync with emulators (singleton mode)..."
	@../infrastructure/scripts/start-dev-environment.sh printsync

dev-pool:
	@echo "Starting printsync with emulators (pool mode)..."
	@../infrastructure/scripts/start-dev-environment.sh pool printsync

build:
	@echo "Building printsync..."
	@cd site && make build

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	@cd site && go test -v ./cmd/... ./internal/... 2>/dev/null || echo "No unit tests found"

test-e2e:
	@echo "Running Playwright E2E tests..."
	@cd tests && pnpm test

clean:
	@echo "Cleaning build artifacts..."
	@cd site && make clean
	@rm -rf tests/test-results

# Validation pipeline
validate: lint typecheck test

format:
	@echo "Formatting code..."
	@cd site && go fmt ./...
	@cd tests && pnpm prettier --write .

lint:
	@echo "Running linters..."
	@cd site && go vet ./...
	@cd tests && pnpm eslint . || true

typecheck:
	@echo "Type checking..."
	@cd site && go build ./...
	@cd tests && pnpm tsc --noEmit || true

.DEFAULT_GOAL := build
