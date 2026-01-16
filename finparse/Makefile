# Makefile for finparse

.PHONY: build install test clean run fmt vet deps

build:
	@echo "Building finparse..."
	@mkdir -p bin
	@go build -o bin/finparse ./cmd/finparse

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

# Development helpers
fmt:
	@go fmt ./...

vet:
	@go vet ./...

deps:
	@go mod tidy
	@go mod download
