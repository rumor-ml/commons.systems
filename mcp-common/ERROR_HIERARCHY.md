# MCP Error Handling Guide

This document explains the error handling system used across MCP (Model Context Protocol) servers in the commons.systems project.

## Overview

The mcp-common package provides:

1. **Error Classes**: Typed error hierarchy for categorizing failures
2. **Result Types**: Discriminated union types for tool results (ToolSuccess | ToolError)
3. **Result Builders**: Factory functions for creating standardized tool results
4. **Utility Functions**: Helper functions for error categorization and formatting

## Error Class Hierarchy

```
Error (built-in)
└── McpError (base class)
    ├── ValidationError
    ├── TimeoutError
    ├── NetworkError
    └── GitHubCliError
```

All MCP-specific errors extend the base `McpError` class.

## Error Classes

### McpError (Base Class)

**Purpose**: Base class for all MCP server errors

**Constructor**:

```typescript
new McpError(message: string, code?: ErrorCode)
```

**Properties**:

- `message: string` - Human-readable error description (inherited from Error)
- `name: string` - Always 'McpError'
- `code?: ErrorCode` - Optional error code for categorization
- `stack?: string` - Stack trace (inherited from Error)

**Example**:

```typescript
import { McpError } from '@commons/mcp-common/errors';

throw new McpError('Configuration error', 'PARSING_ERROR');
```

---

### ValidationError

**Purpose**: Input validation failures that require user correction

**Constructor**:

```typescript
new ValidationError(message: string)
```

**Properties**:

- `message: string` - Human-readable error description
- `name: string` - Always 'ValidationError'
- `code: 'VALIDATION_ERROR'` - Automatically set

**When to use**:

- Invalid function arguments (e.g., port out of range, malformed URL)
- Missing required parameters
- Type mismatches
- Format violations (e.g., invalid JSON, malformed paths)

**Retry behavior**: **Terminal** - `isTerminalError()` returns `true`. Do not retry, return error to user immediately.

**Example**:

```typescript
import { ValidationError } from '@commons/mcp-common/errors';

// Invalid port number
if (port < 0 || port > 65535) {
  throw new ValidationError('Port must be between 0 and 65535');
}

// Missing required parameter
if (!moduleName) {
  throw new ValidationError('Module name is required');
}
```

---

### TimeoutError

**Purpose**: Operations that exceed time limits

**Constructor**:

```typescript
new TimeoutError(message: string)
```

**Properties**:

- `message: string` - Human-readable error description
- `name: string` - Always 'TimeoutError'
- `code: 'TIMEOUT'` - Automatically set

**When to use**:

- Network requests that don't complete in time
- Long-running operations exceeding deadlines
- Process startup timeouts
- Service health check timeouts

**Retry behavior**: **Retryable** - `isTerminalError()` returns `false`. May succeed with more time or under better conditions.

**Example**:

```typescript
import { TimeoutError } from '@commons/mcp-common/errors';

if (elapsed > maxWaitTime) {
  throw new TimeoutError(`Operation timed out after ${elapsed}ms`);
}
```

---

### NetworkError

**Purpose**: Network-related failures

**Constructor**:

```typescript
new NetworkError(message: string)
```

**Properties**:

- `message: string` - Human-readable error description
- `name: string` - Always 'NetworkError'
- `code: 'NETWORK_ERROR'` - Automatically set

**When to use**:

- HTTP request failures
- Connection refused/reset errors
- DNS resolution failures
- Network timeouts

**Retry behavior**: **Retryable** - `isTerminalError()` returns `false`. May succeed on retry if network conditions improve.

**Example**:

```typescript
import { NetworkError } from '@commons/mcp-common/errors';

try {
  await fetch(url);
} catch (error) {
  throw new NetworkError(`Failed to fetch ${url}: ${error.message}`);
}
```

---

### GitHubCliError

**Purpose**: GitHub CLI (gh) command failures

**Constructor**:

