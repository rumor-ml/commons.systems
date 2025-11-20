#!/bin/bash

# Use GITHUB_TOKEN from environment, or GITHUB_PAT if that's set
TOKEN="${GITHUB_TOKEN:-${GITHUB_PAT}}"
BRANCH="claude/feature-branch-deployment-arch-019Bp7RmAk58Fbv52e1gU7nm"

if [ -z "$TOKEN" ]; then
  echo "Error: GITHUB_TOKEN or GITHUB_PAT environment variable not set"
  echo "Set it with: export GITHUB_TOKEN=<your-token>"
  exit 1
fi

echo "=== Checking Deployment Status ==="
echo ""

# Get latest runs
RUNS=$(curl -s -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?per_page=10")

echo "$RUNS" | python3 << 'PYTHON_SCRIPT'
import sys, json

data = json.loads(sys.stdin.read())
runs = data.get('workflow_runs', [])

our_branch = 'claude/feature-branch-deployment-arch-019Bp7RmAk58Fbv52e1gU7nm'
branch_runs = [r for r in runs if r.get('head_branch') == our_branch]

print(f'Found {len(branch_runs)} workflows for branch\n')

for r in branch_runs[:5]:
    emoji = '✅' if r.get('conclusion') == 'success' else '❌' if r.get('conclusion') == 'failure' else '🔄' if r.get('status') == 'in_progress' else '⏳'
    print(f'{emoji} {r["name"]}')
    print(f'   Status: {r["status"]}')
    if r.get('conclusion'):
        print(f'   Result: {r["conclusion"]}')
    print(f'   Commit: {r["head_sha"][:7]}')
    print(f'   URL: {r["html_url"]}')
    print()
PYTHON_SCRIPT
