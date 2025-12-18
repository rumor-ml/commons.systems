# MCP Error Hierarchy Documentation

This document explains the error type hierarchy used across MCP (Model Context Protocol) servers in the commons.systems project.

## Error Class Hierarchy

```
McpError (base class)
├── ValidationError
├── TimeoutError
└── NetworkError
```

All MCP-specific errors extend the base `McpError` class, which provides:

- Structured error information (`errorType`, `errorCode`, `retryable`)
- Conversion to MCP tool error results via `toToolError()`
- TypeScript type safety through discriminated unions

## Error Types

### McpError (Base Class)

**Purpose**: Base class for all MCP server errors

**Properties**:

- `message: string` - Human-readable error description
- `errorType: string` - Machine-readable error category (e.g., "ValidationError")
- `errorCode?: string` - Optional specific error code (e.g., "INVALID_PORT")
- `retryable: boolean` - Whether the operation should be retried

**Usage**:

```typescript
// Extend for custom error types
class CustomError extends McpError {
  constructor(message: string, errorCode?: string) {
    super(message, 'CustomError', errorCode, false);
  }
}
```

**Methods**:

- `toToolError(): ToolError` - Converts to MCP tool error result format

---

### ValidationError

**Purpose**: Input validation failures that require user correction

**When to use**:

- Invalid function arguments (e.g., port out of range, malformed URL)
- Missing required parameters
- Type mismatches
- Format violations (e.g., invalid JSON, malformed paths)

**Characteristics**:

- **Retryable**: `false` - Bad input won't become valid without user intervention
- **User action required**: Yes - user must provide correct input

**Example scenarios**:

```typescript
// Invalid port number
throw new ValidationError('Port must be between 0 and 65535', 'INVALID_PORT');

// Missing required parameter
throw new ValidationError('Module name is required', 'MISSING_PARAMETER');

// Malformed input
throw new ValidationError('Invalid JSON in configuration', 'INVALID_JSON');
```

**Retry strategy**: Terminal - do not retry, return error to user immediately

---

### TimeoutError

**Purpose**: Operations that exceed time limits

**When to use**:

- Network requests that don't complete in time
- Long-running operations exceeding deadlines
- Process startup timeouts
- Service health check timeouts

**Characteristics**:

- **Retryable**: `true` - May succeed with more time or under better conditions
- **User action required**: Optional - user may adjust timeout settings

**Example scenarios**:

```typescript
// Workflow run monitoring timeout
throw new TimeoutError('Workflow run did not complete within 600 seconds', 'WORKFLOW_TIMEOUT');

// Dev server startup timeout
throw new TimeoutError('Dev server failed to start within 120 seconds', 'STARTUP_TIMEOUT');

// Firebase emulator startup timeout
throw new TimeoutError('Emulator did not become ready within timeout', 'EMULATOR_TIMEOUT');
```

**Retry strategy**: Retry with backoff - transient load or network issues may resolve

---

### NetworkError

**Purpose**: Network connectivity and communication failures

**When to use**:

- HTTP request failures (connection refused, DNS errors)
- API call failures (503 Service Unavailable, network timeouts)
- Socket connection errors
- TLS/SSL handshake failures

**Characteristics**:

- **Retryable**: `true` - Network issues are often transient
- **User action required**: Optional - user may check network connection

**Example scenarios**:

```typescript
// GitHub API unavailable
throw new NetworkError('Failed to fetch GitHub workflow run', 'GITHUB_API_ERROR');

// Firebase connection failure
throw new NetworkError('Cannot connect to Firestore emulator', 'FIRESTORE_CONNECTION_ERROR');

// HTTP request error
throw new NetworkError('Request failed with status 503', 'SERVICE_UNAVAILABLE');
```

**Retry strategy**: Retry with exponential backoff - many network failures are temporary

---

## Retry Strategy Decision Tree

Use `isTerminalError(error)` to determine if an operation should be retried:

```typescript
import { isTerminalError } from '@commons/mcp-common/errors';

try {
  await operation();
} catch (error) {
  if (isTerminalError(error)) {
    // ValidationError - don't retry, return error to user
    return error.toToolError();
  } else {
    // TimeoutError, NetworkError, or unknown - retry with backoff
    if (attempt < maxRetries) {
      await sleep(backoff);
      return retry();
    }
    return error.toToolError();
  }
}
```

### Retry Guidelines

| Error Type      | Terminal? | Retry? | Max Retries | Backoff     |
| --------------- | --------- | ------ | ----------- | ----------- |
| ValidationError | Yes       | No     | N/A         | N/A         |
| TimeoutError    | No        | Yes    | 3-5         | Exponential |
| NetworkError    | No        | Yes    | 3-5         | Exponential |
| Unknown errors  | No        | Yes    | 3           | Exponential |

**Conservative Default**: Unknown errors are treated as retryable because:

1. Many infrastructure failures (DB locks, rate limits) are temporary
2. Retrying maximizes system resilience without user intervention
3. Retry limits prevent infinite loops
4. Only ValidationError is definitively terminal

---

## Integration with MCP Tool Results

All error classes integrate with the MCP tool result system via the `toToolError()` method:

```typescript
import { ValidationError } from '@commons/mcp-common/errors';

function myTool(port: number): ToolResult {
  if (port < 0 || port > 65535) {
    const error = new ValidationError('Port must be 0-65535', 'INVALID_PORT');
    return error.toToolError();
  }

  return createToolSuccess('Port is valid');
}
```

The `toToolError()` method returns a properly formatted `ToolError` with:

