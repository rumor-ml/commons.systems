# Claude Instructions for This Repository

## API Access in CI/CD Environment

This repository's CI/CD environment provides authenticated access to GitHub and Google Cloud Platform APIs via environment variables.

### GitHub API Access

The environment provides a `GITHUB_TOKEN` variable for authenticated GitHub API access.

**Example: Get current repository information**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO
```

**Example: List pull requests**
```bash
curl -H "Authorization: token $GITHUB_TOKEN" \
  https://api.github.com/repos/OWNER/REPO/pulls
```

**Example: Create an issue**
```bash
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Issue title","body":"Issue description"}' \
  https://api.github.com/repos/OWNER/REPO/issues
```

### Google Cloud Platform API Access

The environment provides GCP credentials via:
- `GCP_ACCESS_TOKEN`: OAuth2 access token
- `GCP_PROJECT_ID`: The GCP project ID

**Example: Get project information**
```bash
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://cloudresourcemanager.googleapis.com/v1/projects/$GCP_PROJECT_ID"
```

**Example: List Cloud Storage buckets**
```bash
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://storage.googleapis.com/storage/v1/b?project=$GCP_PROJECT_ID"
```

**Example: List Compute Engine zones**
```bash
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://compute.googleapis.com/compute/v1/projects/$GCP_PROJECT_ID/zones"
```

**Example: List Cloud Run services**
```bash
curl -H "Authorization: Bearer $GCP_ACCESS_TOKEN" \
  "https://run.googleapis.com/v2/projects/$GCP_PROJECT_ID/locations/-/services"
```

## Documentation Policy

**IMPORTANT:** Do NOT create markdown (`.md`) documentation files unless explicitly requested by the user.

### Rules:

1. **Never create new `.md` files** without explicit user request
2. **All user documentation belongs in README.md** - update the main README instead of creating separate files
3. **Inline documentation only** - Use code comments, docstrings, and inline explanations
4. **README.md is the single source of truth** for user-facing documentation

### Exceptions:

The following markdown files are acceptable and should be kept:
- `README.md` (main documentation)
- `fellspiral/rules.md` (game rules - content, not technical documentation)
- `infrastructure/README.md` (minimal pointer to main README)
- This file (`CLAUDE.md`)

### When User Asks for Documentation:

- **Default action**: Update README.md with the new information in the appropriate section
- **Only create separate `.md` files** if the user specifically says "create a separate markdown file" or similar explicit instruction
- **Ask for clarification** if uncertain whether documentation should go in README or a separate file

### Rationale:

- Prevents documentation sprawl across the repository
- Keeps all user-facing documentation in one place (README.md)
- Makes documentation easier to find and maintain
- Reduces cognitive load for contributors

## General Guidelines

### Commit Messages

Use clear, descriptive commit messages:
- Start with imperative verb (Add, Update, Fix, Remove, etc.)
- Keep first line under 72 characters
- Add detailed description if needed

### Code Style

- Follow existing patterns in the codebase
- Use modern JavaScript (ES6+)
- Write self-documenting code with clear variable names
- Add comments only for complex logic

### Testing

- Add tests for new features
- Ensure all tests pass before committing
- Use Playwright best practices for E2E tests
