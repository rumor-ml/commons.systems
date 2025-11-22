# Terminal Package Testing Guide

## Overview

The terminal package now includes test isolation features to prevent tests from creating tmux windows in your active session. This guide explains how to use the test infrastructure.

## Running Tests

### Unit Tests

Unit tests that don't require tmux can be run normally:
```bash
go test ./internal/terminal
```

### Integration Tests with Tmux

To run tests that require actual tmux interaction, set the `ICF_TEST_MODE` environment variable:
```bash
ICF_TEST_MODE=1 go test ./internal/terminal
```

**Important**: Do not run tmux tests from inside a tmux session. The tests will automatically skip if `TMUX` is set.

## Test Helpers

### SetupTestTmux

The `SetupTestTmux` function creates an isolated test tmux session:

```go
func TestMyFeature(t *testing.T) {
    tm, cleanup := SetupTestTmux(t)
    defer cleanup()
    
    // Your test code here
    // All tmux operations will happen in the test session
}
```

Features:
- Creates a unique test session with name `test-icf-<pid>-<random>`
- Automatically cleans up the test session when done
- Skips test if `ICF_TEST_MODE` is not set
- Skips test if already inside tmux
- Returns a `TestTmuxManager` that redirects all operations to the test session

### MockTmuxManager

For unit tests that don't need real tmux:

```go
func TestMyUnit(t *testing.T) {
    tm := NewMockTmuxManager()
    
    // Mock operations work in memory
    session, err := tm.CreateProjectSession(project)
    // ...
}
```

## Writing New Tests

### Guidelines

1. **Always use test helpers** for tmux-related tests
2. **Never create sessions directly** in the active tmux session
3. **Use mocks** for unit tests that don't need real tmux behavior
4. **Set ICF_TEST_MODE=1** in your test environment or CI

### Example Test

```go
func TestTmuxWindowCreation(t *testing.T) {
    // This sets up an isolated test session
    tm, cleanup := SetupTestTmux(t)
    defer cleanup()
    
    // Create a project
    project := model.NewProject("test-project", "/tmp/test")
    
    // This creates a session within the test session
    session, err := tm.CreateProjectSession(project)
    require.NoError(t, err)
    
    // This creates a window in the test session
    window, err := tm.CreateWindow(session.Name, "test-window", "zsh", "")
    require.NoError(t, err)
    
    // Verify window was created
    assert.Equal(t, "test-window", window.Name)
}
```

## CI/CD Configuration

For continuous integration:

```yaml
# Example GitHub Actions
env:
  ICF_TEST_MODE: "1"
  
steps:
  - name: Install tmux
    run: sudo apt-get install -y tmux
    
  - name: Run tests
    run: go test ./internal/terminal
```

## Benchmarks

Benchmarks that need real tmux require a different flag:

```bash
ICF_BENCH_REAL_TMUX=1 go test -bench=. ./internal/terminal
```

This prevents accidentally running expensive benchmarks during normal test runs.

## Troubleshooting

### "Set ICF_TEST_MODE=1 to run tmux integration tests"
The test requires tmux and you haven't enabled test mode. Set the environment variable.

### "Cannot run tmux tests from inside tmux session"
Exit your tmux session before running tests, or run tests in a different terminal.

### Test sessions not cleaned up
If a test crashes, you might have orphaned test sessions. Clean them up with:
```bash
tmux list-sessions | grep test-icf- | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
```

## Migration Guide

To migrate existing tests:

1. Replace direct `NewTmuxManager` calls with `SetupTestTmux`
2. Remove tmux availability checks (handled by setup)
3. Update session name assertions to use `tm.testSessionName`
4. Add cleanup defer

Before:
```go
func TestFeature(t *testing.T) {
    if os.Getenv("TMUX") != "" {
        t.Skip("Skipping test when running inside tmux")
    }
    ctx := context.Background()
    tm := NewTmuxManager(ctx)
    defer tm.Cleanup()
    // ...
}
```

After:
```go
func TestFeature(t *testing.T) {
    tm, cleanup := SetupTestTmux(t)
    defer cleanup()
    // ...
}
```