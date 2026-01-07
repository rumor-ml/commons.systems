/**
 * Firebase and Firestore initialization
 *
 * Documentation and error handling improvements:
 * - JSDoc for key functions explaining error handling
 * - Improved comments for IPv4 address requirement (emulator binding)
 * - Improved comments for module binding patterns
 * - Better error logging with structured context objects
 * - Enhanced error messages for Firebase operations
 *
 * Related: #305 for general documentation and error handling improvements
 */

import { initializeApp, getApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
  serverTimestamp,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from '../firebase-config.js';
import { getCardsCollectionName } from '../lib/firestore-collections.js';
import { FIREBASE_PORTS } from '../../../../shared/config/firebase-ports.ts';
import cardsData from '../data/cards.json' assert { type: 'json' };

// Initialize Firebase with config
let app, db, auth, cardsCollection;
let initPromise = null;

/**
 * Check if error indicates emulator is already connected
 * Used during HTMX page swaps where emulator connection persists
 * @param {Error} error - The error to check
 * @returns {boolean} True if error indicates already connected
 */
function isEmulatorAlreadyConnected(error) {
  const code = error?.code || '';
  const msg = error?.message || '';
  return code === 'failed-precondition' || msg.toLowerCase().includes('already');
}

/**
 * Get Firebase configuration
 * - In production (Firebase Hosting): fetch from /__/firebase/init.json
 * - In development: use imported config
 */
async function getFirebaseConfig() {
  // Check if we're on Firebase Hosting (deployed)
  const isFirebaseHosting =
    typeof window !== 'undefined' &&
    (window.location.hostname.endsWith('.web.app') ||
      window.location.hostname.endsWith('.firebaseapp.com'));

  if (isFirebaseHosting) {
    try {
      // Add timeout to config fetch to prevent hanging
      const response = await withTimeout(
        fetch('/__/firebase/init.json'),
        3000,
        'Firebase config fetch timeout'
      );
      if (response.ok) {
        const config = await response.json();
        return config;
      }
    } catch (error) {
      const isTimeout = error.message?.includes('timeout');
      console.error('[Firebase] CRITICAL: Failed to fetch Firebase Hosting config:', {
        message: error.message,
        isTimeout,
        hostname: window.location.hostname,
      });

      // Show blocking error banner - wrong environment could cause data corruption
      if (typeof window !== 'undefined') {
        const errorBanner = document.createElement('div');
        errorBanner.className = 'error-banner';
        errorBanner.style.cssText =
          'background: var(--color-error); color: white; padding: 1.5rem; position: fixed; top: 0; left: 0; right: 0; z-index: 10000; text-align: center; font-weight: bold;';
        errorBanner.textContent =
          'CONFIGURATION ERROR: Failed to load Firebase config. You may be connected to the wrong environment. Please refresh or contact support.';
        document.body.insertBefore(errorBanner, document.body.firstChild);
      }

      // Re-throw error to halt initialization - do not continue with potentially wrong config
      throw error;
    }
  }

  return firebaseConfig;
}

/**
 * Retry an async operation with exponential backoff
 * @param {Function} operation - Async function to retry
 * @param {number} maxAttempts - Maximum number of attempts
 * @param {number} initialDelay - Initial delay in milliseconds
 * @returns {Promise} Result of the operation
 */
async function retryWithBackoff(operation, maxAttempts = 3, initialDelay = 100) {
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (attempt === maxAttempts) {
        break;
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      console.debug(`[Firebase] Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

/**
 * Initialize Firebase app and services
 * This is called lazily on first use to allow async config loading
 */
export async function initFirebase() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    // Get Firebase config (async for Firebase Hosting auto-config)
    let config = await getFirebaseConfig();

    // In test/emulator mode, override projectId to match the test environment
    // This ensures tests query the same Firestore namespace where test data is seeded
    // Check both import.meta.env (Vite build) and process.env (if available)
    const testProjectId =
      import.meta.env?.VITE_GCP_PROJECT_ID ||
      (typeof process !== 'undefined' && process.env?.GCP_PROJECT_ID);
    if (testProjectId) {
      config = { ...config, projectId: testProjectId };
    }

    // Initialize Firebase - use existing app if already initialized
    // This prevents "duplicate-app" errors when HTMX swaps pages
    try {
      app = getApp();
    } catch (error) {
      // App doesn't exist yet, initialize it
      app = initializeApp(config);
    }

    // Initialize Firestore
    db = getFirestore(app);

    // Get auth instance
    auth = getAuth(app);

    // Expose auth on window for test fixtures
    if (typeof window !== 'undefined') {
      window.auth = auth;

      // Emit ready event for tests to wait on
      const event = new CustomEvent('firebase:ready', {
        detail: { auth, db, app },
      });
      window.dispatchEvent(event);
    }

    // Connect to emulators in test/dev environment
    // Check both import.meta.env (Vite build) and process.env (Node.js test context)
    const isDevMode = import.meta.env?.MODE === 'development';
    const useEmulator =
      import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true' ||
      (typeof process !== 'undefined' && process.env?.VITE_USE_FIREBASE_EMULATOR === 'true');

    if (isDevMode || useEmulator) {
      // Use 127.0.0.1 explicitly to avoid IPv6 connection issues (::1)
      // Firefox and some browsers may have permission issues connecting to IPv6 localhost
      // Firebase emulator ports from shared config
      const firestoreHost = '127.0.0.1';
      const firestorePort = FIREBASE_PORTS.firestore;
      const authHost = '127.0.0.1';
      const authPort = FIREBASE_PORTS.auth;

      try {
        await retryWithBackoff(
          async () => {
            connectFirestoreEmulator(db, firestoreHost, firestorePort);
            connectAuthEmulator(auth, `http://${authHost}:${authPort}`, { disableWarnings: true });
          },
          3,
          100
        );
      } catch (error) {
        const msg = error.message || '';
        // Expected: already connected (happens on HTMX page swaps)
        // Firebase throws 'failed-precondition' with message containing 'already'
        // Check both code and message for robustness across SDK versions
        if (isEmulatorAlreadyConnected(error)) {
          console.debug('[Firebase] Emulators already connected');
          return { app, db, auth, cardsCollection };
        }

        // Unexpected emulator connection errors after retry attempts
        // TODO(#1084): firebase.js throws error after logging it, but no user-facing error message in UI
        console.error('[Firebase] CRITICAL: Emulator connection failed after retries:', {
          error: msg,
          firestoreHost: `${firestoreHost}:${firestorePort}`,
          authHost: `${authHost}:${authPort}`,
          env: import.meta.env?.MODE,
        });

        // CRITICAL: Show blocking error screen and halt execution
        // Prevents accidental writes to production database
        if (typeof window !== 'undefined') {
          const errorScreen = document.createElement('div');
          errorScreen.style.cssText =
            'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: var(--color-error); color: white; display: flex; align-items: center; justify-content: center; z-index: 10000; flex-direction: column; padding: 2rem; text-align: center;';

          const title = document.createElement('h1');
          title.textContent = '🛑 EMULATOR CONNECTION FAILED';
          title.style.cssText = 'font-size: 2rem; margin-bottom: 1rem;';

          const message = document.createElement('p');
          message.textContent =
            'Cannot connect to Firebase emulator. Execution halted to prevent accidental production writes.';
          message.style.cssText = 'font-size: 1.2rem; margin-bottom: 2rem; max-width: 600px;';

          const instructions = document.createElement('p');
          instructions.textContent =
            'Please ensure emulators are running (make dev) and refresh the page.';
          instructions.style.cssText = 'font-size: 1rem;';

          errorScreen.appendChild(title);
          errorScreen.appendChild(message);
          errorScreen.appendChild(instructions);
          document.body.appendChild(errorScreen);
        }

        // Throw error to halt execution - do not allow any Firebase operations
        throw error;
      }
    }

    // Collection reference
    cardsCollection = collection(db, getCardsCollectionName());

    return { app, db, auth, cardsCollection };
  })();

  return initPromise;
}

