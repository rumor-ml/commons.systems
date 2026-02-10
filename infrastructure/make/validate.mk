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
#   TS_DIRS     - Space-separated list of TypeScript directories (alternative to TS_DIR)
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
# Example for project with multiple TypeScript directories:
#   HAS_TS=1
#   TS_DIRS=site tests
#   include ../../infrastructure/make/validate.mk
#
# Note: Use either TS_DIR (single directory) or TS_DIRS (multiple directories), not both.
# If TS_DIRS is set, TS_DIR is ignored.
#
# Note: TypeScript lint/typecheck use || true to allow failure (non-blocking for iterative development)

# Defaults
HAS_GO ?= 0
HAS_TS ?= 0
TS_DIR ?= tests
TS_DIRS ?=
GO ?= go

# If TS_DIRS is set, use it; otherwise use TS_DIR
_TS_DIRS := $(if $(TS_DIRS),$(TS_DIRS),$(TS_DIR))

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
	@for dir in $(_TS_DIRS); do \
		echo "Formatting $$dir..."; \
		(cd $$dir && pnpm prettier --write .); \
	done
endif

# Run linters (go vet + ESLint)
.PHONY: lint
lint:
	@echo "Running linters..."
ifeq ($(HAS_GO),1)
	@$(GO) vet ./...
endif
ifeq ($(HAS_TS),1)
	@for dir in $(_TS_DIRS); do \
		echo "Linting $$dir..."; \
		(cd $$dir && pnpm eslint . || true); \
	done
endif

# Type checking (go build + tsc)
.PHONY: typecheck
typecheck:
	@echo "Type checking..."
ifeq ($(HAS_GO),1)
	@$(GO) build ./...
endif
ifeq ($(HAS_TS),1)
	@for dir in $(_TS_DIRS); do \
		echo "Type checking $$dir..."; \
		(cd $$dir && pnpm tsc --noEmit || true); \
	done
endif
