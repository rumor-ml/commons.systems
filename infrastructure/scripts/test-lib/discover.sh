#!/bin/bash
# Module discovery with enhanced MCP server support
# Wraps and enhances discover-apps.sh functionality

# Source the original discover-apps.sh
DISCOVER_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${DISCOVER_SCRIPT_DIR}/../discover-apps.sh"

# Discover MCP servers
# Output format: server_name:mcp-server:server_path (one per line)
discover_mcp_servers() {
  local root_dir="$1"
  local name_filter="$2"

  # Look for *-mcp-server directories with package.json that has test script
  for dir in "$root_dir"/*-mcp-server/; do
    [[ ! -d "$dir" ]] && continue

    local name=$(basename "$dir")

    # Apply name filter
    [[ -n "$name_filter" && "$name" != "$name_filter" ]] && continue

    # Check for package.json with test script
    local pkg_json="${dir}package.json"
    if [[ -f "$pkg_json" ]]; then
      # Check if package.json has a test script
      if grep -q '"test"' "$pkg_json" 2>/dev/null; then
        echo "$name:mcp-server:$dir"
      fi
    fi
  done
}

# Enhanced discover_all that includes MCP servers
discover_all_modules() {
  local root_dir="$1"
  local type_filter="$2"
  local name_filter="$3"

  # Discover apps (firebase, go-fullstack, go-tui, go-package)
  if [[ -z "$type_filter" || "$type_filter" != "mcp-server" ]]; then
    discover_apps "$root_dir" "$type_filter" "$name_filter"
  fi

  # Discover MCP servers
  if [[ -z "$type_filter" || "$type_filter" == "mcp-server" ]]; then
    discover_mcp_servers "$root_dir" "$name_filter"
  fi
}

# JSON output format for modules
# Usage: discover_all_modules_json <root_dir> [type_filter] [name_filter]
discover_all_modules_json() {
  local root_dir="$1"
  local type_filter="$2"
  local name_filter="$3"

  echo "["
  local first=true

  while IFS=: read -r name type path; do
    if [ "$first" = true ]; then
      first=false
    else
      echo ","
    fi

    # Determine available test types
    local has_unit=false
    local has_e2e=false
    local has_deployed_e2e=false

    case "$type" in
      firebase)
        has_e2e=true
        has_deployed_e2e=true
        ;;
      go-fullstack)
        has_unit=true
        has_e2e=true
        has_deployed_e2e=true
        ;;
      go-tui)
        has_unit=true
        has_e2e=true
        ;;
      go-package)
        has_unit=true
        ;;
      mcp-server)
        has_unit=true
        ;;
    esac

    # Output JSON object
    cat <<EOF
  {
    "name": "$name",
    "type": "$type",
    "path": "$path",
    "tests": {
      "unit": $has_unit,
      "e2e": $has_e2e,
      "deployed_e2e": $has_deployed_e2e
    }
  }
EOF
  done < <(discover_all_modules "$root_dir" "$type_filter" "$name_filter")

  echo ""
  echo "]"
}
