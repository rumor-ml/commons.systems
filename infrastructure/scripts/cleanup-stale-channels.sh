#!/bin/bash
# Cleanup stale Firebase Hosting preview channels to avoid quota errors
# Deletes channels for PRs that are closed/merged

set -e

SITE_NAME="${1}"
if [ -z "$SITE_NAME" ]; then
    echo "Usage: $0 <site-name>"
    exit 1
fi

# Map site names to Firebase site IDs
case "$SITE_NAME" in
    videobrowser) FIREBASE_SITE_ID="videobrowser-7696a" ;;
    print) FIREBASE_SITE_ID="print-dfb47" ;;
    *) FIREBASE_SITE_ID="$SITE_NAME" ;;
esac

echo "🧹 Cleaning up stale preview channels for ${FIREBASE_SITE_ID}..."

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

    # Extract PR number from channel name (e.g., "138-merge" -> "138")
    PR_NUM=$(echo "$channel" | grep -oE '^[0-9]+' || echo "")

    if [ -z "$PR_NUM" ]; then
        echo "Skipping channel ${channel} (not a PR channel)"
        continue
    fi

    # Check if PR is still open
    PR_STATE=$(gh pr view "$PR_NUM" --json state -q .state 2>/dev/null || echo "CLOSED")

    if [ "$PR_STATE" != "OPEN" ]; then
        echo "🗑️  Deleting channel ${channel} (PR #${PR_NUM} is ${PR_STATE})"
        firebase hosting:channel:delete "$channel" \
            --site "${FIREBASE_SITE_ID}" \
            --project chalanding \
            --force || echo "Failed to delete ${channel}"
    else
        echo "✅ Keeping channel ${channel} (PR #${PR_NUM} is open)"
    fi
done

echo "✅ Cleanup complete"
