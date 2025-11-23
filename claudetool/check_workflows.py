#!/usr/bin/env python3
"""
Check GitHub Actions workflow status with optional monitoring.

Usage:
    ./check_workflows.py                    # Check recent workflows (all branches)
    ./check_workflows.py --branch <name>    # Check workflows for specific branch
    ./check_workflows.py --branch <name> --monitor  # Monitor until completion (RECOMMENDED)

IMPORTANT: Use --monitor to automatically wait for workflows to complete.
           This prevents the need for manual polling loops in bash.
"""

import os
import sys
import json
import time
import urllib.request
from datetime import datetime
import argparse


def get_github_token():
    """Get GitHub token from environment."""
    return os.environ.get('GITHUB_TOKEN') or os.environ.get('GITHUB_PAT')


def fetch_workflows(token, per_page=10):
    """Fetch recent workflow runs."""
    url = f"https://api.github.com/repos/rumor-ml/commons.systems/actions/runs?per_page={per_page}"
    headers = {
        'Authorization': f'token {token}',
        'Accept': 'application/vnd.github+json'
    }

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=10) as response:
        data = json.loads(response.read())
        return data.get('workflow_runs', [])


def format_workflow(run):
    """Format a workflow run for display."""
    status_emoji = {
        'success': '✅',
        'failure': '❌',
        'cancelled': '⚠️',
        'in_progress': '🔄',
        'queued': '⏳'
    }

    status = run.get('status')
    conclusion = run.get('conclusion')
    emoji = status_emoji.get(conclusion or status, '❓')

    lines = [
        f"{emoji} {run['name']}",
        f"   Branch: {run['head_branch']}",
        f"   Status: {status}",
    ]

    if conclusion:
        lines.append(f"   Result: {conclusion}")

    lines.extend([
        f"   Commit: {run['head_sha'][:7]}",
        f"   Started: {run['created_at']}",
        f"   URL: {run['html_url']}"
    ])

    return '\n'.join(lines)


def check_workflows(branch=None, count=5):
    """Check recent workflows, optionally filtered by branch."""
    token = get_github_token()
    if not token:
        print("❌ GITHUB_TOKEN or GITHUB_PAT not set")
        print("\nPlease set one of these environment variables:")
        print("  export GITHUB_TOKEN=<your-token>")
        print("\nOr check manually at:")
        print("  https://github.com/rumor-ml/commons.systems/actions")
        return False

    try:
        runs = fetch_workflows(token, per_page=20)

        if branch:
            runs = [r for r in runs if r.get('head_branch') == branch]
            if not runs:
                print(f"⚠️  No workflows found for branch: {branch}")
                return False

        runs = runs[:count]

        print(f"\n=== Recent Workflows {'(branch: ' + branch + ')' if branch else ''} ===\n")

        # Check if any workflows are in progress or queued
        has_active = False
        for run in runs:
            print(format_workflow(run))
            print()

            status = run.get('status')
            if status in ('in_progress', 'queued'):
                has_active = True

        # Provide helpful hint for active workflows
        if has_active:
            print("=" * 70)
            print("💡 TIP: Workflow is still running!")
            print("=" * 70)
            print("\nTo automatically monitor until completion, use:")
            if branch:
                print(f"  ./claudetool/check_workflows.py --branch {branch} --monitor")
            else:
                print(f"  ./claudetool/check_workflows.py --monitor")
            print("\nThis prevents bash syntax errors from manual polling loops.")
            print("=" * 70)
            print()

        return True

    except Exception as e:
        print(f"❌ Error fetching workflows: {e}")
        print("\nPlease check manually at:")
        print("  https://github.com/rumor-ml/commons.systems/actions")
        return False


