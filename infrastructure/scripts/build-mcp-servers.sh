#!/usr/bin/env bash
# Build all TypeScript MCP servers to catch compilation errors early
#
# This script validates BOTH npm and Nix builds to ensure:
# 1. TypeScript compilation succeeds (npm build)
# 2. Nix derivation builds successfully (nix build)
#
# This catches issues like untracked source files that npm build won't detect
# but Nix build will fail on (since Nix only includes git-tracked files).
#
# This script is used by:
# - Pre-commit hooks (via nix/checks.nix) to catch TS errors before commit
# - CI/CD to validate builds
# - Manual testing during development
#
# Exit codes:
# 0 - All builds succeeded
# 1 - One or more builds failed

set -euo pipefail

# TODO(#1730): Silent fallback to wrong Node.js in build script when direnv fails
# Load direnv environment to ensure Nix Node.js is used instead of Homebrew Node.js.
# This prevents ICU4c library version conflicts on macOS.
eval "$(direnv export bash 2>/dev/null)" || true

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Find repository root
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

echo "Building TypeScript MCP servers..."
echo ""

# List of TypeScript MCP server directories
MCP_SERVERS=(
  "wiggum-mcp-server"
  "gh-workflow-mcp-server"
  "gh-issue-mcp-server"
  "git-mcp-server"
)

BUILD_FAILED=0
FAILED_SERVERS=()
# TODO(#328): Consider extracting BUILD_FAILED flag pattern into reusable test runner

for server in "${MCP_SERVERS[@]}"; do
  if [[ ! -d "$server" ]]; then
    echo -e "${YELLOW}⚠ Skipping $server (directory not found)${NC}"
    continue
  fi

  echo -e "Building ${server}..."

  # Test 1: npm build (TypeScript compilation)
  # TODO(#1757): npm build errors completely suppressed in build-mcp-servers.sh
  if (cd "$server" && npm run build) > /dev/null 2>&1; then
    echo -e "  ${GREEN}✓ npm build succeeded${NC}"
  else
    echo -e "  ${RED}✗ npm build failed${NC}"
    echo "    Run 'cd $server && npm run build' to see the error details"
    BUILD_FAILED=1
    FAILED_SERVERS+=("$server")
    echo ""
    continue  # Skip Nix build if npm build failed
  fi

  # Test 2: Nix build (full derivation including git-tracked file check)
  NIX_BUILD_OUTPUT=$(nix build ".#${server}" --no-link 2>&1)
  NIX_BUILD_EXIT=$?

  if [[ $NIX_BUILD_EXIT -eq 0 ]]; then
    echo -e "  ${GREEN}✓ Nix build succeeded${NC}"
  else
    echo -e "  ${RED}✗ Nix build failed${NC}"

    # Provide helpful diagnostics
    if echo "$NIX_BUILD_OUTPUT" | grep -q "Cannot find module"; then
      echo "    ${YELLOW}Possible cause: New source files not git-tracked${NC}"
      echo "    Run: git status | grep '??'"
      echo "    Then: git add <untracked-files>"
    elif echo "$NIX_BUILD_OUTPUT" | grep -q "hash mismatch"; then
      echo "    ${YELLOW}Possible cause: package-lock.json changed, npmDepsHash needs update${NC}"
      echo "    Run: nix run nixpkgs#prefetch-npm-deps ${server}/package-lock.json"
    else
      echo "    Run: nix build .#${server} --no-link"
      echo "    to see the full error details"
    fi

    BUILD_FAILED=1
    FAILED_SERVERS+=("$server")
  fi

  echo ""
done

if [[ $BUILD_FAILED -eq 1 ]]; then
  echo -e "${RED}Build failed for the following servers:${NC}"
  for server in "${FAILED_SERVERS[@]}"; do
    echo -e "  ${RED}FAIL $server${NC}"
  done
  echo ""
  echo "Fix the TypeScript compilation errors and try again."
  exit 1
fi

echo -e "${GREEN}All MCP servers built successfully!${NC}"
exit 0
