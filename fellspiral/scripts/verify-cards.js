#!/usr/bin/env node
/**
 * Quick verification script to check if cards are in Firestore
 */

import { getFirestore } from 'firebase-admin/firestore';
import { initializeFirebase } from './lib/firebase-init.js';

// Initialize Firebase Admin
initializeFirebase();

const db = getFirestore();

async function verifyCards() {
  // Get total count first
  let countSnapshot;
  try {
    countSnapshot = await db.collection('cards').count().get();
  } catch (error) {
    console.error('\n❌ Failed to query card count:', error.message);
    if (error.code === 'permission-denied') {
      console.error('Check Firestore security rules and service account permissions.');
    } else if (error.code === 'unavailable') {
      console.error('Check internet connection and Firebase project settings.');
    }
    process.exit(1);
  }

  const totalCount = countSnapshot.data().count;

  if (totalCount === 0) {
    console.log('\n⚠️  No cards found in Firestore.');
    console.log('Run "node scripts/seed-firestore.js" to populate the database.\n');
    return;
  }

  console.log(`\nTotal cards in Firestore: ${totalCount}`);

  // Get sample cards
  let cardsSnapshot;
  try {
    cardsSnapshot = await db.collection('cards').limit(5).get();
  } catch (error) {
    console.error('\n❌ Failed to query cards:', error.message);
    if (error.code === 'permission-denied') {
      console.error('Check Firestore security rules and service account permissions.');
    } else if (error.code === 'unavailable') {
      console.error('Check internet connection and Firebase project settings.');
    }
    process.exit(1);
  }

  console.log(`\nShowing first ${cardsSnapshot.size} cards:\n`);

  let errorCount = 0;
  cardsSnapshot.forEach(doc => {
    try {
      const data = doc.data();

      // Validate document has required fields
      if (!data) {
        console.log(`- [Error: Document ${doc.id} has no data]`);
        errorCount++;
        return;
      }

      if (!data.title) {
        console.log(`- [Error: Document ${doc.id} missing title field]`);
        errorCount++;
        return;
      }

      const title = data.title;
      const type = data.type || 'Unknown';
      const subtype = data.subtype || 'Unknown';

      console.log(`- ${title} (${type} - ${subtype})`);
    } catch (error) {
      console.log(`- [Error processing document ${doc.id}: ${error.message}]`);
      errorCount++;
    }
  });

  if (errorCount > 0) {
    console.log(`\n⚠️  ${errorCount} document(s) had errors`);
  }

  console.log('');
}

verifyCards()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Unexpected error:', error.message);
    console.error('Full error:', error);
    process.exit(1);
  });
