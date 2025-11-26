#!/bin/bash
# Test a Go package
set -e

PKG_PATH="$1"
PKG_NAME=$(basename "$PKG_PATH")

cd "$PKG_PATH"

echo "--- Go Tests ---"
go test -v ./...

echo "Tests passed for $PKG_NAME"
