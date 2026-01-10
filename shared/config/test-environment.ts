/**
 * Test Environment Configuration
 * Centralized, type-safe configuration for E2E test environment
 *
 * This module provides a single source of truth for test environment configuration,
 * eliminating env var propagation issues and providing clear error messages when misconfigured.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Test environment mode
 */
export type TestMode = 'emulator' | 'deployed';

/**
 * Branded type for validated host:port strings
 */
// TODO(#1358): Add runtime validation guards (isHostPort, assertHostPort) to prevent unsafe casts
type HostPort = string & { readonly __brand: 'HostPort' };

/**
 * Branded type for validated port numbers
 */
type ValidPort = number & { readonly __brand: 'ValidPort' };

/**
 * Branded type for non-empty strings
 */
type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };

/**
 * Firebase emulator configuration
 */
export interface EmulatorConfig {
  /** GCP Project ID for emulator isolation */
  projectId: NonEmptyString;

  /** Firestore emulator host (format: "host:port") */
  firestoreHost: HostPort;

  /** Auth emulator host (format: "host:port") */
  authHost: HostPort;

  /** Storage emulator host (format: "host:port") */
  storageHost: HostPort;

  /** Hosting emulator port number */
  hostingPort: ValidPort;
}

/**
 * Base test environment configuration shared by all modes
 */
interface BaseTestEnvironment {
  /** Whether running in CI environment */
  isCI: boolean;

  /** Test timeout configuration */
  timeouts: {
    /** Default test timeout in seconds */
    test: number;

    /** Emulator startup timeout in seconds */
    emulatorStartup: number;

    /** Timeout multiplier for slow systems */
    multiplier: number;
  };
}

/**
 * Test environment configuration for emulator mode
 */
export interface EmulatorTestEnvironment extends BaseTestEnvironment {
  /** Test mode: emulator (local/CI) */
  mode: 'emulator';

  /** Firebase emulator configuration (required for emulator mode) */
  emulators: EmulatorConfig;

  /** Deployed URL is not used in emulator mode */
  deployedUrl?: never;
}

/**
 * Test environment configuration for deployed mode
 */
export interface DeployedTestEnvironment extends BaseTestEnvironment {
  /** Test mode: deployed (production) */
  mode: 'deployed';

  /** Emulator configuration is not used in deployed mode */
  emulators?: never;

  /** Deployed URL for production testing (required for deployed mode) */
  deployedUrl: string;
}

/**
 * Complete test environment configuration (discriminated union)
 */
// TODO(#1359): Consider adding type guard functions (isEmulatorEnvironment, isDeployedEnvironment) for cleaner narrowing
export type TestEnvironment = EmulatorTestEnvironment | DeployedTestEnvironment;

/**
 * Validate and create a host:port string
 * @throws Error if format is invalid
 */
function validateHostPort(value: string, fieldName: string): HostPort {
  if (!value || typeof value !== 'string' || !value.includes(':')) {
    throw new Error(`${fieldName} must be a string in format "host:port", got: ${value}`);
  }
  return value as HostPort;
}

/**
 * Validate and create a valid port number
 * @throws Error if port is out of range
 */
function validatePort(value: number, fieldName: string): ValidPort {
  if (typeof value !== 'number' || value < 1 || value > 65535) {
    throw new Error(`${fieldName} must be a valid port number (1-65535), got: ${value}`);
  }
  return value as ValidPort;
}

/**
 * Validate and create a non-empty string
 * @throws Error if string is empty
 */
function validateNonEmptyString(value: string, fieldName: string): NonEmptyString {
  if (!value || typeof value !== 'string') {
    throw new Error(`${fieldName} must be a non-empty string, got: ${value}`);
  }
  return value as NonEmptyString;
}

/**
 * Factory function to create a validated EmulatorConfig
 * Enforces all format invariants at construction time
 *
 * @param config - Raw configuration object
 * @returns Validated EmulatorConfig
 * @throws Error if any field is invalid
 */