```typescript
new GitHubCliError(
  message: string,
  exitCode: number,
  stderr: string,
  stdout?: string
)
```

**Properties**:

- `message: string` - Human-readable error description
- `name: string` - Always 'GitHubCliError'
- `code: 'GH_CLI_ERROR'` - Automatically set
- `exitCode: number` - Process exit code (clamped to 0-255)
- `stderr: string` - Standard error output (can be empty string)
- `stdout?: string` - Standard output (optional)

**Special behavior**: Exit codes outside 0-255 are automatically clamped with a warning in the message. This ensures error construction never fails.

**Example**:

```typescript
import { GitHubCliError } from '@commons/mcp-common/errors';

throw new GitHubCliError('Failed to create PR', 1, 'Error: could not create pull request', '');
```

## Result Types

### ToolResult (Discriminated Union)

```typescript
type ToolResult = ToolSuccess | ToolError;
```

### ToolSuccess

Represents a successful tool operation.

**Structure**:

```typescript
interface ToolSuccess {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError: false;
  readonly _meta?: Readonly<{ [key: string]: unknown }>;
  [key: string]: unknown; // MCP SDK compatibility
}
```

### ToolError

Represents a failed tool operation.

**Structure**:

```typescript
interface ToolError {
  readonly content: Array<{ readonly type: 'text'; readonly text: string }>;
  readonly isError: true;
  readonly _meta: Readonly<{
    readonly errorType: string;
    readonly errorCode?: string;
    [key: string]: unknown;
  }>;
  [key: string]: unknown; // MCP SDK compatibility
}
```

#### MCP SDK Compatibility

Both `ToolSuccess` and `ToolError` include an index signature `[key: string]: unknown`
to support MCP SDK extensions. This allows the MCP framework to add framework-specific
properties without breaking type compatibility.

**Important:** This reduces compile-time type safety. Always use the factory functions
(`createToolSuccess`, `createToolError`) instead of manually constructing these objects
to maintain proper typing and validation.

## Result Builder Functions

### createToolSuccess

Factory function for creating success results with fail-fast validation.

**Signature**:

```typescript
function createToolSuccess(text: string, meta?: Record<string, unknown>): ToolSuccess;
```

**Parameters**:

- `text`: Success message (required, empty strings allowed)
- `meta`: Optional metadata object

**Throws**:

- `ValidationError`: If `text` is `null` or `undefined`

**Usage**:

```typescript
import { createToolSuccess } from '@commons/mcp-common/types';

return createToolSuccess('Operation completed successfully');
return createToolSuccess('User created', { userId: '123' });
return createToolSuccess(''); // Empty string is valid

// These will throw ValidationError:
// createToolSuccess(null);       // Error: text is null
// createToolSuccess(undefined);  // Error: text is undefined
```

### createToolError

Factory function for creating error results with fail-fast validation.

**Signature**:

```typescript
function createToolError(
  text: string,
  errorType: string,
  errorCode?: string,
  meta?: Record<string, unknown>
): ToolError;
```

**Parameters**:

- `text`: Error message (required, empty strings allowed)
- `errorType`: Error type for categorization (required, must be non-empty after trimming)
- `errorCode`: Optional error code
- `meta`: Optional metadata object

**Throws**:

- `ValidationError`: If `text` is `null` or `undefined`
- `ValidationError`: If `errorType` is `null`, `undefined`, or empty/whitespace-only

**Usage**:

```typescript
import { createToolError } from '@commons/mcp-common/types';

return createToolError('File not found', 'NotFoundError', 'FILE_NOT_FOUND');
return createToolError('Invalid input', 'ValidationError');
return createToolError('', 'SilentError'); // Empty text is valid

// Whitespace trimmed automatically:
createToolError('error', '  ValidationError  '); // OK, trimmed to 'ValidationError'

// These will throw ValidationError:
// createToolError(null, 'Error');      // Error: text is null
// createToolError('msg', null);        // Error: errorType is null
// createToolError('msg', '');          // Error: errorType is empty
// createToolError('msg', '   ');       // Error: errorType is whitespace-only
```

