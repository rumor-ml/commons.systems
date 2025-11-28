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
  const countSnapshot = await db.collection('cards').count().get();
  const totalCount = countSnapshot.data().count;

  if (totalCount === 0) {
    console.log('\n⚠️  No cards found in Firestore.');
    console.log('Run "node scripts/seed-firestore.js" to populate the database.\n');
    return;
  }

  console.log(`\nTotal cards in Firestore: ${totalCount}`);

  // Get sample cards
  const cardsSnapshot = await db.collection('cards').limit(5).get();
  console.log(`\nShowing first ${cardsSnapshot.size} cards:\n`);

  cardsSnapshot.forEach(doc => {
    const data = doc.data();

    // Validate document has required fields
    if (!data) {
      console.log(`- [Error: Document ${doc.id} has no data]`);
      return;
    }

    if (!data.title) {
      console.log(`- [Error: Document ${doc.id} missing title field]`);
      return;
    }

    const title = data.title;
    const type = data.type || 'Unknown';
    const subtype = data.subtype || 'Unknown';

    console.log(`- ${title} (${type} - ${subtype})`);
  });

  console.log('');
}

verifyCards()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n❌ Error querying Firestore:', error.message);
    console.error('This likely means Firebase is not configured or the cards collection does not exist.');
    console.error('Full error:', error);
    process.exit(1);
  });
