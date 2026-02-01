# Nix Integration Tests

This directory contains integration tests for Nix-based tooling and pre-commit hooks.

## WezTerm Lua Syntax Tests

**File:** `wezterm-lua-syntax-test.nix`

Integration tests for the `wezterm-lua-syntax` pre-commit hook defined in `nix/checks.nix`.

### What It Tests

1. **Valid Lua Syntax**: Ensures valid WezTerm Lua configurations pass validation
2. **Invalid Lua Syntax**: Ensures syntax errors are correctly detected and rejected
3. **Lua Code Extraction**: Verifies the hook correctly extracts Lua code from Nix configuration
4. **Field Path Handling**: Ensures the hook fails gracefully when using incorrect field paths

### Running the Tests

**Via flake check (recommended):**

```bash
nix flake check
```

**Directly:**

```bash
nix-build nix/tests/wezterm-lua-syntax-test.nix
```

**Via flake (specific check):**

```bash
nix build .#checks.aarch64-darwin.wezterm-lua-syntax-test
```

### Test Coverage

The tests verify that the hook:

- Extracts Lua code using `nix eval --raw --impure`
- Validates syntax using `luac -p`
- Provides clear error messages for invalid Lua
- Succeeds for valid Lua configurations
- Handles incorrect field paths appropriately

### Why These Tests Matter

Without these tests, a refactoring could:

- Break the Nix evaluation expression (wrong field path)
- Cause silent failures (missing error handling)
- Allow invalid Lua to pass (incorrect luac flags)
- Extract wrong content (incorrect indented string parsing)

The tests ensure the hook continues to function correctly across changes to the Nix configuration structure.
