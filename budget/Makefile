# Makefile for budget
# Firebase static site
# Follows monorepo conventions: standard targets (test/validate/lint/etc), help menu, default goal

.PHONY: help build dev dev-full dev-pool test test-unit test-e2e test-qa-env clean install validate format lint typecheck dev-qa stop-qa qa-status

help:
	@echo "\033[36mbudget - Budget tracking app\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development server only (emulators separate)"
	@echo "  make dev-full        - Start emulators + dev server (singleton mode)"
	@echo "  make dev-pool        - Start emulators + dev server (pool mode)"
	@echo "  make dev-qa          - Start automated QA server"
	@echo "  make stop-qa         - Stop automated QA server"
	@echo "  make qa-status       - Show QA server status"
	@echo "  make build           - Build production bundle"
	@echo "  make install         - Install dependencies"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit + E2E + QA env)"
	@echo "  make test-unit       - Run unit tests (Vitest)"
	@echo "  make test-e2e        - Run Playwright E2E tests"
	@echo "  make test-qa-env     - Run QA environment integration tests"
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
	@echo "Starting budget in development mode..."
	@cd site && pnpm dev

dev-full:
	@echo "Starting budget with emulators (singleton mode)..."
	@../infrastructure/scripts/start-dev-environment.sh budget

dev-pool:
	@echo "Starting budget with emulators (pool mode)..."
	@../infrastructure/scripts/start-dev-environment.sh pool budget

# Build
build:
	@echo "Building budget..."
	@cd site && pnpm build

# Tests
test: test-unit test-e2e test-qa-env

test-unit:
	@echo "Running unit tests..."
	@cd site && pnpm test:run

test-e2e:
	@echo "Running Playwright E2E tests..."
	@../infrastructure/scripts/run-e2e-tests.sh firebase budget

test-qa-env:
	@echo "Running QA environment integration tests..."
	@bash scripts/tests/generate-qa-env.test.sh

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

# QA automation targets
dev-qa:
	@echo "Starting automated QA server..."
	@bash scripts/dev-qa.sh

stop-qa:
	@echo "Stopping automated QA server..."
	@bash scripts/stop-qa.sh

qa-status:
	@bash scripts/qa-status.sh

# Cleanup
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf site/dist tests/test-results tests/playwright-report

# Install dependencies
install:
	@cd site && pnpm install
	@cd tests && pnpm install

.DEFAULT_GOAL := build