### createErrorResult

Converts any error to a ToolError with automatic categorization.

**Signature**:

```typescript
function createErrorResult(error: unknown): ToolError;
```

**Usage**:

```typescript
import { createErrorResult } from '@commons/mcp-common/result-builders';

try {
  // ... operation
} catch (error) {
  return createErrorResult(error);
}
```

**Error Handling Strategy**:

- **System errors** (ENOMEM, ENOSPC, etc.): Re-thrown without wrapping
- **Programming errors** (TypeError, ReferenceError, SyntaxError): Logged with full stack trace and wrapped with `isProgrammingError: true` metadata
- **TimeoutError** → `errorType: 'TimeoutError', errorCode: 'TIMEOUT'`
- **ValidationError** → `errorType: 'ValidationError', errorCode: 'VALIDATION_ERROR'`
- **NetworkError** → `errorType: 'NetworkError', errorCode: 'NETWORK_ERROR'`
- **GitHubCliError** → `errorType: 'GitHubCliError', errorCode: 'GH_CLI_ERROR'` (includes exitCode, stderr, stdout in metadata)
- **McpError** → `errorType: 'McpError', errorCode: error.code`
- **Other errors** → `errorType: 'UnknownError'` (logged with stack trace)

### createErrorResultFromError

Specialized version that only handles McpError types. Can return null for non-MCP errors.

**Signature**:

```typescript
function createErrorResultFromError(error: unknown, fallbackToGeneric?: boolean): ToolError | null;
```

**Default Behavior Change (v0.3.0)**:

- **Old default** (v0.2.x): `fallbackToGeneric=true` - converts non-MCP errors to generic ToolError
- **New default** (v0.3.0): `fallbackToGeneric=false` - returns null for non-MCP errors (fail-fast)

**Development Mode Behavior**:

In NODE_ENV=development, throws ValidationError for non-MCP errors instead of returning null, providing immediate feedback during development.

**Usage**:

```typescript
import { createErrorResultFromError } from '@commons/mcp-common/result-builders';

// Fail-fast mode (new default)
const result = createErrorResultFromError(error);
if (result) {
  return result;
} else {
  // Handle non-MCP error differently
}

// Fallback mode (old behavior)
const result = createErrorResultFromError(error, true);
// Always returns ToolError
```

## Utility Functions

### analyzeRetryability

Analyzes an error to determine if it should be retried with structured metadata.

**Signature**:

```typescript
function analyzeRetryability(error: unknown): RetryDecision;

interface RetryDecision {
  readonly isTerminal: boolean;
  readonly errorType: string;
  readonly reason: string;
}
```

**Usage**:

```typescript
import { analyzeRetryability } from '@commons/mcp-common/errors';

const decision = analyzeRetryability(error);
if (decision.isTerminal) {
  console.error(`Terminal error (${decision.errorType}): ${decision.reason}`);
  return createErrorResult(error);
}

console.log(`Retrying (${decision.errorType}): ${decision.reason}`);
await retry(operation);
```

**Decision Details**:

- `isTerminal`: Whether the error is terminal (should not be retried)
- `errorType`: Error type (e.g., 'ValidationError', 'TimeoutError', 'Error', 'string')
- `reason`: Human-readable explanation of the decision

### isTerminalError

Determines if an error should terminate retry attempts. This is a convenience wrapper around `analyzeRetryability()` that returns only the boolean terminal status.

**Signature**:

```typescript
function isTerminalError(error: unknown): boolean;
```

**Retry Strategy**:

- ValidationError: **Terminal** (returns `true`) - requires user input correction
- TimeoutError: Retryable (returns `false`) - may succeed with more time
- NetworkError: Retryable (returns `false`) - transient network issues
- GitHubCliError: Retryable (returns `false`) - conservative default
- Other errors: Retryable (returns `false`) - conservative approach

