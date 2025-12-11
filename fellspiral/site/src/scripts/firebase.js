/**
 * Firebase and Firestore initialization
 */

import { initializeApp } from 'firebase/app';
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
      const response = await fetch('/__/firebase/init.json');
      if (response.ok) {
        const config = await response.json();
        console.log('Using Firebase Hosting auto-config');
        return config;
      }
    } catch (error) {
      console.warn('Failed to fetch Firebase Hosting config, using local config:', error);
    }
  }

  console.log('Using local Firebase config');
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

    // Initialize Firebase
    app = initializeApp(config);

    // Initialize Firestore
    db = getFirestore(app);

    // Get auth instance
    auth = getAuth(app);

    // Connect to emulators in test/dev environment
    if (
      import.meta.env.MODE === 'development' ||
      import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true'
    ) {
      const firestoreHost = import.meta.env.VITE_FIRESTORE_EMULATOR_HOST || 'localhost:8081';
      const authHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || 'localhost:9099';

      const [firestoreHostname, firestorePort] = firestoreHost.split(':');
      connectFirestoreEmulator(db, firestoreHostname, parseInt(firestorePort));

      connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
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
    // Error will be handled by caller - no need to log here
    // This reduces console noise during normal operation
    throw error;
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
    console.error('Error getting card:', error);
    throw error;
  }
}

// Create a new card
export async function createCard(cardData) {
  await initFirebase();
  try {
    const user = auth.currentUser;
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
    console.error('Error creating card:', error);
    throw error;
  }
}

// Update an existing card
export async function updateCard(cardId, cardData) {
  await initFirebase();
  try {
    const user = auth.currentUser;
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
    console.error('Error updating card:', error);
    throw error;
  }
}

// Delete a card
export async function deleteCard(cardId) {
  await initFirebase();
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to delete cards');
    }

    const cardRef = doc(db, getCardsCollectionName(), cardId);
    await deleteDoc(cardRef);
  } catch (error) {
    console.error('Error deleting card:', error);
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
        console.error(`Error importing card "${card.title}":`, error);
        results.errors++;
      }
    }

    return results;
  } catch (error) {
    console.error('Error importing cards:', error);
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

// For backwards compatibility with synchronous exports
export { db, auth };
