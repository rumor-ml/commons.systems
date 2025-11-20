#!/usr/bin/env python3
"""Check GitHub Actions workflow status for the current branch."""

import os
import sys
import json
import urllib.request

def check_workflows():
    token = os.environ.get('GITHUB_TOKEN')
    if not token:
        print("GITHUB_TOKEN not available. Please check manually at:")
        print("https://github.com/rumor-ml/commons.systems/actions")
        return

    url = "https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?per_page=5"
    headers = {'Authorization': f'token {token}'}

    try:
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read())

        runs = data.get('workflow_runs', [])[:5]

        print("\n=== Recent Workflow Runs ===\n")
        for r in runs:
            status_emoji = {
                'success': '✅',
                'failure': '❌',
                'cancelled': '⚠️'
            }.get(r.get('conclusion'), '🔄')

            print(f"{status_emoji} {r['name']}")
            print(f"   Status: {r['status']}")
            if r.get('conclusion'):
                print(f"   Conclusion: {r['conclusion']}")
            print(f"   Branch: {r['head_branch']}")
            print(f"   Commit: {r['head_sha'][:7]}")
            print(f"   Started: {r['created_at']}")
            print(f"   URL: {r['html_url']}")
            print()

    except Exception as e:
        print(f"Error fetching workflows: {e}")
        print("\nPlease check manually at:")
        print("https://github.com/rumor-ml/commons.systems/actions")

if __name__ == '__main__':
    check_workflows()
