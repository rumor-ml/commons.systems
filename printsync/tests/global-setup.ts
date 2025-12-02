import { execSync } from 'child_process';
import * as path from 'path';

/**
 * Global setup for Playwright tests
 * Ensures Firebase emulators are running before tests start
 */
async function globalSetup() {
  console.log('Checking Firebase emulators...');

  // Check if emulators are already running by testing ports
  const isAuthRunning = await isPortInUse(9099);
  const isFirestoreRunning = await isPortInUse(8081);
  const isStorageRunning = await isPortInUse(9199);

  if (isAuthRunning && isFirestoreRunning && isStorageRunning) {
    console.log('✓ All Firebase emulators already running');
    return;
  }

  console.log('Starting Firebase emulators...');

  try {
    // Use absolute path to script (no user input involved)
    const scriptPath = path.resolve(__dirname, '../../infrastructure/scripts/start-emulators.sh');

    // Execute script with no shell interpolation of variables
    execSync(scriptPath, {
      stdio: 'inherit',
    });

    console.log('✓ Firebase emulators started successfully');
  } catch (error) {
    console.error('Failed to start Firebase emulators:', error);
    throw error;
  }
}

/**
 * Check if a port is in use
 * Uses lsof command with hardcoded port numbers (no user input)
 */
async function isPortInUse(port: number): Promise<boolean> {
  try {
    // Port is a number, not user input - safe to use
    execSync(`lsof -i :${port}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

export default globalSetup;
