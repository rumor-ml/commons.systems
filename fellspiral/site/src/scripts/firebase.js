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
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { firebaseConfig } from '../firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Get auth instance
const auth = getAuth(app);

// Collection reference
const cardsCollection = collection(db, 'cards');

/**
 * Card Database Operations
 */

// Get all cards from Firestore
export async function getAllCards() {
  try {
    const q = query(cardsCollection, orderBy('title', 'asc'));
    const querySnapshot = await getDocs(q);
    const cards = [];
    querySnapshot.forEach((doc) => {
      cards.push({
        id: doc.id,
        ...doc.data(),
      });
    });
    return cards;
  } catch (error) {
    console.error('Error getting cards:', error);
    throw error;
  }
}

// Get a single card by ID
export async function getCard(cardId) {
  try {
    const cardRef = doc(db, 'cards', cardId);
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
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to update cards');
    }

    const cardRef = doc(db, 'cards', cardId);
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
  try {
    const user = auth.currentUser;
    if (!user) {
      throw new Error('User must be authenticated to delete cards');
    }

    const cardRef = doc(db, 'cards', cardId);
    await deleteDoc(cardRef);
  } catch (error) {
    console.error('Error deleting card:', error);
    throw error;
  }
}

// Batch import cards (for seeding from rules.md)
export async function importCards(cards) {
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

export { db };