/**
 * Card Database Operations
 */

/**
 * Helper to wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} errorMessage - Error message on timeout
 * @returns {Promise} Race between promise and timeout
 */
export function withTimeout(promise, ms, errorMessage = 'Operation timed out') {
  const timeoutPromise = new Promise((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), ms)
  );
  return Promise.race([promise, timeoutPromise]);
}

/**
 * Validate card data for required fields and types
 * Extracted from createCard and updateCard to eliminate duplication
 * @param {Object} cardData - Card data to validate
 * @throws {Error} If validation fails (null/undefined input, non-object, or missing required fields)
 */
function validateCardData(cardData) {
  // Runtime type check for cardData parameter
  if (cardData === null || cardData === undefined) {
    throw new Error('Card data is required');
  }
  if (typeof cardData !== 'object' || Array.isArray(cardData)) {
    throw new Error('Card data must be a plain object');
  }

  if (!cardData.title?.trim()) {
    throw new Error('Card title is required');
  }
  if (cardData.title.length > 100) {
    throw new Error('Card title must be 100 characters or less');
  }
  if (!cardData.type?.trim()) {
    throw new Error('Card type is required');
  }
  if (!cardData.subtype?.trim()) {
    throw new Error('Card subtype is required');
  }
  if (cardData.description && cardData.description.length > 500) {
    throw new Error('Card description must be 500 characters or less');
  }
  if (cardData.isPublic !== undefined && typeof cardData.isPublic !== 'boolean') {
    throw new Error('isPublic must be a boolean value');
  }
}

