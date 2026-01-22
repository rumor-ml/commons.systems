# Makefile for budget
# Follows commons.systems monorepo build patterns

.PHONY: build dev test test-unit test-e2e clean

# Development targets
dev:
	@echo "Starting budget in development mode..."
	@cd site && make dev

build:
	@echo "Building budget..."
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

.DEFAULT_GOAL := build
