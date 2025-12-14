#!/bin/bash
# Discover apps by convention
# Output format: app_name:app_type:app_path (one per line)

discover_apps() {
  local root_dir="$1"
  local type_filter="$2"
  local name_filter="$3"

  # Firebase apps: has site/ + tests/playwright.config.ts
  for dir in "$root_dir"/*/; do
    local name=$(basename "$dir")

    # Skip non-app directories
    [[ "$name" == "node_modules" ]] && continue
    [[ "$name" == "infrastructure" ]] && continue
    [[ "$name" == "scaffolding" ]] && continue
    [[ "$name" == "pkg" ]] && continue
    [[ "$name" == "shared" ]] && continue
    [[ "$name" == "playwright-server" ]] && continue
    [[ "$name" == "bin" ]] && continue
    [[ "$name" == ".github" ]] && continue
    [[ "$name" == ".devcontainer" ]] && continue
    [[ "$name" == ".direnv" ]] && continue
    [[ "$name" == ".claude" ]] && continue

    # Apply name filter
    [[ -n "$name_filter" && "$name" != "$name_filter" ]] && continue

    local app_type=""

    # Detect Firebase app
    if [[ -d "$dir/site" && -f "$dir/tests/playwright.config.ts" && -f "$dir/site/package.json" && ! -f "$dir/site/go.mod" ]]; then
      app_type="firebase"
    # Detect Go fullstack app
    elif [[ -f "$dir/site/go.mod" && -f "$dir/tests/playwright.config.ts" ]]; then
      app_type="go-fullstack"
    # Detect Go TUI app
    elif [[ -f "$dir/go.mod" && -f "$dir/Makefile" && -d "$dir/internal" && ! -f "$dir/tests/playwright.config.ts" ]]; then
      app_type="go-tui"
    fi

    # Apply type filter
    [[ -n "$type_filter" && "$app_type" != "$type_filter" ]] && continue

    [[ -n "$app_type" ]] && echo "$name:$app_type:$dir"
  done

  # Go packages in pkg/
  for dir in "$root_dir"/pkg/*/; do
    local name=$(basename "$dir")
    [[ -n "$name_filter" && "$name" != "$name_filter" ]] && continue
    [[ -n "$type_filter" && "$type_filter" != "go-package" ]] && continue

    if [[ -f "$dir/go.mod" ]]; then
      echo "$name:go-package:$dir"
    fi
  done

  # MCP servers: *-mcp-server directories with package.json that has test script
  if [[ -z "$type_filter" || "$type_filter" == "mcp-server" ]]; then
    for dir in "$root_dir"/*-mcp-server/; do
      [[ ! -d "$dir" ]] && continue
      local name=$(basename "$dir")

      # Apply name filter
      [[ -n "$name_filter" && "$name" != "$name_filter" ]] && continue

      # Check for package.json with test script
      local pkg_json="${dir}package.json"
      if [[ -f "$pkg_json" ]]; then
        if grep -q '"test"' "$pkg_json" 2>/dev/null; then
          echo "$name:mcp-server:$dir"
        fi
      fi
    done
  fi
}
