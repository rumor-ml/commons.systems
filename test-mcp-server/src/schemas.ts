/**
 * Zod schemas for runtime validation
 *
 * These schemas validate tool inputs at API boundaries to catch invalid data
 * before it reaches business logic. This provides an extra layer of safety
 * beyond TypeScript's compile-time checks.
 */

import { z } from 'zod';

/**
 * Port number validation schema
 *
 * Validates that a port is:
 * - An integer
 * - Between 0 and 65535
 */
export const PortSchema = z
  .number()
  .int('Port must be an integer')
  .min(0, 'Port must be at least 0')
  .max(65535, 'Port must be at most 65535');

/**
 * Module name validation schema
 *
 * Validates that a module name:
 * - Is a non-empty string
 * - Matches valid module name pattern (alphanumeric, dashes, underscores)
 * - Is not too long (max 100 chars)
 */
export const ModuleNameSchema = z
  .string()
  .min(1, 'Module name cannot be empty')
  .max(100, 'Module name too long (max 100 characters)')
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    'Module name must contain only letters, numbers, dashes, and underscores'
  );

/**
 * Test pattern validation schema
 *
 * Validates test name patterns for filtering tests
 */
export const TestPatternSchema = z
  .string()
  .max(200, 'Test pattern too long (max 200 characters)')
  .optional();

/**
 * Timeout validation schema
 *
 * Validates timeout values:
 * - Must be a positive integer
 * - Max 1 hour (3600000 ms)
 */
export const TimeoutSchema = z
  .number()
  .int('Timeout must be an integer')
  .min(1000, 'Timeout must be at least 1000ms (1 second)')
  .max(3600000, 'Timeout must be at most 3600000ms (1 hour)')
  .optional()
  .default(300000);

/**
 * Boolean flag validation schema
 */
export const BooleanSchema = z.boolean().optional().default(false);

/**
 * Service name validation schema
 *
 * For Firebase emulator services
 */
export const ServiceNameSchema = z.enum([
  'auth',
  'firestore',
  'storage',
  'functions',
  'database',
  'hosting',
  'pubsub',
]);

/**
 * Service array validation schema
 */
export const ServicesSchema = z.array(ServiceNameSchema).optional();

/**
 * Worktree path validation schema
 *
 * Validates absolute paths (must start with /)
 */
export const WorktreePathSchema = z
  .string()
  .min(1, 'Worktree path cannot be empty')
  .refine((path) => path.startsWith('/'), {
    message: 'Worktree path must be absolute (start with /)',
  })
  .optional();

/**
 * test_run tool arguments schema
 */
export const TestRunArgsSchema = z.object({
  module: ModuleNameSchema.optional(),
  pattern: TestPatternSchema,
  timeout_seconds: TimeoutSchema,
  watch: BooleanSchema,
});

/**
 * test_list_modules tool arguments schema
 */
export const TestListModulesArgsSchema = z.object({});

/**
 * test_get_status tool arguments schema
 */
export const TestGetStatusArgsSchema = z.object({
  module: ModuleNameSchema.optional(),
});

/**
 * emulator_start tool arguments schema
 */
export const EmulatorStartArgsSchema = z.object({
  services: ServicesSchema,
  timeout_seconds: TimeoutSchema,
});

/**
 * emulator_stop tool arguments schema
 */
export const EmulatorStopArgsSchema = z.object({
  timeout_seconds: TimeoutSchema,
});

/**
 * emulator_status tool arguments schema
 */
export const EmulatorStatusArgsSchema = z.object({});

/**
 * dev_server_start tool arguments schema
 */
export const DevServerStartArgsSchema = z.object({
  module: ModuleNameSchema,
  timeout_seconds: TimeoutSchema,
  with_emulators: BooleanSchema.default(true),
});

/**
 * dev_server_stop tool arguments schema
 */
export const DevServerStopArgsSchema = z.object({
  timeout_seconds: TimeoutSchema,
  with_emulators: BooleanSchema.default(false),
});

/**
 * dev_server_status tool arguments schema
 */
export const DevServerStatusArgsSchema = z.object({});

/**
 * cleanup_orphans tool arguments schema
 */
export const CleanupOrphansArgsSchema = z.object({
  dry_run: BooleanSchema,
  force: BooleanSchema.default(true),
});

/**
 * cleanup_worktree tool arguments schema
 */
export const CleanupWorktreeArgsSchema = z.object({
  worktree_path: WorktreePathSchema,
});

/**
 * get_port_allocation tool arguments schema
 */
export const GetPortAllocationArgsSchema = z.object({
  service: z.string().optional(),
});

/**
 * Validate tool arguments against a schema
 *
 * @param schema - Zod schema to validate against
 * @param args - Arguments to validate
 * @returns Validated and parsed arguments
 * @throws z.ZodError if validation fails
 *
 * @example
 * ```typescript
 * try {
 *   const args = validateArgs(TestRunArgsSchema, rawArgs);
 *   // args is now type-safe and validated
 * } catch (error) {
 *   if (error instanceof z.ZodError) {
 *     return createToolError(error.message, 'ValidationError', 'INVALID_ARGS');
 *   }
 * }
 * ```
 */
export function validateArgs<T extends z.ZodType>(schema: T, args: unknown): z.infer<T> {
  return schema.parse(args);
}

/**
 * Safely validate tool arguments and return a result
 *
 * @param schema - Zod schema to validate against
 * @param args - Arguments to validate
 * @returns Success with parsed args, or error with validation message
 *
 * @example
 * ```typescript
 * const result = safeValidateArgs(TestRunArgsSchema, rawArgs);
 * if (!result.success) {
 *   return createToolError(result.error, 'ValidationError', 'INVALID_ARGS');
 * }
 * const args = result.data;
 * ```
 */
export function safeValidateArgs<T extends z.ZodType>(
  schema: T,
  args: unknown
): { success: true; data: z.infer<T> } | { success: false; error: string } {
  const result = schema.safeParse(args);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format Zod errors into a readable message
  const errorMessage = result.error.errors
    .map((err) => {
      const path = err.path.join('.');
      return path ? `${path}: ${err.message}` : err.message;
    })
    .join('; ');

  return { success: false, error: errorMessage };
}
