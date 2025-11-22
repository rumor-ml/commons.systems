# Testing Strategy: ICF TTY Multiplexer

## Overview

The ICF TTY Multiplexer maintains a comprehensive test suite with **58 test files** across **7 internal packages**, providing robust coverage for the simplified modular architecture.

## Test Distribution

### Package-Level Test Coverage

| Package | Test Files | Implementation Files | Coverage Focus |
|---------|------------|---------------------|----------------|
| **ui** | 28 | 38 | Terminal interface, navigation, Claude highlighting, user interactions |
| **app** | 12 | 11 | Application coordination, lifecycle management, integration testing |
| **terminal** | 11 | 27 | Tmux integration, session management, Claude monitoring |
| **status** | 4 | 10 | Status aggregation, caching, notification handling |
| **assistant** | 1 | 2 | Claude integration core functionality |
| **security** | 1 | 1 | Input sanitization and command validation |
| **worktree** | 1 | 1 | Git worktree operations |

## Testing Frameworks and Patterns

### Primary Testing Framework

- **Go Standard Testing**: `go test` with table-driven tests and comprehensive assertions
- **Bubble Tea Testing**: `tea test` for TUI component validation and event simulation
- **No Custom Test Harnesses**: Following project guidelines to use standard frameworks only

### Test Organization Principles

1. **Co-location**: Tests are placed alongside implementation files (`*_test.go` pattern)
2. **Comprehensive Coverage**: Multiple test types for complex components:
   - Unit tests: Core functionality verification
   - Integration tests: Cross-module interaction testing
   - Visual tests: TUI appearance and layout validation
   - Timing tests: Performance and race condition detection
   - Behavioral tests: User interaction pattern validation

### Storage Testing Patterns

Following the established storage architecture:

#### **../log Package Testing**
- Test component-based logging: `log.Get().WithComponent("test")`
- Verify log output and formatting for debugging scenarios
- Test log level filtering and component isolation

#### **../store Package Testing** 
- Test direct store usage patterns with `store.NewSQLiteStore()`
- Verify structured data storage and retrieval
- Test database operations and data integrity

## Package-Specific Testing Strategies

### UI Package (28 test files)
**Focus**: Terminal user interface validation and interaction testing

**Test Types**:
- Claude highlighting behavior and visual consistency
- Navigation component functionality and key bindings
- Terminal content processing and display
- List building and formatting logic
- User interaction workflows

**Key Patterns**:
```go
// Bubble Tea event simulation
func TestNavigationKeyBinding(t *testing.T) {
    model := setupTestModel()
    result := model.Update(tea.KeyMsg{Type: tea.KeyEnter})
    // Assert expected behavior
}
```

### App Package (12 test files)
**Focus**: Application coordination and integration testing

**Test Types**:
- Controller lifecycle management
- Project loading and discovery integration
- Navigation mode transitions
- Shell integration and workspace handling

**Key Patterns**:
```go
// Integration testing with multiple components
func TestProjectDiscoveryIntegration(t *testing.T) {
    app := NewTestApp()
    app.updateNavigationProjects()
    // Verify project discovery and UI updates
}
```

### Terminal Package (11 test files)
**Focus**: Tmux integration and session management

**Test Types**:
- Session discovery and creation
- Pane management and navigation
- Claude activity monitoring
- Tmux command execution and validation

**Key Patterns**:
```go
// Tmux integration testing
func TestSessionDiscovery(t *testing.T) {
    sessions, err := discoverer.DiscoverExistingSessions()
    assert.NoError(t, err)
    // Verify session mapping and metadata
}
```

### Status Package (4 test files)
**Focus**: Status aggregation and notification handling

**Test Types**:
- Status source integration and aggregation
- Cache management and expiration
- Notification processing and storage
- Dashboard data generation

**Consolidated Testing**: Now includes notification functionality merged from the former notifications package.

## Testing Best Practices

### 1. Standard Framework Usage
- ✅ Use `go test` for all Go testing
- ✅ Use `tea test` for TUI component testing  
- ❌ Avoid custom test harnesses or debug scripts

### 2. Table-Driven Tests
```go
func TestValidation(t *testing.T) {
    tests := []struct {
        name     string
        input    string
        expected bool
    }{
        {"valid input", "test", true},
        {"invalid input", "", false},
    }
    
    for _, tt := range tests {
        t.Run(tt.name, func(t *testing.T) {
            result := Validate(tt.input)
            assert.Equal(t, tt.expected, result)
        })
    }
}
```

### 3. Component Isolation
- Test components in isolation where possible
- Use dependency injection for external dependencies
- Mock interfaces for complex integration points

### 4. Storage Pattern Testing
- Test logging functionality with `../log` package patterns
- Test data storage with direct `../store` usage
- Verify storage pattern separation is maintained

## Continuous Quality Assurance

### Test Execution
```bash
# Run all tests
go test ./...

# Run specific package tests  
go test ./internal/ui/ -v

# Run with coverage
go test -cover ./...

# Run TUI-specific tests
tea test ./internal/ui/
```

### Quality Metrics
- **Test Coverage**: Maintain comprehensive coverage across all packages
- **Test Stability**: Ensure tests are deterministic and not environmentally dependent
- **Performance**: Monitor test execution time and optimize slow tests

## Future Testing Considerations

### Maintenance Guidelines
1. **Update tests when refactoring**: Ensure test compatibility during architectural changes
2. **Follow storage patterns**: Test new functionality using established ../log and ../store patterns  
3. **Maintain co-location**: Keep tests alongside implementation files
4. **Use standard frameworks**: Continue using go test and tea test exclusively

### Scaling Considerations
- Monitor test suite execution time as functionality grows
- Consider test parallelization for performance-critical testing
- Maintain clear test organization as package complexity increases

This testing strategy supports the simplified 7-package architecture while maintaining comprehensive coverage and following established patterns for reliable TUI application testing.