#!/bin/bash
# Get logs for a GitHub Actions workflow run and its jobs
#
# Usage:
#   ./get_workflow_logs.sh <run_id>                    # Get logs for all jobs
#   ./get_workflow_logs.sh <run_id> <job_id>           # Get logs for specific job
#   ./get_workflow_logs.sh <branch_name>               # Get logs for latest run on branch
#   ./get_workflow_logs.sh --latest                    # Get logs for latest run (any branch)
#   ./get_workflow_logs.sh --failed                    # Get logs for latest failed run
#
# Examples:
#   ./get_workflow_logs.sh 12345678901                 # Get logs for run ID
#   ./get_workflow_logs.sh main                        # Get logs for latest run on main
#   ./get_workflow_logs.sh --failed                    # Get logs for latest failed run

set -e

REPO="rumor-ml/commons.systems"

# Check for GitHub token
if [ -z "$GITHUB_TOKEN" ]; then
    echo "❌ Error: GITHUB_TOKEN environment variable not set"
    echo ""
    echo "Please set GITHUB_TOKEN:"
    echo "  export GITHUB_TOKEN=<your-token>"
    exit 1
fi

# Helper function to make GitHub API requests
gh_api() {
    local endpoint="$1"
    local output_file="${2:-}"
    local follow_redirects="${3:-false}"

    # CRITICAL: Use 'token' not 'Bearer' for GitHub API
    local headers=(
        -H "Authorization: token $GITHUB_TOKEN"
        -H "Accept: application/vnd.github+json"
        -H "X-GitHub-Api-Version: 2022-11-28"
    )

    # For log endpoints, we need to follow redirects
    local curl_opts=(-sS)
    if [ "$follow_redirects" = "true" ]; then
        curl_opts+=(-L)
    fi

    if [ -n "$output_file" ]; then
        curl "${curl_opts[@]}" "${headers[@]}" "https://api.github.com${endpoint}" -o "$output_file"
    else
        curl "${curl_opts[@]}" "${headers[@]}" "https://api.github.com${endpoint}"
    fi
}

# Get the latest workflow run ID for a branch or condition
get_latest_run_id() {
    local filter="$1"
    local per_page=20

    case "$filter" in
        --latest)
            gh_api "/repos/$REPO/actions/runs?per_page=1" | jq -r '.workflow_runs[0].id'
            ;;
        --failed)
            gh_api "/repos/$REPO/actions/runs?status=completed&conclusion=failure&per_page=1" | jq -r '.workflow_runs[0].id'
            ;;
        *)
            # Assume it's a branch name
            gh_api "/repos/$REPO/actions/runs?per_page=$per_page" | \
                jq -r ".workflow_runs[] | select(.head_branch == \"$filter\") | .id" | head -1
            ;;
    esac
}

# Get workflow run info
get_workflow_info() {
    local run_id="$1"

    echo "📋 Fetching workflow run information..."
    local run_data=$(gh_api "/repos/$REPO/actions/runs/$run_id")

    local name=$(echo "$run_data" | jq -r '.name')
    local status=$(echo "$run_data" | jq -r '.status')
    local conclusion=$(echo "$run_data" | jq -r '.conclusion // "in_progress"')
    local branch=$(echo "$run_data" | jq -r '.head_branch')
    local sha=$(echo "$run_data" | jq -r '.head_sha[:7]')

    echo ""
    echo "Workflow: $name"
    echo "Branch: $branch"
    echo "Commit: $sha"
    echo "Status: $status"
    echo "Result: $conclusion"
    echo "URL: https://github.com/$REPO/actions/runs/$run_id"
    echo ""
}

