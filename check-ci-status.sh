#!/bin/bash
# Check CI workflow status for this branch using GitHub API
#
# Usage: GITHUB_TOKEN=your_token ./check-ci-status.sh

set -e

if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN environment variable not set"
    echo ""
    echo "Usage:"
    echo "  GITHUB_TOKEN=github_pat_xxxxx ./check-ci-status.sh"
    echo ""
    echo "Or set it first:"
    echo "  export GITHUB_TOKEN=github_pat_xxxxx"
    echo "  ./check-ci-status.sh"
    exit 1
fi

REPO="rumor-ml/commons.systems"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

echo "🔍 Checking CI status for commons.systems"
echo "📌 Branch: $BRANCH"
echo ""

# Get recent workflow runs
echo "📡 Querying GitHub API..."
RESPONSE=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/actions/runs?per_page=10")

# Check for API errors
if echo "$RESPONSE" | jq -e '.message' > /dev/null 2>&1; then
    ERROR_MSG=$(echo "$RESPONSE" | jq -r '.message')
    echo "❌ GitHub API Error: $ERROR_MSG"
    exit 1
fi

# Filter for CI workflow runs on this branch
echo "$RESPONSE" | jq -r --arg branch "$BRANCH" '
.workflow_runs[] |
select(.name == "CI - Test Suite" and .head_branch == $branch) |
"
=== Run #\(.run_number) ===
Status: \(.status)
Conclusion: \(.conclusion // "in progress")
Created: \(.created_at)
Updated: \(.updated_at)
Commit: \(.head_sha[0:7]) - \(.head_commit.message | split("\n")[0])
URL: \(.html_url)
"' | head -50

# Get the latest run for this branch
LATEST_RUN=$(echo "$RESPONSE" | jq -r --arg branch "$BRANCH" '
.workflow_runs[] |
select(.name == "CI - Test Suite" and .head_branch == $branch) |
@json' | head -1)

if [ -z "$LATEST_RUN" ] || [ "$LATEST_RUN" = "null" ]; then
    echo "⚠️  No CI workflow runs found for branch: $BRANCH"
    echo ""
    echo "This could mean:"
    echo "  - The workflow hasn't triggered yet"
    echo "  - The branch name doesn't match"
    echo "  - No commits have been pushed"
    exit 0
fi

# Get details of the latest run
RUN_ID=$(echo "$LATEST_RUN" | jq -r '.id')
RUN_NUMBER=$(echo "$LATEST_RUN" | jq -r '.run_number')
STATUS=$(echo "$LATEST_RUN" | jq -r '.status')
CONCLUSION=$(echo "$LATEST_RUN" | jq -r '.conclusion')

echo ""
echo "=== Latest CI Run Details ==="
echo "Run ID: $RUN_ID"
echo "Status: $STATUS"
echo "Conclusion: ${CONCLUSION:-in progress}"
echo ""

# Get jobs for this run
echo "📋 Fetching job details..."
JOBS=$(curl -s -H "Authorization: token $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/actions/runs/$RUN_ID/jobs")

# Show job steps
echo "$JOBS" | jq -r '.jobs[] |
"
Job: \(.name)
Status: \(.status)
Conclusion: \(.conclusion // "in progress")

Steps:
" + (.steps[] | "  [\(.conclusion // "pending")] \(.name)") + "
"'

# Check for Playwright server usage
echo ""
echo "=== Verifying Playwright Server Usage ==="
echo "$JOBS" | jq -r '.jobs[].steps[] | select(.name | contains("Playwright") or contains("playwright"))  | "✓ \(.name) - \(.conclusion // "pending")"'

# Get logs URL
LOGS_URL=$(echo "$JOBS" | jq -r '.jobs[0].url')
echo ""
echo "📄 View full logs at:"
echo "https://github.com/$REPO/actions/runs/$RUN_ID"
