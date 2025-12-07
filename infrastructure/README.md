# Infrastructure Management Tool

This directory contains the `iac` CLI tool for managing infrastructure setup and IaC operations.

## Overview

The `iac` tool is a Go-based replacement for the Python `iac.py` script. It provides:

- **Idempotent operations**: Safe to run multiple times
- **GCP setup**: APIs, Workload Identity, IAM permissions
- **Firebase initialization**: Project and hosting sites
- **Terraform automation**: State bucket, init, plan, apply
- **GitHub integration**: Auto-create repository secrets

## Installation

### Build from source

```bash
cd infrastructure
go build -o bin/iac ./cmd/iac
```

### Install globally

```bash
go install ./cmd/iac
```

## Usage

### Interactive Mode (Default)

Run the tool interactively to set up infrastructure for the first time:

```bash
./bin/iac
```

This will:

1. Check prerequisites (gcloud, terraform)
2. Authenticate to GCP
3. Enable required APIs
4. Set up Workload Identity Federation
5. Create service accounts with IAM permissions
6. Initialize Firebase and create hosting sites
7. Create Terraform state bucket
8. Run Terraform to provision infrastructure

### CI Mode

For automated deployments in GitHub Actions:

```bash
./bin/iac --ci --project-id=your-project-id
```

CI mode:

- Skips GCP setup (assumes already configured)
- Auto-approves Terraform changes
- Non-interactive

### Command-line Flags

```
--project-id string      GCP project ID (or GCP_PROJECT_ID env)
--repo-owner string      GitHub repo owner (default: rumor-ml)
--repo-name string       GitHub repo name (default: commons.systems)
--skip-terraform         Skip Terraform execution
--skip-gcp-setup         Skip GCP setup (APIs, WIF, IAM)
--auto-approve           Auto-approve Terraform changes
--ci                     CI mode: implies --skip-gcp-setup --auto-approve
--verbose                Show detailed output
```

## Architecture

The tool is organized into packages:

### Core Packages

- **cmd/iac**: CLI entry point and flag parsing
- **internal/runner**: Main orchestrator that coordinates all operations
- **internal/config**: Configuration management

### Utility Packages

- **internal/exec**: Command execution with output capture
- **internal/output**: Colored terminal output

### Operation Packages

- **internal/gcp**: GCP operations (auth, APIs, WIF, IAM, secrets)
- **internal/firebase**: Firebase initialization and hosting sites
- **internal/terraform**: Terraform state bucket and runner
- **internal/github**: GitHub secrets management

## GCP APIs Enabled

The tool enables these GCP APIs:

1. `compute.googleapis.com` - Compute Engine
2. `storage.googleapis.com` - Cloud Storage
3. `cloudresourcemanager.googleapis.com` - Resource Manager
4. `run.googleapis.com` - Cloud Run
5. `artifactregistry.googleapis.com` - Artifact Registry
6. `secretmanager.googleapis.com` - Secret Manager
7. `iam.googleapis.com` - IAM
8. `iamcredentials.googleapis.com` - IAM Credentials
9. `sts.googleapis.com` - Security Token Service
10. `firebase.googleapis.com` - Firebase
11. `firebaserules.googleapis.com` - Firebase Rules
12. `firebasestorage.googleapis.com` - Firebase Storage
13. `firebasehosting.googleapis.com` - Firebase Hosting
14. `identitytoolkit.googleapis.com` - Identity Platform

## IAM Roles Granted

The service account receives these project-level roles:

1. `roles/secretmanager.admin` - Manage secrets
2. `roles/artifactregistry.admin` - Manage artifact repositories
3. `roles/run.admin` - Manage Cloud Run services
4. `roles/iam.serviceAccountUser` - Use service accounts
5. `roles/storage.admin` - Manage Cloud Storage
6. `roles/compute.loadBalancerAdmin` - Manage load balancers
7. `roles/compute.networkAdmin` - Manage networks
8. `roles/iam.serviceAccountTokenCreator` - Create service account tokens

