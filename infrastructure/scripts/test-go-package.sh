#!/bin/bash
# Test a Go package
set -e

if [ -z "$1" ]; then
  echo "Usage: $0 <package-path>"
  exit 1
fi

if [ ! -d "$1" ]; then
  echo "Error: Directory '$1' does not exist"
  exit 1
fi

PKG_PATH="$1"
PKG_NAME=$(basename "$PKG_PATH")

cd "$PKG_PATH"

echo "--- Go Tests ---"
go test -v -json ./...

echo "Tests passed for $PKG_NAME"