export function createEmulatorConfig(config: {
  projectId: string;
  firestoreHost: string;
  authHost: string;
  storageHost: string;
  hostingPort: number;
}): EmulatorConfig {
  return {
    projectId: validateNonEmptyString(config.projectId, 'projectId'),
    firestoreHost: validateHostPort(config.firestoreHost, 'firestoreHost'),
    authHost: validateHostPort(config.authHost, 'authHost'),
    storageHost: validateHostPort(config.storageHost, 'storageHost'),
    hostingPort: validatePort(config.hostingPort, 'hostingPort'),
  };
}

/**
 * Factory function to create a validated EmulatorTestEnvironment
 * Enforces discriminated union invariants at construction time
 *
 * @param config - Raw configuration object
 * @returns Validated EmulatorTestEnvironment
 * @throws Error if configuration is invalid
 */
export function createEmulatorEnvironment(config: {
  emulators: EmulatorConfig;
  isCI: boolean;
  timeouts: {
    test: number;
    emulatorStartup: number;
    multiplier: number;
  };
}): EmulatorTestEnvironment {
  // Validate timeouts
  if (typeof config.timeouts.test !== 'number' || config.timeouts.test <= 0) {
    throw new Error('timeouts.test must be a positive number');
  }
  if (typeof config.timeouts.emulatorStartup !== 'number' || config.timeouts.emulatorStartup <= 0) {
    throw new Error('timeouts.emulatorStartup must be a positive number');
  }
  if (typeof config.timeouts.multiplier !== 'number' || config.timeouts.multiplier <= 0) {
    throw new Error('timeouts.multiplier must be a positive number');
  }

  return {
    mode: 'emulator',
    isCI: config.isCI,
    emulators: config.emulators,
    timeouts: config.timeouts,
  };
}

/**
 * Factory function to create a validated DeployedTestEnvironment
 * Enforces discriminated union invariants at construction time
 *
 * @param config - Raw configuration object
 * @returns Validated DeployedTestEnvironment
 * @throws Error if configuration is invalid
 */
export function createDeployedEnvironment(config: {
  deployedUrl: string;
  isCI: boolean;
  timeouts: {
    test: number;
    emulatorStartup: number;
    multiplier: number;
  };
}): DeployedTestEnvironment {
  // Validate deployedUrl
  if (!config.deployedUrl || typeof config.deployedUrl !== 'string') {
    throw new Error('deployedUrl must be a non-empty string');
  }

  // Validate timeouts
  if (typeof config.timeouts.test !== 'number' || config.timeouts.test <= 0) {
    throw new Error('timeouts.test must be a positive number');
  }
  if (typeof config.timeouts.emulatorStartup !== 'number' || config.timeouts.emulatorStartup <= 0) {
    throw new Error('timeouts.emulatorStartup must be a positive number');
  }
  if (typeof config.timeouts.multiplier !== 'number' || config.timeouts.multiplier <= 0) {
    throw new Error('timeouts.multiplier must be a positive number');
  }

  return {
    mode: 'deployed',
    isCI: config.isCI,
    deployedUrl: config.deployedUrl,
    timeouts: config.timeouts,
  };
}

/**
 * Load and validate test environment configuration
 *
 * @param configPath - Optional path to config file (defaults to .test-env.json in project root)
 * @returns Validated test environment configuration
 * @throws Error if configuration is missing or invalid
 */
