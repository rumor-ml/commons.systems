.PHONY: help dev build clean install test test-unit test-e2e test-emulator validate format lint typecheck

help:
	@echo "\033[36m{{APP_NAME}} - Go fullstack web application\033[0m"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start dev server with hot reload (templ + tailwind + air)"
	@echo "  make build           - Build production binary"
	@echo "  make install         - Install dependencies (templ, air, pnpm)"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests (unit only)"
	@echo "  make test-unit       - Run unit tests (Go)"
	@echo "  make test-e2e        - Run E2E tests (requires emulators running)"
	@echo "  make test-emulator   - Start emulators, run E2E tests, cleanup"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (go vet + ESLint)"
	@echo "  make typecheck       - Run type checking (go build + tsc)"
	@echo "  make format          - Auto-format code (go fmt + Prettier)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

dev:
	@make -j3 dev/templ dev/tailwind dev/server

dev/templ:
	templ generate --watch

dev/tailwind:
	npm run watch:css

dev/server:
	GO_ENV=development air

build:
	templ generate
	npm run build:css
	go run scripts/build.go
	go build -o bin/{{APP_NAME}} ./cmd/server

clean:
	rm -rf tmp web/dist bin

install:
	go install github.com/a-h/templ/cmd/templ@v0.2.543
	go install github.com/cosmtrek/air@latest
	pnpm install

test: test-unit

test-unit:
	@echo "Running unit tests..."
	@go test -v ./cmd/... ./internal/...

# Run E2E tests (requires emulators to be running separately)
test-e2e:
	@echo "Running E2E tests..."
	@echo "Note: Make sure Firebase emulators are running (firebase emulators:start)"
	cd ../tests && pnpm test

# Start emulators and run E2E tests (convenience target)
# Note: This requires firebase-tools to be installed and firebase.json configured
test-emulator:
	@echo "Starting Firebase emulators and running E2E tests..."
	@echo "This will start emulators in the background, run tests, then clean up."
	@if ! command -v firebase &> /dev/null; then \
		echo "Error: firebase-tools not installed. Install with: npm install -g firebase-tools"; \
		exit 1; \
	fi
	@# Start emulators in background
	firebase emulators:start --only firestore,storage > /tmp/emulator.log 2>&1 & \
	EMULATOR_PID=$$! && \
	echo "Waiting for emulators to start..." && \
	sleep 5 && \
	cd ../tests && pnpm test; \
	TEST_EXIT=$$?; \
	kill $$EMULATOR_PID 2>/dev/null || true; \
	exit $$TEST_EXIT

# Validation targets follow commons.systems standard pattern
HAS_GO=1
HAS_TS=1
TS_DIR=../tests
include ../../../../infrastructure/make/validate.mk
