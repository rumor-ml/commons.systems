# Makefile for finparse

.PHONY: help build build-server install test test-unit clean run run-server validate format lint typecheck deps

help:
	@echo "\033[36mfinparse - Financial data parser CLI\033[0m"
	@echo ""
	@echo "\033[32mBuild targets:\033[0m"
	@echo "  make build           - Build finparse binary to bin/"
	@echo "  make build-server    - Build finparse-server binary to bin/"
	@echo "  make install         - Install finparse to \$$GOPATH/bin"
	@echo "  make run ARGS='...'  - Run finparse with arguments"
	@echo "  make run-server      - Run finparse server"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests"
	@echo "  make test-unit       - Run unit tests"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (go vet)"
	@echo "  make typecheck       - Run type checking (go build)"
	@echo "  make format          - Auto-format code (go fmt)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make deps            - Download and tidy dependencies"
	@echo "  make clean           - Clean build artifacts"

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

test: test-unit

test-unit:
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

# Validation pipeline (using shared infrastructure)
HAS_GO=1
include ../infrastructure/make/validate.mk

# Development helpers
deps:
	@go mod tidy
	@go mod download