// TODO(#284): Add categorizeFirestoreError() helper and comprehensive tests
// Should categorize timeout → demo data, permission-denied → login prompt, network errors
// Tests needed for error categorization to prevent showing login prompts for network issues

// Get all cards from Firestore with timeout protection
// Fetches public cards (everyone can see) and private cards (only if authenticated and owned by user)
export async function getAllCards() {
  await initFirebase();
  // Timeout of 30 seconds for emulator environment (may be slower due to system load)
  // Production: typical latency 1-2s cold-start, 100-500ms warm queries
  // Emulator: can be slower due to JVM startup, especially on overloaded systems or Firefox
  const FIRESTORE_TIMEOUT_MS = 30000;

  try {
    // Get current user for private card query
    const authInstance = getAuthInstance();
    const currentUser = authInstance?.currentUser;

    // Query 1: Public cards (everyone can see these)
    const publicQuery = query(
      cardsCollection,
      where('isPublic', '==', true),
      orderBy('title', 'asc')
    );

    const publicQuerySnapshot = await withTimeout(
      getDocs(publicQuery),
      FIRESTORE_TIMEOUT_MS,
      'Firestore query timeout (public cards)'
    );

    const publicCards = [];
    publicQuerySnapshot.forEach((doc) => {
      publicCards.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // If not authenticated, return only public cards (but check completeness first)
    if (!currentUser) {
      // Check if we have incomplete card types and should fall back to static data
      const types = new Set(publicCards.map((c) => c.type).filter(Boolean));
      const expectedTypes = new Set(['Equipment', 'Skill', 'Upgrade', 'Origin']);
      const missingTypes = [...expectedTypes].filter((type) => !types.has(type));

      if (missingTypes.length > 1) {
        console.warn(
          `[getAllCards] Firestore missing ${missingTypes.length} expected types (${missingTypes.join(', ')}). ` +
            `Falling back to static data.`
        );
        return cardsData || [];
      }

      return publicCards;
    }

    // Query 2: Private cards owned by the current user
    const privateQuery = query(
      cardsCollection,
      where('isPublic', '==', false),
      where('createdBy', '==', currentUser.uid),
      orderBy('title', 'asc')
    );

    const privateQuerySnapshot = await withTimeout(
      getDocs(privateQuery),
      FIRESTORE_TIMEOUT_MS,
      'Firestore query timeout (private cards)'
    );

    const privateCards = [];
    privateQuerySnapshot.forEach((doc) => {
      privateCards.push({
        id: doc.id,
        ...doc.data(),
      });
    });

    // Merge and deduplicate by card ID (in case a card is both public and owned by user)
    const cardMap = new Map();
    [...publicCards, ...privateCards].forEach((card) => {
      cardMap.set(card.id, card);
    });

    // Convert back to array and sort by title
    const allCards = Array.from(cardMap.values());
    allCards.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

    // Check if we have incomplete card types and should fall back to static data
    const types = new Set(allCards.map((c) => c.type).filter(Boolean));
    const expectedTypes = new Set(['Equipment', 'Skill', 'Upgrade', 'Origin']);
    const missingTypes = [...expectedTypes].filter((type) => !types.has(type));

    if (missingTypes.length > 1) {
      console.warn(
        `[getAllCards] Firestore missing ${missingTypes.length} expected types (${missingTypes.join(', ')}). ` +
          `Falling back to static data.`
      );
      return cardsData || [];
    }

    return allCards;
  } catch (error) {
    // Log detailed error information for debugging (especially Firefox-specific issues)
    const authInstance = getAuthInstance();
    const isAuthenticated = !!authInstance?.currentUser;
    console.error('[getAllCards] Firestore query failed:', {
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack,
      browser: navigator.userAgent,
      timestamp: new Date().toISOString(),
      isAuthenticated,
    });
    // Create enriched error with context for better debugging and error handling
    const enrichedError = new Error(`Failed to fetch cards: ${error.message}`);
    enrichedError.originalError = error;
    enrichedError.code = error.code;
    throw enrichedError;
  }
}

// Get a single card by ID
export async function getCard(cardId) {
  await initFirebase();
  try {
    const cardRef = doc(db, getCardsCollectionName(), cardId);
    const cardSnap = await getDoc(cardRef);
    if (cardSnap.exists()) {
      return {
        id: cardSnap.id,
        ...cardSnap.data(),
      };
    } else {
      throw new Error('Card not found');
    }
  } catch (error) {
    // TODO(#1097): Add error categorization and user-friendly messaging
    console.error('Error getting card:', error);
    throw error;
  }
}

// Create a new card
// TODO(#475): Use Card type from types.js for better type safety
export async function createCard(cardData) {
  await initFirebase();

  // Validate required fields before making Firestore call
  validateCardData(cardData);

  // Use getAuthInstance() to get the current auth instance
  // This ensures we get window.__testAuth if it exists (for tests)
  const authInstance = getAuthInstance();
  try {
    const user = authInstance.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to create cards');
    }

    const docRef = await addDoc(cardsCollection, {
      ...cardData,
      isPublic: cardData.isPublic ?? true, // Default to public for backward compatibility
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastModifiedBy: user.uid,
      lastModifiedAt: serverTimestamp(),
    });
    return docRef.id;
  } catch (error) {
    console.error('[Firebase] Error creating card:', {
      title: cardData.title,
      type: cardData.type,
      message: error.message,
      code: error.code,
    });
    throw error;
  }
}

// Update an existing card
export async function updateCard(cardId, cardData) {
  await initFirebase();

  // Validate required fields before making Firestore call
  validateCardData(cardData);

  const authInstance = getAuthInstance();
  try {
    const user = authInstance.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to update cards');
    }

    const cardRef = doc(db, getCardsCollectionName(), cardId);
    await updateDoc(cardRef, {
      ...cardData,
      updatedAt: serverTimestamp(),
      lastModifiedBy: user.uid,
      lastModifiedAt: serverTimestamp(),
    });
  } catch (error) {
    console.error('[Firebase] Error updating card:', {
      cardId,
      title: cardData.title,
      type: cardData.type,
      message: error.message,
      code: error.code,
    });
    throw error;
  }
}

