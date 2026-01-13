/**
 * Centralized Test Configuration
 * Single source of truth for test timeouts and constants
 *
 * WHY THESE TIMEOUTS:
 * - Prevents magic numbers scattered throughout tests
 * - Easy to adjust globally for CI vs local testing
 * - Self-documenting what each wait is for
 */

/**
 * Standard test timeouts (in milliseconds)
 * Use these constants instead of hardcoded values in tests
 *
 * @example
 * import { TEST_TIMEOUTS } from './test-config.js';
 * await page.waitForTimeout(TEST_TIMEOUTS.AUTH_PROPAGATION);
 */
export const TEST_TIMEOUTS = {
  /** Time to wait for auth state to propagate through the app (2s) */
  AUTH_PROPAGATION: 2000,

  /** Time to wait for Firestore query to complete (5s) */
  FIRESTORE_QUERY: 5000,

  /** Time to wait for library nav to render all types (15s) */
  LIBRARY_NAV_RENDER: 15000,

  /** Time to wait for cards to load and display (10s) */
  CARD_LOAD: 10000,

  /** Time to wait for modal animations to complete (1s) */
  MODAL_ANIMATION: 1000,

  /** Time to wait for HTMX navigation to complete (10s) */
  HTMX_NAVIGATION: 10000,

  /** Time to wait for page navigation to complete (10s) */
  PAGE_NAVIGATION: 10000,

  /** Time to wait for UI element to become visible (5s) */
  ELEMENT_VISIBLE: 5000,

  /** Short poll interval for checking state changes (200ms) */
  POLL_INTERVAL: 200,

  /** Time to wait for Firebase emulator to start (120s) */
  EMULATOR_STARTUP: 120000,
};

/**
 * Required card types that must exist in test data
 * Used by global-setup.ts to validate test data completeness
 * Note: Foe is in VALID_CARD_TYPES but not included here since test data doesn't have Foe cards
 */
export const REQUIRED_CARD_TYPES = ['Equipment', 'Skill', 'Upgrade', 'Origin'];

/**
 * Standard viewport sizes for responsive testing
 * Re-exported from test-helpers for convenience
 */
export const VIEWPORTS = {
  mobile: { width: 375, height: 667 },
  tablet: { width: 768, height: 1024 },
  desktop: { width: 1280, height: 720 },
  desktopLarge: { width: 1920, height: 1080 },
};

/**
 * Test environment configuration
 * Based on environment variables and test mode
 */
export const TEST_ENV = {
  /** Whether running in CI environment */
  isCI: process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true',

  /** Firebase emulator configuration */
  emulator: {
    firestoreHost: process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081',
    authHost: process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099',
    storageHost: process.env.STORAGE_EMULATOR_HOST || '127.0.0.1:9199',
    projectId: process.env.GCP_PROJECT_ID || 'demo-test',
  },

  /** Test mode (emulator vs deployed) */
  isEmulatorMode: !process.env.DEPLOYED_URL,
  deployedURL: process.env.DEPLOYED_URL,
};
