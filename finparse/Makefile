# Makefile for finparse

.PHONY: build build-server install test clean run run-server fmt vet deps

build:
	@echo "Building finparse..."
	@mkdir -p bin
	@go build -o bin/finparse ./cmd/finparse

build-server:
	@echo "Building finparse-server..."
	@mkdir -p bin
	@go build -o bin/finparse-server ./cmd/server

install:
	@echo "Installing finparse..."
	@go install ./cmd/finparse

test:
	@echo "Running tests..."
	@go test -v ./...

clean:
	@echo "Cleaning..."
	@rm -rf bin/
	@go clean

run:
	@go run ./cmd/finparse $(ARGS)

run-server:
	@go run ./cmd/server

# Development helpers
fmt:
	@go fmt ./...

vet:
	@go vet ./...

deps:
	@go mod tidy
	@go mod download