**Usage**:

```typescript
import { isTerminalError } from '@commons/mcp-common/errors';

if (isTerminalError(error)) {
  // Don't retry, return error immediately
  return createErrorResult(error);
}

// Retry logic for non-terminal errors
await retry(operation, { maxRetries: 3 });
```

**Conservative default rationale**:

- Many infrastructure failures are temporary (DB locks, rate limits, etc.)
- Retrying maximizes system resilience without user intervention
- Retry limits prevent infinite loops
- Only ValidationError is definitively terminal

**Note**: For detailed retry decision information including error type and reason, use `analyzeRetryability()` instead.

### formatError

Formats errors for display with optional context.

**Signature**:

```typescript
function formatError(error: unknown, includeStack?: boolean): string;
```

**Usage**:

```typescript
import { formatError } from '@commons/mcp-common/errors';

// Basic formatting
console.error(formatError(error));
// Output: [TimeoutError] (TIMEOUT) Operation timed out

// With stack trace
console.error(formatError(error, true));
// Output: [TimeoutError] (TIMEOUT) Operation timed out
//         Stack: Error: Operation timed out
//             at ...
```

### isSystemError

Checks if an error is a critical system error that should be re-thrown without wrapping.

**Signature**:

```typescript
function isSystemError(error: unknown): boolean;
```

**System error codes**:

- `ENOMEM` - Out of memory
- `ENOSPC` - No space left on device
- `EMFILE` - Too many open files (process limit)
- `ENFILE` - Too many open files (system limit)

**Development Mode Behavior**:

In NODE_ENV=development, provides additional diagnostic information when an error object has a non-string code property.

**Usage**:

```typescript
import { isSystemError } from '@commons/mcp-common/errors';

try {
  // ... operation
} catch (error) {
  if (isSystemError(error)) {
    // Re-throw critical system errors without wrapping
    throw error;
  }
  // Handle other errors normally
  return createErrorResult(error);
}
```

**Note**: `createErrorResult()` automatically checks for system errors and re-throws them, so explicit checking is only needed in custom error handling code.

## Type Guards

### isToolError

Type guard to check if a result is an error.

**Usage**:

```typescript
import { isToolError } from '@commons/mcp-common/types';

if (isToolError(result)) {
  // TypeScript knows result is ToolError
  console.error(result._meta.errorType);
}
```

### isToolSuccess

Type guard to check if a result is successful.

**Usage**:

```typescript
import { isToolSuccess } from '@commons/mcp-common/types';

if (isToolSuccess(result)) {
  // TypeScript knows result is ToolSuccess
  console.log(result.content[0].text);
}
```

### validateToolResult

Runtime validator to check if an unknown value is a valid ToolResult.

**Signature**:

```typescript
function validateToolResult(result: unknown): result is ToolResult;
```

**Validation checks**:

- Object exists and is not null
- Has 'isError' and 'content' properties
- Content is a non-empty array
- If isError is true, \_meta must exist with non-empty string errorType
- If isError is false, no required \_meta fields

**Usage**:

```typescript
import { validateToolResult } from '@commons/mcp-common/types';

// Validate external data or API responses
const data: unknown = await fetchFromAPI();
if (validateToolResult(data)) {
  // TypeScript knows data is ToolResult
  if (data.isError) {
    console.error(data._meta.errorType);
  }
} else {
  throw new Error('Invalid tool result format');
}
```

## Complete Usage Example

