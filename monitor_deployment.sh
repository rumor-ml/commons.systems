#!/bin/bash

# Quick monitoring script
BRANCH="claude/feature-branch-deployment-arch-019Bp7RmAk58Fbv52e1gU7nm"

if [ -z "$GITHUB_PAT" ]; then
  echo "Error: GITHUB_PAT environment variable not set"
  echo "Set it with: export GITHUB_PAT=your_token"
  exit 1
fi

echo "Monitoring deployment on branch: $BRANCH"
echo "Press Ctrl+C to stop"
echo ""

while true; do
  clear
  echo "=== Deployment Status ($(date)) ==="
  echo ""
  
  curl -s -H "Authorization: Bearer $GITHUB_PAT" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?per_page=10" | python3 << 'PYTHON'
import sys, json
from datetime import datetime

data = json.loads(sys.stdin.read())
runs = data.get('workflow_runs', [])

our_branch = 'claude/feature-branch-deployment-arch-019Bp7RmAk58Fbv52e1gU7nm'
branch_runs = [r for r in runs if r.get('head_branch') == our_branch]

if branch_runs:
    latest = branch_runs[0]
    status = latest.get('status')
    conclusion = latest.get('conclusion')
    
    if conclusion == 'success':
        emoji = '✅'
        print('🎉 DEPLOYMENT SUCCESSFUL!')
    elif conclusion == 'failure':
        emoji = '❌'
        print('❌ DEPLOYMENT FAILED')
    elif status == 'in_progress':
        emoji = '🔄'
        print('🔄 DEPLOYMENT IN PROGRESS...')
    elif status == 'queued':
        emoji = '⏳'
        print('⏳ DEPLOYMENT QUEUED...')
    else:
        emoji = '❓'
        print(f'❓ STATUS: {status}')
    
    print(f'\nWorkflow: {latest["name"]}')
    print(f'Commit: {latest["head_sha"][:7]}')
    if conclusion:
        print(f'Result: {conclusion}')
    print(f'URL: {latest["html_url"]}')
else:
    print('⏳ Waiting for workflows to start...')
    print('(Workflows typically start within 30 seconds of push)')
PYTHON

  sleep 10
done
