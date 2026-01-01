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
  serverTimestamp,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { firebaseConfig } from '../firebase-config.js';
import { getCardsCollectionName } from '../lib/firestore-collections.js';
import { FIREBASE_PORTS } from '../../../../shared/config/firebase-ports.ts';

// Initialize Firebase with config
let app, db, auth, cardsCollection;
let initPromise = null;

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
      // TODO(#1156): Distinguish between expected (localhost) and unexpected (hosting) config fetch failures
      const isTimeout = error.message?.includes('timeout');
      console.warn('[Firebase] Failed to fetch Firebase Hosting config, using local config:', {
        message: error.message,
        isTimeout,
        hostname: window.location.hostname,
      });
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
async function initFirebase() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    // Get Firebase config (async for Firebase Hosting auto-config)
    const config = await getFirebaseConfig();

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

    // Connect to emulators in test/dev environment
    // Wrap in try-catch since these can only be called once per instance
    if (
      import.meta.env?.MODE === 'development' ||
      import.meta.env?.VITE_USE_FIREBASE_EMULATOR === 'true'
    ) {
      // Use localhost consistently (hosting emulator runs on same machine)
      // Firebase emulator ports from shared config
      const firestoreHost = 'localhost';
      const firestorePort = FIREBASE_PORTS.firestore;
      const authHost = 'localhost';
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
        // TODO(#1038): Make emulator error detection more specific by checking error codes instead of string matching.
        // Current approach is brittle - look for error.code === 'already-initialized' or similar Firebase error codes.
        const msg = error.message || '';

        // Expected: already connected (happens on HTMX page swaps)
        if (msg.includes('already')) {
          console.debug('[Firebase] Emulators already connected');
          return { app, db, auth, cardsCollection };
        }

        // Unexpected emulator connection errors after retry attempts
        // TODO(#1084): firebase.js throws error after logging it, but no user-facing error message in UI
        console.error('[Firebase] Emulator connection failed after retries:', {
          error: msg,
          firestoreHost: `${firestoreHost}:${firestorePort}`,
          authHost: `${authHost}:${authPort}`,
          env: import.meta.env?.MODE,
        });

        // Show user warning banner
        if (typeof window !== 'undefined') {
          const warning = document.createElement('div');
          warning.className = 'warning-banner';
          warning.style.cssText =
            'background: var(--color-error); color: white; padding: 1rem; position: fixed; top: 0; left: 0; right: 0; z-index: 10000;';
          warning.textContent =
            '⚠️ Failed to connect to emulator. You may be using production data.';
          document.body.insertBefore(warning, document.body.firstChild);
        }

        throw error; // Never silently fail on unexpected errors
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

// Get all cards from Firestore with timeout protection
export async function getAllCards() {
  await initFirebase();
  const FIRESTORE_TIMEOUT_MS = 5000;

  try {
    const q = query(cardsCollection, orderBy('title', 'asc'));

    // Wrap query with timeout to prevent hanging on slow/unresponsive Firestore
    const querySnapshot = await withTimeout(
      getDocs(q),
      FIRESTORE_TIMEOUT_MS,
      'Firestore query timeout'
    );

    const cards = [];
    querySnapshot.forEach((doc) => {
      cards.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    return cards;
  } catch (error) {
    // TODO(#1034): Verify error enrichment doesn't break caller's error.code checks
    // TODO(#1062): Error wrapping may break instanceof checks and other error properties
    // Enrich error with context before re-throwing
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
    console.error('[Firebase] Error getting card:', {
      cardId,
      message: error.message,
      code: error.code,
    });
    throw error;
  }
}

// Create a new card
export async function createCard(cardData) {
  await initFirebase();

  // Validate required fields before making Firestore call
  if (!cardData.title?.trim()) {
    throw new Error('Card title is required');
  }
  if (!cardData.type?.trim()) {
    throw new Error('Card type is required');
  }
  if (!cardData.subtype?.trim()) {
    throw new Error('Card subtype is required');
  }

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
  if (!cardData.title?.trim()) {
    throw new Error('Card title is required');
  }
  if (!cardData.type?.trim()) {
    throw new Error('Card type is required');
  }
  if (!cardData.subtype?.trim()) {
    throw new Error('Card subtype is required');
  }

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
  const authInstance = getAuthInstance();
  try {
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

// TODO(#1030): Clarify comment about module binding issue - explain WHY auth is undefined at import time
// Synchronous getter for auth instance (returns current value without initialization)
// This fixes module binding issue where auth is undefined at import time
// IMPORTANT: Checks window.__testAuth first to handle test mode where
// the signed-in user is on the test auth instance, not firebase.js's auth
export function getAuthInstance() {
  // In test mode, always prefer window.__testAuth if it exists
  if (typeof window !== 'undefined' && window.__testAuth) {
    return window.__testAuth;
  }
  // TODO(#1060): Throw error instead of returning undefined when auth not initialized
  if (!auth) {
    console.warn('[Firebase] getAuthInstance called before Firebase initialized');
  }
  return auth;
}

// For backwards compatibility with synchronous exports
export { db, auth };