# Get logs for a specific job
get_job_logs() {
    local job_id="$1"
    local job_name="$2"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "📄 Logs for job: $job_name (ID: $job_id)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Get logs - this endpoint returns a redirect, so we need to follow it
    # IMPORTANT: Use follow_redirects=true for log endpoints
    gh_api "/repos/$REPO/actions/jobs/$job_id/logs" "" "true"

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Get logs for entire workflow run (download ZIP)
get_workflow_logs_archive() {
    local run_id="$1"
    local output_file="${2:-workflow-${run_id}-logs.zip}"

    echo "📦 Downloading workflow logs archive..."

    # This endpoint returns a redirect to the actual log archive
    gh_api "/repos/$REPO/actions/runs/$run_id/logs" "$output_file" "true"

    if [ -f "$output_file" ]; then
        echo "✅ Logs saved to: $output_file"
        echo ""
        echo "To extract and view:"
        echo "  unzip -q $output_file -d logs-$run_id"
        echo "  ls -la logs-$run_id"
    else
        echo "❌ Failed to download logs"
        return 1
    fi
}

# Main execution
main() {
    local arg="${1:-}"
    local specific_job_id="${2:-}"

    if [ -z "$arg" ]; then
        echo "Usage: $0 <run_id|branch_name|--latest|--failed> [job_id]"
        echo ""
        echo "Examples:"
        echo "  $0 12345678901              # Get logs for run ID"
        echo "  $0 12345678901 98765        # Get logs for specific job"
        echo "  $0 main                     # Get logs for latest run on main"
        echo "  $0 --latest                 # Get logs for latest run"
        echo "  $0 --failed                 # Get logs for latest failed run"
        exit 1
    fi

    local run_id=""

    # Determine if arg is a run ID or needs to be resolved
    if [[ "$arg" =~ ^[0-9]+$ ]]; then
        run_id="$arg"
    else
        echo "🔍 Resolving run ID for: $arg"
        run_id=$(get_latest_run_id "$arg")

        if [ -z "$run_id" ] || [ "$run_id" = "null" ]; then
            echo "❌ No workflow run found for: $arg"
            exit 1
        fi

        echo "Found run ID: $run_id"
        echo ""
    fi

    # Show workflow info
    get_workflow_info "$run_id"

    # If specific job requested, get only that job's logs
    if [ -n "$specific_job_id" ]; then
        echo "Fetching logs for job: $specific_job_id"
        local job_name=$(gh_api "/repos/$REPO/actions/jobs/$specific_job_id" | jq -r '.name')
        get_job_logs "$specific_job_id" "$job_name"
        exit 0
    fi

    # Otherwise, get all jobs and their logs
    echo "🔍 Fetching jobs..."
    local jobs_response=$(gh_api "/repos/$REPO/actions/runs/$run_id/jobs")

    # Check if we got valid JSON
    if ! echo "$jobs_response" | jq empty 2>/dev/null; then
        echo "❌ Error: Invalid response from jobs API"
        echo "Response: $jobs_response"
        exit 1
    fi

    local job_count=$(echo "$jobs_response" | jq -r '.total_count // 0')

    echo "Found $job_count job(s)"
    echo ""

    # List all jobs first
    echo "Jobs in this workflow:"
    echo "$jobs_response" | jq -r '.jobs[] | "  - [\(.conclusion // .status)] \(.name) (ID: \(.id))"'
    echo ""

    # Ask if user wants to see all logs
    read -p "Fetch logs for all jobs? (y/N) " -n 1 -r
    echo

    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Fetch logs for each job
        echo "$jobs_response" | jq -c '.jobs[]' | while read -r job; do
            local job_id=$(echo "$job" | jq -r '.id')
            local job_name=$(echo "$job" | jq -r '.name')

            get_job_logs "$job_id" "$job_name"
        done
    else
        echo ""
        echo "💡 To fetch logs for a specific job:"
        echo "   $0 $run_id <job_id>"
        echo ""
        echo "Or download the full logs archive:"
        echo "   curl -L -H 'Authorization: token \$GITHUB_TOKEN' \\"
        echo "     'https://api.github.com/repos/$REPO/actions/runs/$run_id/logs' \\"
        echo "     -o workflow-logs.zip"
    fi
}

# Check dependencies
if ! command -v jq &> /dev/null; then
    echo "❌ Error: jq is required but not installed"
    echo ""
    echo "Install with:"
    echo "  apt-get install jq        # Debian/Ubuntu"
    echo "  yum install jq            # CentOS/RHEL"
    echo "  brew install jq           # macOS"
    exit 1
fi

main "$@"
