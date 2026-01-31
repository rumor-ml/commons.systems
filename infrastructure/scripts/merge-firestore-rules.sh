#!/bin/bash
set -euo pipefail

# Merge Firestore rules from multiple apps into a single deployment file
# Usage: merge-firestore-rules.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

OUTPUT_DIR="$REPO_ROOT/.firebase"
OUTPUT_FILE="$OUTPUT_DIR/firestore.rules"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "Merging Firestore rules..."

# Restore source rules files if they were renamed (from previous merge run)
[ -f "$REPO_ROOT/fellspiral/firestore.rules.source" ] && mv "$REPO_ROOT/fellspiral/firestore.rules.source" "$REPO_ROOT/fellspiral/firestore.rules"
[ -f "$REPO_ROOT/budget/firestore.rules.source" ] && mv "$REPO_ROOT/budget/firestore.rules.source" "$REPO_ROOT/budget/firestore.rules"

# Start with rules version and shared helper functions
cat > "$OUTPUT_FILE" << 'EOF'
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // ========================================
    // Shared Helper Functions
    // ========================================

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    // ========================================
    // FELLSPIRAL APP RULES
    // ========================================
EOF

# Extract app-specific helpers and match blocks from fellspiral/firestore.rules
# Strategy: Extract everything after "match /databases" line, remove shared helpers, remove final closing braces
awk '
  BEGIN { inside_db=0; inside_shared_func=0; brace_count=0; total_lines=0; pending_line=""; db_depth=0 }

  # Start capturing after database match line
  /^[[:space:]]*match \/databases.*{/ { inside_db=1; db_depth=1; next }

  inside_db {
    # Track database match block depth to know when we exit it
    # Make a copy to count braces without modifying the original line
    line_copy = $0
    db_open = gsub(/{/, "{", line_copy)
    db_close = gsub(/}/, "}", line_copy)
    db_depth += db_open
    db_depth -= db_close

    # If we have closed the database match block, stop capturing
    if (db_depth <= 0) {
      inside_db = 0
      next
    }

    # Check if next line is a shared helper function
    # If current line is a comment and next line is shared helper, skip both
    if ($0 ~ /^[[:space:]]*\/\/ Helper: Check if user is authenticated/ ||
        $0 ~ /^[[:space:]]*\/\/ Helper: Check if user owns the document/) {
      next
    }

    # Track if were inside a shared helper function
    if ($0 ~ /^[[:space:]]*function isAuthenticated\(\)/ || $0 ~ /^[[:space:]]*function isOwner\(/) {
      inside_shared_func=1
      func_braces=1  # Start with 1 because the opening brace is usually on the same line or we count it
      next
    }

    # If inside shared function, count braces to know when it ends
    if (inside_shared_func) {
      # Count braces on this line (use a copy to avoid modifying $0)
      func_copy = $0
      open_count = gsub(/{/, "{", func_copy)
      close_count = gsub(/}/, "}", func_copy)
      func_braces += open_count
      func_braces -= close_count
      if (func_braces <= 0) {
        inside_shared_func=0
      }
      next
    }

    # Store all other lines
    lines[total_lines++] = $0
  }

  END {
    # Print all lines except:
    # 1. The final "  }" that closes the database match block
    # 2. The deny-all rule and its comment (well add it once at the end of the merged file)
    skip_deny_all = 0
    for (i=0; i<total_lines; i++) {
      # Skip "// Deny all other access" comment
      if (lines[i] ~ /^[[:space:]]*\/\/ Deny all other access/) {
        continue
      }

      # Check if this is deny-all rule (single-line or multi-line)
      if (lines[i] ~ /^[[:space:]]*match \/\{document=\*\*\}/) {
        # Check if its a single-line version (ends with closing brace after semicolon)
        if (lines[i] ~ /;[[:space:]]*}[[:space:]]*$/) {
          # Single line deny-all, skip it and continue
          continue
        } else {
          # Multi-line deny-all, skip until we find the closing brace
          skip_deny_all = 1
          continue
        }
      }

      # If were skipping multi-line deny-all, look for closing brace
      if (skip_deny_all) {
        if (lines[i] ~ /^[[:space:]]*}[[:space:]]*$/) {
          skip_deny_all = 0
        }
        continue
      }

      # Skip standalone closing brace with 2-space indent near the end (database match closer)
      if (lines[i] ~ /^[[:space:]][[:space:]]}[[:space:]]*$/ && i >= total_lines - 3) {
        continue
      }

      print lines[i]
    }
  }
' "$REPO_ROOT/fellspiral/firestore.rules" >> "$OUTPUT_FILE"

# Add section separator
cat >> "$OUTPUT_FILE" << 'EOF'

    // ========================================
    // BUDGET APP RULES
    // ========================================
EOF

