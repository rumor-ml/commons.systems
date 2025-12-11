#!/usr/bin/env node

/**
 * Cleanup Firestore preview collections
 *
 * Deletes collections created for PR previews and feature branch previews
 */

const admin = require('firebase-admin');

async function main() {
  const projectId = process.env.GCP_PROJECT_ID || 'chalanding';
  const targetPR = process.env.PR_NUMBER;
  const targetBranch = process.env.BRANCH_NAME;
  const cleanupAll = process.env.CLEANUP_ALL === 'true';

  console.log('🧹 Firestore Cleanup Script');
  console.log(`Project: ${projectId}`);

  // Initialize Firebase Admin
  admin.initializeApp({ projectId });
  const db = admin.firestore();

  // Determine what to clean up
  let collectionsToDelete = [];

  if (cleanupAll) {
    console.log('Mode: Cleanup ALL preview collections');

    // List all collections and filter for preview collections
    const collections = await db.listCollections();
    collectionsToDelete = collections
      .map((col) => col.id)
      .filter((name) => name.startsWith('cards_pr_') || name.startsWith('cards_preview_'));

    console.log(`Found ${collectionsToDelete.length} preview collections to delete`);
  } else if (targetPR) {
    const collectionName = `cards_pr_${targetPR}`;
    console.log(`Mode: Cleanup PR #${targetPR}`);
    console.log(`Target collection: ${collectionName}`);
    collectionsToDelete = [collectionName];
  } else if (targetBranch && targetBranch !== 'main') {
    // Sanitize branch name to match the naming convention
    const sanitized = targetBranch
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50);

    const collectionName = `cards_preview_${sanitized}`;
    console.log(`Mode: Cleanup branch "${targetBranch}"`);
    console.log(`Target collection: ${collectionName}`);
    collectionsToDelete = [collectionName];
  } else {
    console.log('⚠️  No cleanup target specified. Set PR_NUMBER, BRANCH_NAME, or CLEANUP_ALL=true');
    process.exit(0);
  }

  // Delete each collection
  for (const collectionName of collectionsToDelete) {
    await deleteCollection(db, collectionName);
  }

  console.log('✅ Firestore cleanup complete');
}

async function deleteCollection(db, collectionPath, batchSize = 500) {
  const collectionRef = db.collection(collectionPath);

  // Check if collection exists by trying to get document count
  try {
    const countSnapshot = await collectionRef.count().get();
    const count = countSnapshot.data().count;

    if (count === 0) {
      console.log(`  ℹ️  Collection "${collectionPath}" is empty or doesn't exist`);
      return;
    }

    console.log(`  🗑️  Deleting collection "${collectionPath}" (${count} documents)...`);

    // Delete in batches
    let deletedCount = 0;
    while (true) {
      const snapshot = await collectionRef.limit(batchSize).get();

      if (snapshot.empty) {
        break;
      }

      const batch = db.batch();
      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      deletedCount += snapshot.docs.length;

      console.log(`    Deleted ${deletedCount} / ${count} documents...`);
    }

    console.log(`  ✅ Deleted collection "${collectionPath}" (${deletedCount} documents)`);
  } catch (error) {
    if (error.code === 5) {
      // NOT_FOUND
      console.log(`  ℹ️  Collection "${collectionPath}" not found (already deleted)`);
    } else {
      console.error(`  ❌ Error deleting collection "${collectionPath}":`, error.message);
    }
  }
}

main().catch((error) => {
  console.error('❌ Cleanup failed:', error);
  process.exit(1);
});