export function loadTestEnvironment(configPath?: string): TestEnvironment {
  // Default to .test-env.json in project root
  const defaultPath = join(process.cwd(), '.test-env.json');
  const filePath = configPath || defaultPath;

  // Check if config file exists
  if (!existsSync(filePath)) {
    throw new Error(
      `Test environment configuration not found at: ${filePath}\n` +
        `Run infrastructure/scripts/run-e2e-tests.sh or allocate-test-ports.sh to generate it.`
    );
  }

  // Parse JSON config
  let config: any;
  try {
    const fileContent = readFileSync(filePath, 'utf-8');
    config = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse test environment configuration at: ${filePath}\n` +
        `Error: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Validate required fields
  return validateTestEnvironment(config, filePath);
}

/**
 * Validate test environment configuration object
 *
 * @param config - Configuration object to validate
 * @param source - Source of configuration (for error messages)
 * @returns Validated configuration
 * @throws Error if configuration is invalid
 */
export function validateTestEnvironment(config: any, source: string = 'config'): TestEnvironment {
  const errors: string[] = [];

  // Validate mode
  if (!config.mode || !['emulator', 'deployed'].includes(config.mode)) {
    errors.push(`mode must be 'emulator' or 'deployed', got: ${config.mode}`);
  }

  // Validate isCI
  if (typeof config.isCI !== 'boolean') {
    errors.push(`isCI must be boolean, got: ${typeof config.isCI}`);
  }

  // Mode-specific validation
  if (config.mode === 'emulator') {
    // Validate emulators (required for emulator mode)
    if (!config.emulators) {
      errors.push('emulators configuration is required for emulator mode');
    } else {
      // Validate projectId
      if (!config.emulators.projectId || typeof config.emulators.projectId !== 'string') {
        errors.push('emulators.projectId is required and must be a non-empty string');
      }

      // Validate host strings (format: "host:port")
      const hostFields = ['firestoreHost', 'authHost', 'storageHost'];
      for (const field of hostFields) {
        const value = config.emulators[field];
        if (!value || typeof value !== 'string' || !value.includes(':')) {
          errors.push(`emulators.${field} must be a string in format "host:port", got: ${value}`);
        }
      }

      // Validate hostingPort
      const hostingPort = config.emulators.hostingPort;
      if (typeof hostingPort !== 'number' || hostingPort < 1 || hostingPort > 65535) {
        errors.push(
          `emulators.hostingPort must be a valid port number (1-65535), got: ${hostingPort}`
        );
      }
    }

    // Deployed URL should not be present in emulator mode
    if (config.deployedUrl !== undefined) {
      errors.push('deployedUrl should not be set in emulator mode');
    }
  } else if (config.mode === 'deployed') {
    // Validate deployedUrl (required for deployed mode)
    if (!config.deployedUrl || typeof config.deployedUrl !== 'string') {
      errors.push('deployedUrl is required and must be a non-empty string for deployed mode');
    }

    // Emulators should not be present in deployed mode
    if (config.emulators !== undefined) {
      errors.push('emulators should not be set in deployed mode');
    }
  }

  // Validate timeouts
  if (!config.timeouts) {
    errors.push('timeouts configuration is required');
  } else {
    const timeoutFields = ['test', 'emulatorStartup', 'multiplier'];
    for (const field of timeoutFields) {
      const value = config.timeouts[field];
      if (typeof value !== 'number' || value <= 0) {
        errors.push(`timeouts.${field} must be a positive number, got: ${value}`);
      }
    }
  }

  // Throw if any validation errors
  if (errors.length > 0) {
    throw new Error(
      `Invalid test environment configuration in ${source}:\n` +
        errors.map((e) => `  - ${e}`).join('\n')
    );
  }

  return config as TestEnvironment;
}

/**
 * Get test environment configuration from environment variables
 * This is a fallback for when .test-env.json is not available
 *
 * @returns Test environment configuration
 */
export function getTestEnvironmentFromEnv(): TestEnvironment {
  const isCI = process.env.CI === 'true';
  const deployedUrl = process.env.DEPLOYED_URL;

  // Get timeout multiplier (default: 1)
  const timeoutMultiplier = parseInt(process.env.TIMEOUT_MULTIPLIER || '1');

  // Build base timeouts configuration
  const timeouts = {
    test: 60 * timeoutMultiplier,
    emulatorStartup: 120 * timeoutMultiplier,
    multiplier: timeoutMultiplier,
  };

  // Return discriminated union based on mode using factory functions
  if (deployedUrl) {
    // Deployed mode: requires deployedUrl, no emulators
    return createDeployedEnvironment({
      deployedUrl,
      isCI,
      timeouts,
    });
  } else {
    // Emulator mode: requires emulators, no deployedUrl
    const emulators = createEmulatorConfig({
      projectId: process.env.GCP_PROJECT_ID || 'demo-test',
      firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081',
      authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
      storageHost: process.env.STORAGE_EMULATOR_HOST || '127.0.0.1:9199',
      hostingPort: parseInt(process.env.HOSTING_PORT || '5002'),
    });

    return createEmulatorEnvironment({
      emulators,
      isCI,
      timeouts,
    });
  }
}