def monitor_workflows(branch=None, interval=10):
    """Continuously monitor the latest workflow."""
    token = get_github_token()
    if not token:
        print("❌ GITHUB_TOKEN or GITHUB_PAT not set")
        print("\nPlease set one of these environment variables:")
        print("  export GITHUB_TOKEN=<your-token>")
        return False

    print(f"Monitoring workflows {'for branch: ' + branch if branch else '(all branches)'}")
    print("Press Ctrl+C to stop\n")

    last_run_id = None

    try:
        while True:
            try:
                runs = fetch_workflows(token, per_page=10)

                if branch:
                    runs = [r for r in runs if r.get('head_branch') == branch]

                if not runs:
                    print(f"⏳ Waiting for workflows to start...")
                    print(f"   (Last checked: {datetime.now().strftime('%H:%M:%S')})")
                else:
                    latest = runs[0]

                    # Clear screen and show current status
                    if latest['id'] != last_run_id:
                        last_run_id = latest['id']
                        print("\n" + "="*70)
                        print(f"NEW WORKFLOW DETECTED - {datetime.now().strftime('%H:%M:%S')}")
                        print("="*70)
                    else:
                        # Use carriage return to update same line
                        print(f"\r⏱  Last update: {datetime.now().strftime('%H:%M:%S')}", end='', flush=True)

                    status = latest.get('status')
                    conclusion = latest.get('conclusion')

                    # Check if workflow is completed (any conclusion)
                    if status == 'completed':
                        if conclusion == 'success':
                            print("\n\n🎉 DEPLOYMENT SUCCESSFUL!\n")
                            print(format_workflow(latest))
                            print("\n✅ Monitoring complete - workflow succeeded")
                            return True
                        elif conclusion == 'failure':
                            print("\n\n❌ DEPLOYMENT FAILED\n")
                            print(format_workflow(latest))
                            print("\n⚠️  Check the workflow URL above for details")
                            return False
                        elif conclusion == 'cancelled':
                            print("\n\n⚠️  WORKFLOW CANCELLED\n")
                            print(format_workflow(latest))
                            print("\n⏹  Monitoring complete - workflow was cancelled")
                            return False
                        else:
                            # Handle other conclusions: skipped, timed_out, action_required, neutral, etc.
                            print(f"\n\n⚠️  WORKFLOW COMPLETED: {conclusion.upper()}\n")
                            print(format_workflow(latest))
                            print(f"\n⚠️  Monitoring complete - workflow conclusion: {conclusion}")
                            return False
                    elif status == 'in_progress':
                        print(f"\n\n🔄 DEPLOYMENT IN PROGRESS...\n")
                        print(format_workflow(latest))
                    elif status == 'queued':
                        print(f"\n\n⏳ DEPLOYMENT QUEUED...\n")
                        print(format_workflow(latest))

                time.sleep(interval)

            except KeyboardInterrupt:
                print("\n\n⏸  Monitoring stopped by user")
                return True
            except Exception as e:
                print(f"\n❌ Error during monitoring: {e}")
                time.sleep(interval)

    except Exception as e:
        print(f"\n❌ Fatal error: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(
        description='Check GitHub Actions workflow status',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Check recent workflows
  %(prog)s
  %(prog)s --branch main

  # Monitor workflows until completion (RECOMMENDED - prevents manual polling)
  %(prog)s --branch feature-branch --monitor
  %(prog)s --branch main --monitor --interval 5

IMPORTANT:
  Always use --monitor to wait for workflows to complete.
  This prevents bash syntax errors from manual polling loops.
  The tool will automatically check every 10 seconds and exit when done.
        """
    )

    parser.add_argument('--branch', '-b',
                        help='Filter by branch name')
    parser.add_argument('--monitor', '-m',
                        action='store_true',
                        help='Monitor workflow until completion (auto-polls every --interval seconds)')
    parser.add_argument('--count', '-c',
                        type=int, default=5,
                        help='Number of workflows to show (default: 5)')
    parser.add_argument('--interval', '-i',
                        type=int, default=10,
                        help='Monitoring check interval in seconds (default: 10)')

    args = parser.parse_args()

    if args.monitor:
        success = monitor_workflows(branch=args.branch, interval=args.interval)
    else:
        success = check_workflows(branch=args.branch, count=args.count)

    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
