**CRITICAL: always run git/gh/nix/gcloud commands with dangerouslyDisableSandbox: true**

After exiting plan mode, use the `implementation-manager` subagent to execute the plan.

Trust user bug reports. Do not assume caching errors or user error while building.

If creating temporary artifacts such as debugging scripts, commit messages, subagents plans, or status/process documentation always write to tmp directory so that artifacts are not committed.

# Definition of Done
Keep iterating until problem resolution is fully verified by test results, logs or workflow output.

Do not ask user to fetch test results, logs or monitor workflows when you can do so yourself. 
