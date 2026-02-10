# Makefile for audiobrowser
# Firebase static site
# Follows commons.systems monorepo build patterns

# Validation targets - configure for validate.mk include
HAS_TS=1
TS_DIRS=site tests

.PHONY: help build dev test test-unit test-e2e clean install

help:
	@echo "\033[36maudiobrowser - Audio file browser\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development server"
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
	@echo "Starting audiobrowser in development mode..."
	@cd site && pnpm dev

# Build
build:
	@echo "Building audiobrowser..."
	@cd site && pnpm build

# Tests
test: test-e2e

test-unit:
	@echo "No unit tests for static site"

test-e2e: build
	@echo "Running Playwright E2E tests..."
	@cd tests && pnpm test

# Validation targets provided by infrastructure/make/validate.mk
include ../infrastructure/make/validate.mk

# Cleanup
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf site/dist tests/test-results tests/playwright-report

# Install dependencies
install:
	@cd site && pnpm install
	@cd tests && pnpm install

.DEFAULT_GOAL := build
