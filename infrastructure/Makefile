.PHONY: build install clean test test-port-utils test-emulator-startup test-firebase-ports-e2e test-scripts help

# Build the iac binary
build:
	@echo "Building iac..."
	@mkdir -p bin
	@go build -o bin/iac ./cmd/iac
	@echo "Built: bin/iac"

# Install iac globally
install:
	@echo "Installing iac..."
	@go install ./cmd/iac
	@echo "Installed: $(shell go env GOPATH)/bin/iac"

# Clean build artifacts
clean:
	@echo "Cleaning..."
	@rm -rf bin/
	@echo "Cleaned"

# Run tests
test:
	@echo "Running tests..."
	@go test -v ./...

# Run port-utils tests
test-port-utils:
	@echo "Running port-utils tests..."
	@./scripts/tests/port-utils.test.sh

# Run emulator-startup tests
test-emulator-startup:
	@echo "Running emulator-startup tests..."
	@./scripts/tests/emulator-startup.test.sh

# Run firebase-ports E2E tests
test-firebase-ports-e2e:
	@echo "Running firebase-ports E2E tests..."
	@./scripts/tests/firebase-ports-e2e.test.sh

# Run all script tests
test-scripts: test-port-utils test-emulator-startup test-firebase-ports-e2e
	@echo "All script tests passed!"

# Format code
fmt:
	@echo "Formatting code..."
	@go fmt ./...

# Run go mod tidy
tidy:
	@echo "Tidying dependencies..."
	@go mod tidy

# Show help
help:
	@echo "Available targets:"
	@echo "  build                - Build the iac binary to bin/iac"
	@echo "  install              - Install iac globally"
	@echo "  clean                - Remove build artifacts"
	@echo "  test                 - Run Go tests"
	@echo "  test-port-utils      - Run port-utils.sh tests"
	@echo "  test-emulator-startup - Run emulator-startup.sh tests"
	@echo "  test-firebase-ports-e2e - Run firebase-ports E2E integration tests"
	@echo "  test-scripts         - Run all script tests"
	@echo "  fmt                  - Format code"
	@echo "  tidy                 - Run go mod tidy"
	@echo "  help                 - Show this help message"
