#!/bin/bash
# Cleanup stale Firebase Hosting preview channels to avoid quota errors
# Deletes channels for PRs that are closed/merged

set -e

SITE_NAME="${1}"
CURRENT_BRANCH="${2}"

if [ -z "$SITE_NAME" ]; then
    echo "Usage: $0 <site-name> [current-branch]"
    exit 1
fi

# Map site names to Firebase site IDs
case "$SITE_NAME" in
    videobrowser) FIREBASE_SITE_ID="videobrowser-7696a" ;;
    print) FIREBASE_SITE_ID="print-dfb47" ;;
    *) FIREBASE_SITE_ID="$SITE_NAME" ;;
esac

echo "🧹 Cleaning up stale preview channels for ${FIREBASE_SITE_ID}..."
if [ -n "$CURRENT_BRANCH" ]; then
    echo "🛡️  Protected branch: ${CURRENT_BRANCH} (will not be deleted)"
fi

# Get list of all preview channels
CHANNELS=$(firebase hosting:channel:list \
    --site "${FIREBASE_SITE_ID}" \
    --project chalanding \
    --json 2>/dev/null || echo "[]")

if [ "$CHANNELS" = "[]" ]; then
    echo "No channels found or unable to list channels"
    exit 0
fi

# Parse channel names and check if corresponding PR is closed
echo "$CHANNELS" | jq -r '.result.channels[].name' | while read -r channel_path; do
    # Extract channel name from full path (projects/.../channels/138-merge -> 138-merge)
    channel=$(basename "$channel_path")

    # Sanitize current branch to match Firebase channel naming (for comparison)
    if [ -n "$CURRENT_BRANCH" ]; then
        SANITIZED_CURRENT=$(echo "$CURRENT_BRANCH" | \
            tr '[:upper:]' '[:lower:]' | \
            sed 's/[^a-z0-9-]/-/g' | \
            sed 's/-\+/-/g' | \
            sed 's/^-//' | \
            sed 's/-$//' | \
            cut -c1-63)

        # Skip deletion if this is the current branch being deployed
        if [ "$channel" = "$SANITIZED_CURRENT" ]; then
            echo "🛡️  Skipping channel ${channel} (currently being deployed)"
            continue
        fi
    fi

    # Extract PR number from channel name (e.g., "138-merge" -> "138")
    PR_NUM=$(echo "$channel" | grep -oE '^[0-9]+' || echo "")

    if [ -z "$PR_NUM" ]; then
        echo "ℹ️  Skipping channel ${channel} (not a PR channel)"
        continue
    fi

    # Check if this is actually a PR (not an issue)
    # Only delete if we can confirm the PR exists AND is closed
    if ! gh pr view "$PR_NUM" --json state,number -q .state >/dev/null 2>&1; then
        echo "ℹ️  Skipping channel ${channel} (PR #${PR_NUM} not found - may be an issue number)"
        continue
    fi

    # Get PR state (we know the PR exists at this point)
    PR_STATE=$(gh pr view "$PR_NUM" --json state -q .state 2>/dev/null)

    if [ "$PR_STATE" != "OPEN" ]; then
        echo "🗑️  Deleting channel ${channel} (PR #${PR_NUM} is ${PR_STATE})"
        firebase hosting:channel:delete "$channel" \
            --site "${FIREBASE_SITE_ID}" \
            --project chalanding \
            --force || echo "⚠️  Failed to delete ${channel}"
    else
        echo "✅ Keeping channel ${channel} (PR #${PR_NUM} is open)"
    fi
done

# Clean up merge queue channels (they don't persist beyond the queue run)
echo "$CHANNELS" | jq -r '.result.channels[] | select(.name | contains("gh-readonly-queue")) | .name' | while read -r channel_path; do
    channel=$(basename "$channel_path")
    echo "🗑️  Deleting merge queue channel ${channel}"
    firebase hosting:channel:delete "$channel" \
        --site "${FIREBASE_SITE_ID}" \
        --project chalanding \
        --force || echo "Failed to delete ${channel}"
done

echo "✅ Cleanup complete"