// Delete a card
export async function deleteCard(cardId) {
  await initFirebase();
  try {
    const authInstance = getAuthInstance();
    const user = authInstance.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to delete cards');
    }

    const cardRef = doc(db, getCardsCollectionName(), cardId);
    await deleteDoc(cardRef);
  } catch (error) {
    console.error('[Firebase] Error deleting card:', {
      cardId,
      message: error.message,
      code: error.code,
    });
    throw error;
  }
}

// Batch import cards (for seeding from rules.md)
// TODO(#1057): Surface failed card imports to user (currently only logged to console)
export async function importCards(cards) {
  await initFirebase();
  try {
    const results = {
      created: 0,
      updated: 0,
      errors: 0,
      failedCards: [], // Track which cards failed
    };

    for (const card of cards) {
      try {
        // Check if card with this title already exists
        const existingCards = await getDocs(query(cardsCollection, orderBy('title', 'asc')));

        let existingCard = null;
        existingCards.forEach((doc) => {
          if (doc.data().title === card.title) {
            existingCard = { id: doc.id, ...doc.data() };
          }
        });

        if (existingCard) {
          // Update existing card
          await updateCard(existingCard.id, card);
          results.updated++;
        } else {
          // Create new card
          await createCard(card);
          results.created++;
        }
      } catch (error) {
        console.error(`[Firebase] Error importing card "${card.title}":`, error);
        results.errors++;
        results.failedCards.push({
          title: card.title,
          error: error.message,
        });
      }
    }

    return results;
  } catch (error) {
    console.error('[Firebase] Error importing cards:', error);
    throw error;
  }
}

// Export getters for Firebase instances (lazy initialized)
export async function getFirestoreDb() {
  await initFirebase();
  return db;
}

export async function getFirebaseAuth() {
  await initFirebase();
  return auth;
}

// Synchronous getter for auth instance (returns current value without initialization)
// This fixes module binding issue where auth is undefined at import time
// IMPORTANT: Checks window.__testAuth first to handle test mode where
// the signed-in user is on the test auth instance, not firebase.js's auth
export function getAuthInstance() {
  // In test mode, always prefer window.__testAuth if it exists
  if (typeof window !== 'undefined' && window.__testAuth) {
    return window.__testAuth;
  }
  return auth;
}

// For backwards compatibility with synchronous exports
export { db, auth };
