import { execSync } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as net from 'net';
import { FIREBASE_PORTS } from '../../shared/config/firebase-ports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Global setup for Playwright tests
 * Ensures Firebase emulators are running before tests start
 */
async function globalSetup() {
  // NOTE: Do NOT clean up processes on TEST_PORT here!
  // Playwright's webServer starts BEFORE globalSetup runs,
  // so killing processes on TEST_PORT would kill Playwright's own webServer.
  // Pre-test cleanup should be done manually via cleanup-test-processes.sh
  // or will be handled by globalTeardown after tests complete.

  console.log('Checking Firebase emulators...');

  // TODO(#1130): Add runtime tests verifying global-setup uses correct ports from FIREBASE_PORTS
  // Check if emulators are already running by testing ports
  const isAuthRunning = await isPortInUse(FIREBASE_PORTS.auth);
  const isFirestoreRunning = await isPortInUse(FIREBASE_PORTS.firestore);
  const isStorageRunning = await isPortInUse(FIREBASE_PORTS.storage);

  if (isAuthRunning && isFirestoreRunning && isStorageRunning) {
    console.log('✓ All Firebase emulators already running');
    return;
  }

  console.log('Starting Firebase emulators...');

  try {
    // Use absolute path to script (no user input involved)
    const scriptPath = path.resolve(__dirname, '../../infrastructure/scripts/start-emulators.sh');

    // Execute script with no shell interpolation of variables
    // printsync is a go-fullstack app - skip Firebase Hosting emulator
    execSync(scriptPath, {
      stdio: 'inherit',
      env: {
        ...process.env,
        SKIP_HOSTING: '1',
      },
    });

    console.log('✓ Firebase emulators started successfully');
  } catch (error) {
    // TODO(#1134): Add structured error logging with context and actionable guidance
    console.error('Failed to start Firebase emulators:', error);
    throw error;
  }
}

/**
 * Check if a port is in use
 * Uses Node.js net module for cross-platform compatibility (works on macOS and Linux)
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = 1000;

    socket.setTimeout(timeout);
    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(port, 'localhost');
  });
}

export default globalSetup;
