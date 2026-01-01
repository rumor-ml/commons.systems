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
  // Playwright's execution order: webServer starts → globalSetup runs → tests run → globalTeardown
  // Killing TEST_PORT processes here would terminate Playwright's webServer (already running).
  // Pre-test cleanup: Use cleanup-test-processes.sh before running tests
  // Post-test cleanup: Handled by globalTeardown

  console.log('Checking Firebase emulators...');

  // Check if emulators are already running by testing ports
  const isAuthRunning = await isPortInUse(FIREBASE_PORTS.auth);
  const isFirestoreRunning = await isPortInUse(FIREBASE_PORTS.firestore);
  const isStorageRunning = await isPortInUse(FIREBASE_PORTS.storage);

  if (isAuthRunning && isFirestoreRunning && isStorageRunning) {
    console.log('✓ All Firebase emulators already running');
    return;
  }

  console.log('Starting Firebase emulators...');

  // Use absolute path to script (no user input involved)
  const scriptPath = path.resolve(__dirname, '../../infrastructure/scripts/start-emulators.sh');

  try {
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
    const err = error as NodeJS.ErrnoException & { stderr?: Buffer };
    const errorMessage = err.message || String(error);
    const stderr = err.stderr?.toString() || '';

    console.error('FATAL: Failed to start Firebase emulators');
    console.error('');
    console.error('Error:', errorMessage);
    if (stderr) {
      console.error('Script output:', stderr);
    }
    console.error('');

    // Provide targeted troubleshooting based on error type
    if (err.code === 'ENOENT') {
      console.error('Troubleshooting:');
      console.error(`Script not found: ${scriptPath}`);
      console.error('1. Verify you are in the correct directory');
      console.error('2. Check that the script exists in infrastructure/scripts/');
      console.error('3. Ensure the repository is fully checked out');
    } else {
      console.error('Troubleshooting:');
      console.error('1. Verify jq is installed: command -v jq');
      console.error('2. Check firebase.json exists and is valid JSON');
      console.error(`3. Verify script is executable: ${scriptPath}`);
      console.error('4. Check ports in FIREBASE_PORTS:', JSON.stringify(FIREBASE_PORTS));
    }
    console.error('');
    throw error;
  }
}

/**
 * TODO(#1170): Add tests for error handling (EMFILE, EACCES, ENETUNREACH)
 * Check if a port is in use using Node.js net module
 * Cross-platform alternative to platform-specific commands like lsof/netstat
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
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
    socket.on('error', (error: Error) => {
      socket.destroy();

      // ECONNREFUSED means port is not in use (expected)
      if ((error as any).code === 'ECONNREFUSED') {
        resolve(false);
        return;
      }

      // Other errors indicate system problems - fail loudly
      try {
        const err = error as NodeJS.ErrnoException;
        const errorMsg =
          `Failed to check if port ${port} is in use: ${err.code || 'UNKNOWN'} - ${err.message}\n` +
          `This indicates a system-level problem, not just a port conflict.\n` +
          `Common causes:\n` +
          `- Too many open files (EMFILE): Increase file descriptor limit\n` +
          `- Permission denied (EACCES): Check firewall or security settings\n` +
          `- Network issues (ENETUNREACH): Check network configuration\n` +
          `Error details: ${JSON.stringify({ code: err.code, errno: err.errno, syscall: err.syscall })}`;

        reject(new Error(errorMsg));
      } catch (handlerError) {
        // If error message construction fails, still reject with basic error
        reject(
          new Error(
            `Failed to check port ${port}: ${error.message}. Additionally, error handler failed: ${handlerError}`
          )
        );
      }
    });

    socket.connect(port, 'localhost');
  });
}

export default globalSetup;
