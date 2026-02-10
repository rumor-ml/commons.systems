# Shared validation targets for commons.systems monorepo
# Include this in project Makefiles to get standard validate/format/lint/typecheck targets
#
# Usage:
#   include ../../infrastructure/make/validate.mk  # adjust path as needed
#
# Required variables (set in project Makefile before including this file):
#   HAS_GO      - Set to 1 if project has Go code (default: 0)
#   HAS_TS      - Set to 1 if project has TypeScript code (default: 0)
#   TS_DIR      - Directory containing TypeScript code (default: tests)
#
# Optional variables:
#   GO          - Go binary path (default: go)
#
# Example for Go-only project:
#   HAS_GO=1
#   include ../../infrastructure/make/validate.mk
#
# Example for Go+TypeScript project (TypeScript in current directory):
#   HAS_GO=1
#   HAS_TS=1
#   TS_DIR=tests
#   include ../../infrastructure/make/validate.mk
#
# Example for TypeScript-only project:
#   HAS_TS=1
#   TS_DIR=.
#   include ../../infrastructure/make/validate.mk
#
# Note: Projects with complex structures (multiple TS directories, Go code in subdirectories)
# should define custom targets instead of using this include. See printsync/Makefile for example.
#
# Note: TypeScript lint/typecheck use || true to allow failure (non-blocking for iterative development)

# Defaults
HAS_GO ?= 0
HAS_TS ?= 0
TS_DIR ?= tests
GO ?= go

# Validation pipeline - runs lint, typecheck, and test
.PHONY: validate
validate: lint typecheck test

# Format code (Go fmt + Prettier)
.PHONY: format
format:
	@echo "Formatting code..."
ifeq ($(HAS_GO),1)
	@$(GO) fmt ./...
endif
ifeq ($(HAS_TS),1)
	@cd $(TS_DIR) && pnpm prettier --write .
endif

# Run linters (go vet + ESLint)
.PHONY: lint
lint:
	@echo "Running linters..."
ifeq ($(HAS_GO),1)
	@$(GO) vet ./...
endif
ifeq ($(HAS_TS),1)
	@cd $(TS_DIR) && pnpm eslint . || true
endif

# Type checking (go build + tsc)
.PHONY: typecheck
typecheck:
	@echo "Type checking..."
ifeq ($(HAS_GO),1)
	@$(GO) build ./...
endif
ifeq ($(HAS_TS),1)
	@cd $(TS_DIR) && pnpm tsc --noEmit || true
endif