- `content`: Human-readable error message
- `isError: true`: Discriminant for type narrowing
- `_meta`: Structured error metadata (errorType, errorCode, retryable)

---

## Error Code Conventions

Error codes should be:

- **SCREAMING_SNAKE_CASE**: All uppercase with underscores
- **Specific**: Describe the exact failure condition
- **Stable**: Don't change codes between versions (breaking change)

**Good error codes**:

- `INVALID_PORT` - Clear, specific
- `WORKFLOW_TIMEOUT` - Describes what timed out
- `GITHUB_API_ERROR` - Indicates external service failure

**Bad error codes**:

- `ERROR` - Too generic
- `invalidPort` - Wrong case
- `ERR_1` - Not descriptive

---

## Creating Custom Error Types

To add a new error type:

1. Extend `McpError` in `mcp-common/src/errors.ts`:

```typescript
export class AuthenticationError extends McpError {
  constructor(message: string, errorCode?: string) {
    super(
      message,
      'AuthenticationError', // errorType
      errorCode,
      false // not retryable - user must re-authenticate
    );
    this.name = 'AuthenticationError';
  }
}
```

2. Update `isTerminalError()` if the error should not be retried:

```typescript
export function isTerminalError(error: unknown): boolean {
  return error instanceof ValidationError || error instanceof AuthenticationError; // Add here
}
```

3. Export from index and update documentation:

```typescript
// mcp-common/src/index.ts
export { AuthenticationError } from './errors.js';
```

4. Document in this file with examples and retry strategy

---

## Real-World Examples

### Example 1: GitHub Workflow Monitor

```typescript
export async function monitorWorkflow(runId: number): Promise<ToolResult> {
  try {
    const result = await waitForWorkflowCompletion(runId, { timeout: 600000 });
    return createToolSuccess(`Workflow completed: ${result.conclusion}`);
  } catch (error) {
    if (error instanceof TimeoutError) {
      // Retryable - workflow may complete if given more time
      return error.toToolError();
    }
    if (error instanceof NetworkError) {
      // Retryable - GitHub API may be temporarily unavailable
      return error.toToolError();
    }
    if (error instanceof ValidationError) {
      // Terminal - invalid run ID won't become valid
      return error.toToolError();
    }
    // Unknown error - treat as retryable
    return createToolError(String(error), 'UnknownError');
  }
}
```

### Example 2: Test Execution

```typescript
export async function runTests(module?: string): Promise<ToolResult> {
  // Validate input
  if (module && !isValidModule(module)) {
    const error = new ValidationError(
      `Invalid module "${module}". Valid modules: printsync, financesync`,
      'INVALID_MODULE'
    );
    return error.toToolError(); // Terminal - don't retry
  }

  try {
    const result = await executeTests(module);
    return createToolSuccess(result.summary);
  } catch (error) {
    if (error instanceof TimeoutError) {
      // Tests timed out - may succeed with longer timeout
      return error.toToolError();
    }
    // Test failure is not an error type - return as success with failure info
    return createToolSuccess(`Tests failed: ${error.message}`);
  }
}
```

### Example 3: With Retry Logic

```typescript
async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (isTerminalError(error)) {
        // Don't retry ValidationError
        throw error;
      }

      if (attempt === maxRetries) {
        // Max retries exceeded
        throw error;
      }

      // Exponential backoff: 1s, 2s, 4s
      const backoff = Math.pow(2, attempt - 1) * 1000;
      await sleep(backoff);
    }
  }

  throw new Error('Retry logic failed');
}
```

---

## Testing Error Handling

When testing MCP tools, verify error handling for each error type:

```typescript
import { describe, it, expect } from 'vitest';

describe('myTool error handling', () => {
  it('returns ValidationError for invalid input', async () => {
    const result = await myTool({ port: -1 });

    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result._meta.errorType).toBe('ValidationError');
      expect(result._meta.errorCode).toBe('INVALID_PORT');
      expect(result._meta.retryable).toBe(false);
    }
  });

  it('returns TimeoutError when operation times out', async () => {
    const result = await myTool({ timeout: 1 });

    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result._meta.errorType).toBe('TimeoutError');
      expect(result._meta.retryable).toBe(true);
    }
  });

  it('returns NetworkError on connection failure', async () => {
    mockNetworkFailure();
    const result = await myTool({});

    expect(result.isError).toBe(true);
    if (result.isError) {
      expect(result._meta.errorType).toBe('NetworkError');
      expect(result._meta.retryable).toBe(true);
    }
  });
});
```

---

## Migration Guide

If you have existing error handling code, migrate as follows:

**Before** (raw errors):

```typescript
function myTool(input: string): ToolResult {
  if (!input) {
    return createToolError('Input is required', 'ValidationError');
  }
  // ...
}
```

**After** (typed errors):

```typescript
import { ValidationError } from '@commons/mcp-common/errors';

function myTool(input: string): ToolResult {
  if (!input) {
    return new ValidationError('Input is required', 'INPUT_REQUIRED').toToolError();
  }
  // ...
}
```

Benefits of migration:

- Type safety - TypeScript knows the error structure
- Consistent error format across all MCP servers
- Automatic retry strategy via `isTerminalError()`
- Better error codes and categorization

---

## References

- Source code: `mcp-common/src/errors.ts`
- Type definitions: `mcp-common/src/types.ts`
- Example usage: `test-mcp-server/src/tools/*.ts`
- MCP SDK: https://github.com/modelcontextprotocol/typescript-sdk
