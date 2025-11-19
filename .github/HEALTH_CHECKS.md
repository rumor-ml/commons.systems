# Optional: Enable Scheduled Health Checks

The health check workflow is disabled by default. To enable automated health checks:

## Enable Health Checks

Edit `.github/workflows/health-check.yml`:

```yaml
on:
  schedule:
    - cron: '0 */6 * * *'  # Every 6 hours
  workflow_dispatch:
```

Uncomment the `schedule` section.

## Custom Schedule

Adjust the cron expression for different intervals:

```yaml
- cron: '0 */1 * * *'   # Every hour
- cron: '0 */12 * * *'  # Every 12 hours
- cron: '0 0 * * *'     # Daily at midnight
- cron: '0 0 * * 1'     # Weekly on Monday
```

## What Health Checks Do

- Run Playwright tests against the deployed site
- Verify the site is accessible and functioning
- Create a GitHub issue if tests fail
- Useful for detecting deployment issues or service degradation

## Manual Health Check

You can always run health checks manually:

1. Go to Actions tab
2. Select "Health Check" workflow
3. Click "Run workflow"
