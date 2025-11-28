#!/usr/bin/env node
/**
 * Quick verification script to check if cards are in Firestore
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Initialize Firebase Admin with ADC
initializeApp({ credential: applicationDefault(), projectId: 'chalanding' });

const db = getFirestore();

async function verifyCards() {
  try {
    const cardsSnapshot = await db.collection('cards').limit(5).get();
    console.log(`\nFound ${cardsSnapshot.size} cards (showing first 5):\n`);

    cardsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`- ${data.title} (${data.type} - ${data.subtype})`);
    });

    // Get total count
    const allCardsSnapshot = await db.collection('cards').count().get();
    console.log(`\nTotal cards in Firestore: ${allCardsSnapshot.data().count}\n`);
  } catch (error) {
    console.error('Error verifying cards:', error);
    process.exit(1);
  }
}

verifyCards()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
