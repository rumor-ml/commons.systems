# Makefile for {{SERVICE}}-mcp-server
# TypeScript MCP server
# Follows commons.systems monorepo build patterns

.PHONY: help build dev test test-unit clean install validate format lint typecheck

help:
	@echo "\033[36m{{SERVICE}}-mcp-server - TypeScript MCP server\033[0m"
	@echo ""
	@echo "\033[32mBuild targets:\033[0m"
	@echo "  make build           - Build production bundle"
	@echo "  make install         - Install dependencies"
	@echo ""
	@echo "\033[32mDevelopment targets:\033[0m"
	@echo "  make dev             - Start development mode with watch"
	@echo ""
	@echo "\033[32mTest targets:\033[0m"
	@echo "  make test            - Run all tests"
	@echo "  make test-unit       - Run unit tests"
	@echo ""
	@echo "\033[32mValidation targets:\033[0m"
	@echo "  make validate        - Run full validation pipeline (lint + typecheck + test)"
	@echo "  make lint            - Run linters (ESLint)"
	@echo "  make typecheck       - Run type checking (tsc)"
	@echo "  make format          - Auto-format code (Prettier)"
	@echo ""
	@echo "\033[32mOther targets:\033[0m"
	@echo "  make clean           - Clean build artifacts"

# Build
build:
	@echo "Building {{SERVICE}}-mcp-server..."
	@pnpm build

# Development
dev:
	@echo "Starting {{SERVICE}}-mcp-server in dev mode..."
	@pnpm dev

# Tests
test: test-unit

test-unit:
	@echo "Running unit tests..."
	@pnpm test

# No E2E tests for MCP servers by default
test-e2e:
	@echo "No E2E tests configured for MCP server"

# Validation targets follow commons.systems standard pattern
HAS_TS=1
TS_DIR=.
include ../../../infrastructure/make/validate.mk

# Override typecheck to use pnpm typecheck instead of pnpm tsc --noEmit
typecheck:
	@echo "Type checking..."
	@pnpm typecheck

# Cleanup
clean:
	@echo "Cleaning build artifacts..."
	@rm -rf dist node_modules

# Install dependencies
install:
	@echo "Installing dependencies..."
	@pnpm install

.DEFAULT_GOAL := build
