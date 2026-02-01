# Makefile for budget/site
# Frontend build and development
# Backend server is now provided by finparse (../../finparse)

.PHONY: dev build clean test install-deps frontend seed-local

# Development - run frontend dev server
# Note: Start finparse-server separately: cd ../../finparse && make run-server
dev: install-deps
	@echo "Starting budget site frontend in development mode..."
	@echo "Frontend: http://localhost:5173"
	@echo "Note: Ensure finparse-server is running (cd ../../finparse && make run-server)"
	@pnpm run dev

# Build frontend
build: install-deps
	@echo "Building budget site frontend..."
	@pnpm run build

# Run frontend dev server
frontend:
	@echo "Starting frontend dev server on :5173..."
	@pnpm run dev

# Install dependencies
install-deps:
	@echo "Installing dependencies..."
	@pnpm install

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist/

# Run tests
test:
	@echo "Running frontend tests..."
	@pnpm run test:run

# Seed local Firestore emulator with demo data
seed-local:
	@echo "Seeding local Firestore emulator with demo data..."
	@bash scripts/seed-local.sh

.DEFAULT_GOAL := dev
