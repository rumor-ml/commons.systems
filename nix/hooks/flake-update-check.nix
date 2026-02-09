{ }:

''
  _check_flake_updates() {
    # Only run in interactive shells
    [ -t 1 ] || return 0

    # Cache file and expiry (24 hours)
    CACHE_DIR="$HOME/.cache/nix-flake-update-check"
    CACHE_FILE="$CACHE_DIR/last-check"
    CACHE_EXPIRY=86400  # 24 hours in seconds

    # Create cache directory if needed
    mkdir -p "$CACHE_DIR" 2>/dev/null || true

    # Check if cache is fresh
    if [ -f "$CACHE_FILE" ]; then
      LAST_CHECK=$(cat "$CACHE_FILE" 2>/dev/null || echo "0")
      NOW=$(date +%s)
      ELAPSED=$((NOW - LAST_CHECK))

      if [ "$ELAPSED" -lt "$CACHE_EXPIRY" ]; then
        # Cache is fresh, skip check
        return 0
      fi
    fi

    # Get current flake metadata
    FLAKE_META=$(nix flake metadata --json 2>/dev/null) || return 0

    # Track updates (array)
    UPDATES=()

    # Check nixpkgs
    NIXPKGS_LOCKED=$(echo "$FLAKE_META" | jq -r '.locks.nodes.nixpkgs.locked.rev // empty' 2>/dev/null)
    if [ -n "$NIXPKGS_LOCKED" ]; then
      NIXPKGS_LATEST=$(nix flake metadata nixpkgs --json 2>/dev/null | jq -r '.revision // empty' 2>/dev/null)
      if [ -n "$NIXPKGS_LATEST" ] && [ "$NIXPKGS_LOCKED" != "$NIXPKGS_LATEST" ]; then
        UPDATES+=("nixpkgs")
      fi
    fi

    # Check home-manager
    HM_LOCKED=$(echo "$FLAKE_META" | jq -r '.locks.nodes."home-manager".locked.rev // empty' 2>/dev/null)
    if [ -n "$HM_LOCKED" ]; then
      HM_LATEST=$(nix flake metadata home-manager --json 2>/dev/null | jq -r '.revision // empty' 2>/dev/null)
      if [ -n "$HM_LATEST" ] && [ "$HM_LOCKED" != "$HM_LATEST" ]; then
        UPDATES+=("home-manager")
      fi
    fi

    # Check claude-code-nix
    CLAUDE_LOCKED=$(echo "$FLAKE_META" | jq -r '.locks.nodes."claude-code-nix".locked.rev // empty' 2>/dev/null)
    if [ -n "$CLAUDE_LOCKED" ]; then
      CLAUDE_LATEST=$(nix flake metadata github:sadjow/claude-code-nix --json 2>/dev/null | jq -r '.revision // empty' 2>/dev/null)
      if [ -n "$CLAUDE_LATEST" ] && [ "$CLAUDE_LOCKED" != "$CLAUDE_LATEST" ]; then
        UPDATES+=("claude-code-nix")
      fi
    fi

    # Update cache timestamp
    date +%s > "$CACHE_FILE" 2>/dev/null || true

    # Display warning if updates found
    if [ ''${#UPDATES[@]} -gt 0 ]; then
      echo ""
      echo "╔═══════════════════════════════════════════════════════════╗"
      echo "║  ⚠  Flake Updates Available                               ║"
      echo "╠═══════════════════════════════════════════════════════════╣"
      echo "║  The following inputs have upstream updates:              ║"
      echo "║                                                           ║"
      for update in "''${UPDATES[@]}"; do
        printf "║    • %-51s ║\n" "$update"
      done
      echo "║                                                           ║"
      echo "║  To update, run:                                          ║"
      echo "║                                                           ║"
      echo "║    1. nix flake update                                    ║"
      echo "║    2. nix develop --rebuild                               ║"
      echo "║    3. home-manager switch --flake .#default --impure      ║"
      echo "║                                                           ║"
      echo "║  (This check runs once per 24 hours)                      ║"
      echo "╚═══════════════════════════════════════════════════════════╝"
      echo ""
    fi
  }

  _check_flake_updates
''
