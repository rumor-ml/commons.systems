.PHONY: dev build test clean

dev:
	go run ./cmd/wezterm-navigator

build:
	mkdir -p build
	go build -o build/wezterm-navigator ./cmd/wezterm-navigator

test:
	go test ./...

clean:
	rm -rf build/
