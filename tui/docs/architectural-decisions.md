# Architectural Decision Record: ICF TTY Multiplexer Simplification

## Context

The ICF TTY Multiplexer underwent a comprehensive architectural review following a recent refactoring that broke large components into smaller modules. The review identified opportunities to simplify the architecture and improve maintainability while preserving all core functionality.

## Decisions Made

### 1. Removed Performance Package (311 LOC OpenTelemetry)

**Decision**: Eliminated the entire `internal/performance/` package containing OpenTelemetry distributed tracing.

**Rationale**: 
- OpenTelemetry tracing is overkill for a local terminal user interface application
- Added significant complexity (311 lines) without proportional benefit for debugging local TUI issues  
- Performance issues in TUI applications are better debugged with simpler tools (basic timing logs, profiling)
- Removed dependencies: `go.opentelemetry.io/otel/*` packages

**Impact**: Simplified codebase, reduced binary size, eliminated unnecessary distributed tracing overhead

### 2. Removed ProjectStore Wrapper (159 LOC)

**Decision**: Eliminated `internal/projectstore/` package and use `../store` package directly.

**Rationale**:
- The projectstore wrapper was a thin abstraction that added indirection without significant value
- Direct usage of `../store` package is cleaner and more transparent
- Eliminated 159 lines of wrapper code while maintaining identical functionality
- Follows principle of avoiding unnecessary abstraction layers

**Impact**: Reduced complexity, more direct data access patterns, easier to understand data flow

### 3. Consolidated Notification Storage

**Decision**: Unified notification handling to use only `../store` package, eliminating dual storage approach.

**Rationale**:
- Previous implementation had both `LogBasedHandler` (using `../log`) and `NotificationHandler` (using `../store`) for same data
- This created confusion about where notification data was stored and inconsistent access patterns
- Notifications are structured data that should be queryable and managed, making `../store` the appropriate choice
- `../log` should be used exclusively for application logging, not structured data storage

**Impact**: Single, consistent approach to notification data; clearer separation of logging vs data storage

### 4. Merged Notifications into Status Package

**Decision**: Moved notification functionality from `internal/notifications/` into `internal/status/`.

**Rationale**:
- Notifications are closely related to status monitoring and reporting
- Both handle monitoring Claude activity and providing status information to the UI
- Consolidating related functionality reduces package proliferation
- Results in more cohesive status monitoring module

**Impact**: Reduced package count from 11 to 7, better functional grouping

### 5. Removed Empty CLI Directory

**Decision**: Deleted empty `internal/cli/` directory.

**Rationale**: Directory contained no files and served no purpose.

**Impact**: Cleaner project structure

## Storage Architecture Clarification

### Established Pattern

- **../log Package**: Application logging, debugging, audit trails
  - Usage: `log.Get().WithComponent("component-name")` 
  - Purpose: Operational visibility and debugging
  
- **../store Package**: Structured data storage and retrieval
  - Usage: Direct `store.NewSQLiteStore()` and interface methods
  - Purpose: Application state, project metadata, notification records

### Benefits

- Clear separation of concerns between logging and data storage
- Consistent patterns throughout the application
- Eliminates confusion about where different types of data should be stored
- Makes data access patterns predictable and maintainable

## Results

### Package Structure: 11 → 7 Packages

**Before**: app, assistant, cli (empty), notifications, performance, projectstore, security, status, terminal, ui, worktree

**After**: app, assistant, security, status, terminal, ui, worktree

### Code Reduction: 470+ Lines Eliminated

- Performance package: 311 LOC
- ProjectStore wrapper: 159 LOC
- Empty directories and cleanup

### Improved Maintainability

- Clearer architectural boundaries
- Consistent storage patterns
- Reduced abstraction layers
- Better functional grouping

## Future Considerations

- Monitor for opportunities to further consolidate related functionality
- Maintain vigilance against reintroducing unnecessary abstraction layers
- Continue following established storage pattern separation
- Document any future architectural changes using this same decision record format

## Testing Impact

All existing functionality was preserved. Test suite continues to pass with only minimal compatibility updates required for changed import paths and method signatures.