# Makefile for fellspiral
# Firebase static site
# Follows commons.systems monorepo build patterns

.PHONY: help build dev dev-full dev-pool test test-unit test-e2e clean install validate format lint typecheck

help:
	@echo "\033[36mfellspiral - Firebase static site\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development server only (emulators separate)"
	@echo "  make dev-full        - Start emulators + dev server (singleton mode)"
	@echo "  make dev-pool        - Start emulators + dev server (pool mode)"
	@echo "  make build           - Build production bundle"
	@echo "  make install         - Install dependencies"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (E2E with Playwright)"
	@echo "  make test-unit       - No unit tests for static site"
	@echo "  make test-e2e        - Run Playwright E2E tests"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (ESLint)"
	@echo "  make typecheck       - Run type checking (tsc)"
	@echo "  make format          - Auto-format code (Prettier)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

# Development
dev:
	@echo "Starting fellspiral in development mode..."
	@cd site && pnpm dev

dev-full:
	@echo "Starting fellspiral with emulators (singleton mode)..."
	@../infrastructure/scripts/start-dev-environment.sh fellspiral

dev-pool:
	@echo "Starting fellspiral with emulators (pool mode)..."
	@../infrastructure/scripts/start-dev-environment.sh pool fellspiral

# Build
build:
	@echo "Building fellspiral..."
	@cd site && pnpm build

# Tests
test: test-e2e

test-unit:
	@echo "No unit tests for static site"

test-e2e:
	@echo "Running Playwright E2E tests..."
	@cd tests && pnpm test

# Validation
validate: lint typecheck test

format:
	@echo "Formatting code..."
	@cd site && pnpm prettier --write .
	@cd tests && pnpm prettier --write .

lint:
	@echo "Running linters..."
	@cd site && pnpm eslint . || true
	@cd tests && pnpm eslint . || true

typecheck:
	@echo "Type checking..."
	@cd tests && pnpm tsc --noEmit || true

# Cleanup
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf site/dist tests/test-results tests/playwright-report

# Install dependencies
install:
	@cd site && pnpm install
	@cd tests && pnpm install

.DEFAULT_GOAL := build