```typescript
import {
  ValidationError,
  TimeoutError,
  NetworkError,
  isTerminalError,
  formatError,
} from '@commons/mcp-common/errors';
import { createErrorResult, createSuccessResult } from '@commons/mcp-common/result-builders';
import type { ToolResult } from '@commons/mcp-common/types';

async function processRequest(params: { url: string; timeout: number }): Promise<ToolResult> {
  // Validate input
  if (!params.url) {
    throw new ValidationError('URL is required');
  }

  if (params.timeout <= 0) {
    throw new ValidationError('Timeout must be positive');
  }

  try {
    const result = await fetchWithTimeout(params.url, params.timeout);
    return createSuccessResult(`Fetched ${result.length} bytes`);
  } catch (error) {
    // Log the error with formatting
    console.error('Request failed:', formatError(error));

    // Check if we should retry
    if (!isTerminalError(error)) {
      // Implement retry logic here
      console.log('Error is retryable, attempting retry...');
    }

    // Convert to tool error result
    return createErrorResult(error);
  }
}

async function fetchWithTimeout(url: string, timeout: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.text();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new TimeoutError(`Request timed out after ${timeout}ms`);
    }
    throw new NetworkError(`Network request failed: ${error.message}`);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Best Practices

1. **Use specific error classes**: Prefer `ValidationError`, `TimeoutError`, etc. over generic `McpError`
2. **Provide clear messages**: Error messages should help users understand what went wrong and how to fix it
3. **Fail-fast validation**: Factory functions throw `ValidationError` for null/undefined inputs - catch these during development/testing
4. **Use result builders**: Always use `createErrorResult()` or `createSuccessResult()` instead of manually constructing result objects
5. **Respect retry strategy**: Check `isTerminalError()` before implementing retry logic
6. **Handle system errors carefully**: Re-throw system errors (`isSystemError()`) without wrapping
7. **Log with context**: Use `formatError(error, true)` to include stack traces in logs
8. **Type-safe error handling**: Use discriminated unions and type guards for compile-time safety

## Immutability Guarantees

Factory functions use `Object.freeze()` for **shallow immutability only**:

**✅ Protected (Immutable):**

```typescript
const result = createToolSuccess('msg', { count: 5 });
result.isError = true; // TypeError: Cannot assign to readonly property
result._meta = {}; // TypeError: Cannot assign to readonly property
result._meta.count = 10; // TypeError: Cannot assign to readonly property
```

**❌ Not Protected (Mutable):**

```typescript
const result = createToolSuccess('msg', { items: [1, 2], config: { debug: true } });
result._meta.items.push(3); // WORKS - array is mutable
result._meta.config.debug = false; // WORKS - nested object is mutable
```

**Development Mode Warnings and Validations:**

In development mode (`NODE_ENV === 'development'`), factory functions provide enhanced validation:

- **Nested objects warning**: Warns when metadata contains nested objects that are not deeply frozen
- **Reserved keys**: `createToolError()` throws ValidationError if meta contains reserved keys ('isError', 'content') instead of just warning
- **Array validation**: Both factories throw ValidationError if text parameter is an array instead of a string
- **Non-MCP errors**: `createErrorResultFromError()` throws ValidationError for non-MCP errors when `fallbackToGeneric=false`

**Best Practice:**

Treat result objects as immutable even though nested structures technically can be modified. The type system provides compile-time guarantees; runtime enforcement is shallow by design for performance.

## Migration Guide: Safe-Defaults to Fail-Fast

**Version**: 0.2.0 (Breaking changes)

### What Changed

Factory functions now throw `ValidationError` for invalid inputs instead of using safe defaults.

### Breaking Changes

**Before (v0.1.x)**:

```typescript
createToolSuccess(null); // Returned: "[Warning: ...] [Error: missing...]"
createToolError('msg', ''); // Returned: errorType = 'UnknownError'
```

**After (v0.2.x)**:

```typescript
createToolSuccess(null); // Throws ValidationError
createToolError('msg', ''); // Throws ValidationError
```

### Migration Steps

Ensure inputs are never null/undefined:

```typescript
// BEFORE (risky)
const message = data?.message;
return createToolSuccess(message);

// AFTER (safe)
const message = data?.message ?? 'Operation completed';
return createToolSuccess(message);
```

### What Stayed the Same

- Empty strings are still valid: `createToolSuccess('')` works
- `createErrorResult()` still converts unknown errors gracefully
- `GitHubCliError` still clamps invalid exit codes