# Extract app-specific helpers and match blocks from budget/firestore.rules
# Strategy: Extract everything after "match /databases" line, remove shared helpers, remove final closing braces
awk '
  BEGIN { inside_db=0; inside_shared_func=0; brace_count=0; total_lines=0 }

  # Start capturing after database match line
  /^[[:space:]]*match \/databases.*{/ { inside_db=1; next }

  inside_db {
    # Track if were inside a shared helper function
    if ($0 ~ /^[[:space:]]*function isAuthenticated\(\)/) {
      inside_shared_func=1
      func_braces=0
      next
    }
    if ($0 ~ /^[[:space:]]*function isOwner\(/) {
      inside_shared_func=1
      func_braces=0
      next
    }

    # If inside shared function, count braces to know when it ends
    if (inside_shared_func) {
      func_braces += gsub(/{/, "&")
      func_braces -= gsub(/}/, "&")
      if (func_braces <= 0) {
        inside_shared_func=0
      }
      next
    }

    # Store all other lines
    lines[total_lines++] = $0

    # Track overall brace depth
    brace_count += gsub(/{/, "&")
    brace_count -= gsub(/}/, "&")
  }

  END {
    # Print all lines except:
    # 1. The final "  }" that closes the database match block
    # 2. The deny-all rule and its comment (well add it once at the end of the merged file)
    skip_deny_all = 0
    for (i=0; i<total_lines; i++) {
      # Skip "// Deny all other access" comment
      if (lines[i] ~ /^[[:space:]]*\/\/ Deny all other access/) {
        continue
      }

      # Check if this is deny-all rule (single-line or multi-line)
      if (lines[i] ~ /^[[:space:]]*match \/\{document=\*\*\}/) {
        # Check if its a single-line version (ends with closing brace after semicolon)
        if (lines[i] ~ /;[[:space:]]*}[[:space:]]*$/) {
          # Single line deny-all, skip it and continue
          continue
        } else {
          # Multi-line deny-all, skip until we find the closing brace
          skip_deny_all = 1
          continue
        }
      }

      # If were skipping multi-line deny-all, look for closing brace
      if (skip_deny_all) {
        if (lines[i] ~ /^[[:space:]]*}[[:space:]]*$/) {
          skip_deny_all = 0
        }
        continue
      }

      # Skip standalone closing brace with 2-space indent near the end (database match closer)
      if (lines[i] ~ /^[[:space:]][[:space:]]}[[:space:]]*$/ && i >= total_lines - 3) {
        continue
      }

      print lines[i]
    }
  }
' "$REPO_ROOT/budget/firestore.rules" >> "$OUTPUT_FILE"

# Add deny-all rule and close the service block
cat >> "$OUTPUT_FILE" << 'EOF'

    // Deny all other access
    match /{document=**} { allow read, write: if false; }
  }
}
EOF

# Clean up orphaned closing braces (standalone } lines between LIMITATION and deny-all)
awk '
  /^}$/ { pending_brace = NR; next }
  pending_brace && /^[[:space:]]*\/\/ Deny all other access/ {
    pending_brace = 0
  }
  pending_brace && NF > 0 && !/^[[:space:]]*$/ {
    print "}"
    pending_brace = 0
  }
  { if (!pending_brace || NF > 0) print }
  END { if (pending_brace) print "}" }
' "$OUTPUT_FILE" > "$OUTPUT_FILE.tmp" && mv "$OUTPUT_FILE.tmp" "$OUTPUT_FILE"

# Validate brace balance
OPEN_BRACES=$(grep -o '{' "$OUTPUT_FILE" | wc -l)
CLOSE_BRACES=$(grep -o '}' "$OUTPUT_FILE" | wc -l)

if [ "$OPEN_BRACES" != "$CLOSE_BRACES" ]; then
  echo "❌ ERROR: Merged rules have unbalanced braces"
  echo "   Opening braces: $OPEN_BRACES"
  echo "   Closing braces: $CLOSE_BRACES"
  echo "   Difference: $((OPEN_BRACES - CLOSE_BRACES))"
  exit 1
fi

echo "✓ Brace validation passed ($OPEN_BRACES pairs)"

echo "✓ Merged rules written to: $OUTPUT_FILE"

# Validate syntax by attempting to parse with firebase CLI if available
if command -v firebase &> /dev/null; then
  echo "Validating rules syntax..."
  cd "$REPO_ROOT"
  firebase firestore:rules:release --dry-run 2>&1 | grep -q "Rules syntax OK" && echo "✓ Rules syntax valid" || echo "⚠ Warning: Could not validate rules syntax"
fi

echo "Merged the following rule files:"
echo "  - fellspiral/firestore.rules"
echo "  - budget/firestore.rules"

# CRITICAL FIX: Rename source rules files to prevent emulator from accidentally loading them
# The emulator should ONLY load from .firebase/firestore.rules (merged file)
# Background: Firebase CLI may discover and load app-level firestore.rules files
# even when --config explicitly points to root firebase.json
mv "$REPO_ROOT/fellspiral/firestore.rules" "$REPO_ROOT/fellspiral/firestore.rules.source" 2>/dev/null || true
mv "$REPO_ROOT/budget/firestore.rules" "$REPO_ROOT/budget/firestore.rules.source" 2>/dev/null || true
echo "✓ Renamed source rules files to .source (prevents accidental emulator loading)"

# CRITICAL FIX: Clear Firestore emulator cache to force reload of rules
# The emulator may cache compiled rules, and the cache key in CI doesn't include rules content
# This ensures the emulator loads the freshly merged rules instead of stale cached rules
if [ -d "$HOME/.cache/firebase/emulators" ]; then
  # Remove any firestore-related cache files but keep emulator binaries
  find "$HOME/.cache/firebase/emulators" -name "*firestore*" -type f -delete 2>/dev/null || true
  echo "✓ Cleared Firestore emulator cache"
fi
