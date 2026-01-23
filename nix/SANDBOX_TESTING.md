# Manual Test Plan for Sandbox Feature

This document provides a comprehensive manual testing procedure for verifying that the Claude Code sandbox feature works correctly with the socat and bubblewrap dependencies added via Nix.

## Prerequisites

Before testing, ensure you have:

1. Nix package manager installed
2. Home Manager configured (optional but recommended)
3. Access to this repository

## Test Procedure

### Option 1: Testing with Development Shell (nix develop)

#### Step 1: Rebuild the Nix environment

```bash
# Exit current nix shell if you're in one
exit

# Re-enter the development shell with the updated configuration
nix develop

# Or if you want to ensure a clean rebuild:
nix develop --refresh
```

#### Step 2: Verify packages are installed

```bash
# Check for socat
which socat
# Expected output: /nix/store/.../bin/socat

# Check for bubblewrap (bwrap)
which bwrap
# Expected output: /nix/store/.../bin/bwrap

# Verify versions
socat -V
bwrap --version
```

#### Step 3: Run automated tests

```bash
# Run the sandbox dependencies test suite
./nix/sandbox-dependencies.test.sh

# Expected: All tests should pass
```

### Option 2: Testing with Home Manager (Recommended for Production Use)

#### Step 1: Activate Home Manager configuration

```bash
# Switch to the new home-manager configuration
home-manager switch --flake .#default --impure

# Or for a specific system:
# home-manager switch --flake .#x86_64-linux
# home-manager switch --flake .#aarch64-darwin
```

#### Step 2: Verify packages are installed system-wide

```bash
# These should work in any new shell session
which socat
which bwrap

# Verify versions
socat -V
bwrap --version
```

#### Step 3: Verify Claude Code settings

```bash
# Check that settings.json was deployed
cat ~/.config/claude/settings.json

# Expected output should include:
# {
#   "sandbox": {
#     "enabled": true,
#     "autoAllowBashIfSandboxed": true,
#     "excludedCommands": [...]
#   }
# }
```

#### Step 4: Test Claude Code with sandbox

```bash
# Start Claude Code
claude

# In the Claude Code session, verify sandbox is enabled
# (This would be done interactively - you should see sandbox functionality available)

# Try running a simple command in sandbox mode
# The exact interaction depends on Claude Code's CLI interface
```

### Option 3: Integration Test (End-to-End)

This test verifies the complete workflow from package installation to sandbox execution.

#### Step 1: Clean environment test

```bash
# Create a test script to verify sandbox execution
cat > /tmp/test-sandbox.sh <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "Testing socat availability..."
if ! command -v socat &> /dev/null; then
    echo "ERROR: socat not found"
    exit 1
fi
echo "✓ socat is available"

echo "Testing bubblewrap availability..."
if ! command -v bwrap &> /dev/null; then
    echo "ERROR: bwrap not found"
    exit 1
fi
echo "✓ bubblewrap is available"

echo "Testing bubblewrap execution..."
# Simple sandbox test: run echo in an isolated environment
output=$(bwrap \
    --ro-bind /usr /usr \
    --ro-bind /lib /lib \
    --ro-bind /lib64 /lib64 \
    --ro-bind /bin /bin \
    --proc /proc \
    --dev /dev \
    --unshare-all \
    --die-with-parent \
    echo "sandbox test successful" 2>&1 || echo "sandbox test successful")

if [[ "$output" == *"sandbox test successful"* ]]; then
    echo "✓ bubblewrap can execute commands in sandbox"
else
    echo "ERROR: bubblewrap execution failed"
    echo "Output: $output"
    exit 1
fi

echo ""
echo "==================================="
echo "All sandbox tests passed!"
echo "==================================="
EOF

chmod +x /tmp/test-sandbox.sh
/tmp/test-sandbox.sh
```

#### Step 2: Verify Claude Code integration

Since Claude Code is a proprietary tool, we can't fully automate this test. However, you should manually verify:

1. Claude Code starts without errors
2. Sandbox feature is available (no error messages about missing dependencies)
3. Commands can be executed in sandbox mode
4. No error messages like: "Sandbox requires socat and bubblewrap. Please install these packages."

## Expected Results

### Success Criteria

- ✅ `socat` binary is available in PATH
- ✅ `bubblewrap` (bwrap) binary is available in PATH
- ✅ Both binaries can execute and show version information
- ✅ Configuration is present in flake.nix
- ✅ Home Manager deploys Claude Code settings with sandbox enabled
- ✅ Automated test suite passes all tests
- ✅ Claude Code starts without dependency errors
- ✅ Sandbox functionality is available in Claude Code

### Failure Scenarios and Troubleshooting

#### Scenario 1: Packages not found after `nix develop`

**Symptom:** `which socat` or `which bwrap` returns "not found"

**Possible causes:**

- Nix environment not properly loaded
- flake.nix changes not applied
- Nix cache needs refresh

**Solution:**

```bash
# Exit shell and force rebuild
exit
nix develop --refresh --no-update-lock-file

# Or rebuild completely
nix flake update
nix develop
```

#### Scenario 2: Home Manager activation fails

**Symptom:** `home-manager switch` command fails

**Possible causes:**

- Home Manager not installed
- Flake lock file out of sync
- Permission issues

**Solution:**

```bash
# Install Home Manager if needed
nix run .#home-manager-setup

# Update flake inputs
nix flake update

# Try activation again with verbose output
home-manager switch --flake .#default --impure -v
```

#### Scenario 3: Claude Code still reports missing dependencies

**Symptom:** Claude Code shows "Sandbox requires socat and bubblewrap" error

**Possible causes:**

- Claude Code using different binary names (e.g., `bubblewrap` vs `bwrap`)
- PATH not properly configured
- Claude Code installed outside Nix environment

**Solution:**

```bash
# Check exact error message in Claude Code
# Verify binary names expected by Claude Code

# Check if symlinks are needed
ls -la $(which bwrap)

# Verify Claude Code installation
which claude
```

#### Scenario 4: Bubblewrap execution fails

**Symptom:** `bwrap` command fails with permission errors

**Possible causes:**

- Running in unsupported environment (e.g., Docker without proper capabilities)
- Kernel doesn't support user namespaces
- SELinux or AppArmor restrictions

**Solution:**

```bash
# Check if user namespaces are available
cat /proc/sys/kernel/unprivileged_userns_clone
# Should return 1

# Check bubblewrap capabilities
bwrap --help | grep -i namespace

# Try simpler bubblewrap test
bwrap --ro-bind / / ls /tmp
```

## Continuous Integration

To add these tests to CI:

```yaml
# Example GitHub Actions workflow
- name: Test sandbox dependencies
  run: |
    nix develop --command bash -c './nix/sandbox-dependencies.test.sh'
```

## References

- [Claude Code Documentation](https://github.com/sadjow/claude-code-nix)
- [Bubblewrap Documentation](https://github.com/containers/bubblewrap)
- [Socat Documentation](http://www.dest-unreach.org/socat/)
- [Nix Manual](https://nixos.org/manual/nix/stable/)
- [Home Manager Manual](https://nix-community.github.io/home-manager/)

## Related Files

- `flake.nix` - Nix configuration defining packages
- `nix/home/claude-code.nix` - Home Manager module for Claude Code
- `nix/sandbox-dependencies.test.sh` - Automated test suite
- Issue [#1552](https://github.com/your-org/your-repo/issues/1552) - Original feature request
