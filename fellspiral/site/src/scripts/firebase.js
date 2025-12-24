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
      import.meta.env.MODE === 'development' ||
      import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
    ) {
      try {
        // Use 127.0.0.1 to avoid IPv6 ::1 resolution (emulator only binds to IPv4)
        const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || '127.0.0.1:11980';
        const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:10980';

        const [firestoreHostname, firestorePort] = firestoreHost.split(':');
        connectFirestoreEmulator(db, firestoreHostname, parseInt(firestorePort));

        connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
      } catch (error) {
        // TODO: See issue #327 - Make emulator error detection more specific (check error codes vs string matching)
        const msg = error.message || '';

        // Expected: already connected (happens on HTMX page swaps)
        if (msg.includes('already')) {
          console.debug('[Firebase] Emulators already connected');
          return { app, db, auth, cardsCollection };
        }

        // Unexpected: CRITICAL ERROR - emulator connection failed
        console.error('[Firebase] CRITICAL: Emulator connection failed', {
          message: msg,
          firestoreHost: import.meta.env.VITE_FIRESTORE_EMULATOR_HOST,
          authHost: import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST,
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

// Synchronous getter for auth instance (returns current value without initialization)
// This fixes module binding issue where auth is undefined at import time
// IMPORTANT: Checks window.__testAuth first to handle test mode where
// the signed-in user is on the test auth instance, not firebase.js's auth
export function getAuthInstance() {
  // In test mode, always prefer window.__testAuth if it exists
  if (typeof window !== 'undefined' && window.__testAuth) {
    return window.__testAuth;
  }
  if (!auth) {
    console.warn('[Firebase] getAuthInstance called before Firebase initialized');
  }
  return auth;
}

// For backwards compatibility with synchronous exports
export { db, auth };
