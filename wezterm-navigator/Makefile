.PHONY: dev build test test-e2e clean

dev:
	go run ./cmd/wezterm-navigator

build:
	mkdir -p build
	go build -o build/wezterm-navigator ./cmd/wezterm-navigator

test:
	go test ./...

test-e2e:
	@echo "No E2E tests defined yet for wezterm-navigator"

clean:
	rm -rf build/