## Firebase Sites

The tool creates Firebase Hosting sites based on `firebase.json`:

- fellspiral
- videobrowser-7696a
- audiobrowser
- print-dfb47

If a site name is reserved, the tool will:

1. Check if a related site exists in your project
2. Use the suggested alternative name from the API
3. Update `firebase.json` with the actual site names

## GitHub Secrets

The tool can auto-create these GitHub repository secrets:

1. `GCP_PROJECT_ID` - GCP project ID
2. `GCP_WORKLOAD_IDENTITY_PROVIDER` - Workload Identity provider path
3. `GCP_SERVICE_ACCOUNT` - Service account email

Requires `gh` CLI to be installed and authenticated.

## Idempotency

All operations are idempotent:

- **APIs**: Already-enabled APIs are skipped
- **Workload Identity**: Existing pools/providers are reused
- **Service Accounts**: Existing accounts are reused
- **IAM Bindings**: Duplicate bindings are detected and skipped
- **Firebase**: Already-initialized projects are detected
- **Hosting Sites**: Existing sites are reused
- **State Bucket**: Existing bucket is reused
- **Terraform**: Safe to run multiple times

## Error Handling

The tool provides clear error messages:

- Missing prerequisites (gcloud, terraform)
- Authentication failures
- Permission denied errors
- API enablement issues
- Firebase initialization problems

## Development

### Project Structure

```
infrastructure/
├── cmd/
│   └── iac/
│       └── main.go           # CLI entry point
├── internal/
│   ├── config/
│   │   └── config.go         # Configuration
│   ├── exec/
│   │   └── exec.go           # Command execution
│   ├── output/
│   │   └── output.go         # Terminal output
│   ├── runner/
│   │   └── runner.go         # Main orchestrator
│   ├── gcp/
│   │   ├── auth.go           # GCP authentication
│   │   ├── apis.go           # API enablement
│   │   ├── workload_identity.go  # WIF setup
│   │   ├── iam.go            # IAM permissions
│   │   └── secrets.go        # Secret Manager
│   ├── firebase/
│   │   ├── project.go        # Firebase initialization
│   │   ├── hosting.go        # Hosting sites
│   │   └── config.go         # firebase.json management
│   ├── terraform/
│   │   ├── state.go          # State bucket
│   │   ├── vars.go           # terraform.tfvars
│   │   └── runner.go         # Terraform execution
│   └── github/
│       └── secrets.go        # GitHub secrets
├── bin/
│   └── iac                   # Compiled binary
├── go.mod                    # Go module definition
├── go.sum                    # Dependency checksums
└── README.md                 # This file
```

### Adding New Operations

1. Create a new package under `internal/`
2. Implement idempotent functions
3. Add to `runner.Run()` orchestration
4. Update this README

### Testing Locally

```bash
# Build
go build -o bin/iac ./cmd/iac

# Test help
./bin/iac --help

# Test with dry-run (skip terraform)
./bin/iac --skip-terraform

# Test full run (requires GCP credentials)
./bin/iac --project-id=your-project-id
```

## Migration from iac.py

The Go tool is a direct replacement for `iac.py`:

| iac.py                            | iac (Go)                     |
| --------------------------------- | ---------------------------- |
| `python3 iac.py`                  | `./bin/iac`                  |
| `python3 iac.py --ci`             | `./bin/iac --ci`             |
| `python3 iac.py --iac`            | `./bin/iac --skip-gcp-setup` |
| `python3 iac.py --skip-terraform` | `./bin/iac --skip-terraform` |

All functionality is preserved with improved:

- Type safety (Go vs Python)
- Performance (compiled vs interpreted)
- Error handling (explicit vs exceptions)
- Concurrency support (goroutines)

## Dependencies

- [fatih/color](https://github.com/fatih/color) - Colored terminal output

## License

Same as the parent project.
