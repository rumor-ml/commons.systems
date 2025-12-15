/**
 * Utilities for parsing port information from script output
 */

/**
 * Parse a single port number from a regex match
 * @param match - The regex match result
 * @param index - The capture group index (default: 1)
 * @returns Parsed port number or undefined
 */
export function parsePort(match: RegExpMatchArray | null, index: number = 1): number | undefined {
  if (!match) return undefined;
  const portStr = match[index];
  if (!portStr) return undefined;
  const port = parseInt(portStr, 10);
  return isNaN(port) ? undefined : port;
}

export interface EmulatorPorts {
  auth?: number;
  firestore?: number;
  storage?: number;
  ui?: number;
}

/**
 * Parse emulator port information from script output lines
 * @param lines - Lines of script output
 * @returns Partial emulator ports object
 */
export function parseEmulatorPorts(lines: string[]): EmulatorPorts {
  const ports: EmulatorPorts = {};

  for (const line of lines) {
    // Parse lines like: "  Auth: localhost:10000"
    const authMatch = line.match(/Auth:\s*localhost:(\d+)/);
    if (authMatch) {
      ports.auth = parsePort(authMatch);
    }

    const firestoreMatch = line.match(/Firestore:\s*localhost:(\d+)/);
    if (firestoreMatch) {
      ports.firestore = parsePort(firestoreMatch);
    }

    const storageMatch = line.match(/Storage:\s*localhost:(\d+)/);
    if (storageMatch) {
      ports.storage = parsePort(storageMatch);
    }

    const uiMatch = line.match(/UI:\s*http:\/\/localhost:(\d+)/);
    if (uiMatch) {
      ports.ui = parsePort(uiMatch);
    }
  }

  return ports;
}

export interface ServiceHealth {
  port: number;
  healthy: boolean;
}

export interface EmulatorServicesHealth {
  auth?: ServiceHealth;
  firestore?: ServiceHealth;
  storage?: ServiceHealth;
  ui?: ServiceHealth;
}

/**
 * Parse emulator service health status from script output lines
 * @param lines - Lines of script output
 * @returns Emulator services health information
 */
export function parseServiceHealth(lines: string[]): EmulatorServicesHealth {
  const services: EmulatorServicesHealth = {};

  for (const line of lines) {
    // Auth service
    const authMatch = line.match(/✓\s*Auth:\s*localhost:(\d+)/);
    if (authMatch) {
      const port = parsePort(authMatch);
      if (port !== undefined) {
        services.auth = { port, healthy: true };
      }
    }
    const authFailMatch = line.match(/✗\s*Auth:\s*localhost:(\d+)/);
    if (authFailMatch) {
      const port = parsePort(authFailMatch);
      if (port !== undefined) {
        services.auth = { port, healthy: false };
      }
    }

    // Firestore service
    const firestoreMatch = line.match(/✓\s*Firestore:\s*localhost:(\d+)/);
    if (firestoreMatch) {
      const port = parsePort(firestoreMatch);
      if (port !== undefined) {
        services.firestore = { port, healthy: true };
      }
    }
    const firestoreFailMatch = line.match(/✗\s*Firestore:\s*localhost:(\d+)/);
    if (firestoreFailMatch) {
      const port = parsePort(firestoreFailMatch);
      if (port !== undefined) {
        services.firestore = { port, healthy: false };
      }
    }

    // Storage service
    const storageMatch = line.match(/✓\s*Storage:\s*localhost:(\d+)/);
    if (storageMatch) {
      const port = parsePort(storageMatch);
      if (port !== undefined) {
        services.storage = { port, healthy: true };
      }
    }
    const storageFailMatch = line.match(/✗\s*Storage:\s*localhost:(\d+)/);
    if (storageFailMatch) {
      const port = parsePort(storageFailMatch);
      if (port !== undefined) {
        services.storage = { port, healthy: false };
      }
    }

    // UI service
    const uiMatch = line.match(/✓\s*UI:\s*http:\/\/localhost:(\d+)/);
    if (uiMatch) {
      const port = parsePort(uiMatch);
      if (port !== undefined) {
        services.ui = { port, healthy: true };
      }
    }
    const uiFailMatch = line.match(/✗\s*UI:\s*http:\/\/localhost:(\d+)/);
    if (uiFailMatch) {
      const port = parsePort(uiFailMatch);
      if (port !== undefined) {
        services.ui = { port, healthy: false };
      }
    }
  }

  return services;
}
