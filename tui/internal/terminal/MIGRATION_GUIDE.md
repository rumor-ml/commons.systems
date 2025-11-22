# TmuxManager Testing Architecture Migration Guide

## Overview
This guide documents the refactoring of TmuxManager's testing architecture to eliminate technical debt and establish clean dependency injection patterns.

## What's Changed

### New Files Created
- `providers.go` - Defines PaneProvider and SessionProvider interfaces
- `factory.go` - Implements factory pattern for TmuxManager construction
- `test_config.go` - Provides builder pattern for test configuration
- `tmux_manager_new_pattern_test.go` - Examples of the new testing pattern

### Key Improvements
1. **Clean Separation**: Testing concerns removed from production code
2. **Dependency Injection**: Constructor-based injection replaces post-creation mutation
3. **Factory Pattern**: Separate construction paths for production vs test
4. **Builder Pattern**: Declarative test configuration

## Migration Examples

### Old Pattern (Deprecated)
```go
// Direct state manipulation - AVOID
tm := terminal.NewTmuxManager(ctx)
tm.AddPaneForTesting(pane)
tm.SetExecutorForTesting(mockExecutor)
tm.SetCurrentSessionOverride("test-session")
```

### New Pattern (Recommended)
```go
// Clean, declarative configuration
testConfig := terminal.NewTmuxTestConfig().
    WithPane(pane).
    WithExecutor(mockExecutor).
    WithCurrentSession("test-session").
    Build()

factory := terminal.NewTmuxManagerFactory()
tm := factory.NewTesting(ctx, testConfig)
```

## Quick Start Helpers

### Minimal Test Setup
```go
factory := terminal.NewTmuxManagerFactory()
tm := factory.NewTesting(ctx, terminal.QuickTestConfig())
```

### Test with Single Pane
```go
tm := factory.NewTesting(ctx, terminal.TestConfigWithPane(pane))
```

### Test with Session and Panes
```go
tm := factory.NewTesting(ctx, terminal.TestConfigWithSession("session", pane1, pane2))
```

## Deprecated Methods
The following methods are deprecated and will be removed in Phase 3:
- `AddPaneForTesting()` - Use builder pattern instead
- `SetExecutorForTesting()` - Use constructor injection
- `SetCurrentSessionOverride()` - Use session provider

## Migration Status

### Phase 1 ✅ Complete
- Created provider interfaces
- Implemented factory pattern
- Added test configuration builder

### Phase 2 🚧 In Progress
- Example tests created
- Backward compatibility maintained
- Deprecation warnings added

### Phase 3 📋 Planned
- Remove deprecated methods
- Migrate all existing tests
- Update integration tests

### Phase 4 📋 Planned
- Final validation
- Performance testing
- Documentation update

## Benefits
- **Cleaner Architecture**: No testing code in production
- **Better Testability**: Declarative test setup
- **Improved Performance**: No testing conditionals in hot paths
- **Enhanced Maintainability**: Clear separation of concerns

## Next Steps
1. Review example tests in `tmux_manager_new_pattern_test.go`
2. Start migrating tests to new pattern
3. Use deprecation warnings to track remaining usage
4. Phase out old patterns gradually

## Questions?
Refer to the example tests or the detailed implementation plan in GitHub Issue #7.