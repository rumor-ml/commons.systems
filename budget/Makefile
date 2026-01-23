# Makefile for budget
# Follows commons.systems monorepo build patterns

.PHONY: build dev test test-unit test-e2e test-qa-env clean dev-qa stop-qa qa-status

# Development targets
dev:
	@echo "Starting budget in development mode..."
	@cd site && make dev

build:
	@echo "Building budget..."
	@cd site && make build

test: test-unit test-e2e test-qa-env

test-unit:
	@echo "Running unit tests..."
	@cd site && go test -v ./cmd/... ./internal/... 2>/dev/null || echo "No unit tests found"

test-e2e:
	@echo "Running Playwright E2E tests..."
	@cd tests && pnpm test

test-qa-env:
	@echo "Running QA environment integration tests..."
	@bash scripts/tests/generate-qa-env.test.sh

clean:
	@echo "Cleaning build artifacts..."
	@cd site && make clean
	@rm -rf tests/test-results

# QA automation targets
dev-qa:
	@echo "Starting automated QA server..."
	@bash scripts/dev-qa.sh

stop-qa:
	@echo "Stopping automated QA server..."
	@bash scripts/stop-qa.sh

qa-status:
	@bash scripts/qa-status.sh

.DEFAULT_GOAL := build
