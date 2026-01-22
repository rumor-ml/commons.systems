# Makefile for budget/site
# Backend server and frontend build

.PHONY: dev build clean test install-deps server frontend

# Development - run backend and frontend concurrently
dev: install-deps
	@echo "Starting budget site in development mode..."
	@echo "Backend: http://localhost:8080"
	@echo "Frontend: http://localhost:5173"
	@make -j2 server frontend

# Build both backend and frontend
build: install-deps
	@echo "Building budget site..."
	@make build-backend
	@make build-frontend

# Build backend server
build-backend:
	@echo "Building backend server..."
	@go build -o bin/server ./cmd/server

# Build frontend
build-frontend:
	@echo "Building frontend..."
	@pnpm run build

# Run backend server
server:
	@echo "Starting backend server on :8080..."
	@go run ./cmd/server

# Run frontend dev server
frontend:
	@echo "Starting frontend dev server on :5173..."
	@pnpm run dev

# Install dependencies
install-deps:
	@echo "Installing dependencies..."
	@go mod download
	@pnpm install

# Clean build artifacts
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf bin/ dist/

# Run tests
test:
	@echo "Running tests..."
	@go test -v ./...
	@pnpm run test:run

.DEFAULT_GOAL := dev
