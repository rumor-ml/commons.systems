import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FirestoreTestHelper } from '../fixtures/firestore-test-helper.js';
import admin from 'firebase-admin';

// TODO(#485): Add field edge case tests (type validation, null handling, size limits)
// Edge cases are deferred to focus this issue (#283) on core CRUD validation and user attribution.
// These advanced validation rules require additional security rule constraints beyond basic field presence checks.
describe('Firestore Security Rules - Cards Collection', () => {
  let helper: FirestoreTestHelper;
  // Removed shared testCardId - each describe block now manages its own test data (#485)
  const USER_1 = 'test-user-1';
  const USER_2 = 'test-user-2';

  before(async () => {
    helper = new FirestoreTestHelper();
    console.log('\n=== Starting Firestore Security Rules Tests ===\n');
  });

  after(async () => {
    await helper.cleanup();
    console.log('\n=== Firestore Security Rules Tests Complete ===\n');
  });

  describe('CREATE operations', () => {
    it('should allow authenticated user to create card with valid data', async () => {
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Test Card',
        type: 'task',
        description: 'Test description',
      });

      assert.ok(cardRef.id, 'Card ID should be set');
      console.log(`✓ Created card ${cardRef.id} as ${USER_1}`);
    });

    it('should deny create if title field is missing', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          type: 'task',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create without title should be denied');
    });

    it('should deny create if type field is missing', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: 'Test Card',
          subtype: 'default',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create without type should be denied');
    });

    it('should deny create if subtype field is missing', async () => {
      // Subtype requirement added in #244 to ensure cards are properly categorized
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: 'Test Card',
          type: 'task',
          // Missing subtype
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create without subtype should be denied');
    });

    it('should allow create if subtype field is provided', async () => {
      // Verify that cards with subtype are accepted
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Card with Subtype',
        type: 'task',
        subtype: 'urgent',
      });

      assert.ok(cardRef.id, 'Card with subtype should be created');
      console.log(`Created card ${cardRef.id} with subtype`);
    });

    it('should deny create if createdBy does not match auth.uid (fake creator)', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: 'Fake Card',
          type: 'task',
          subtype: 'default',
          createdBy: USER_2, // USER_1 trying to fake USER_2's creation
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create with fake createdBy should be denied');
    });

    it('should allow create in PR-specific collection (cards_pr_123)', async () => {
      const cardRef = await helper.createCardAsUser(
        USER_1,
        {
          title: 'PR Test Card',
          type: 'bug',
          description: 'Testing PR collection',
        },
        'cards_pr_123'
      );

      assert.ok(cardRef.id, 'Card ID should be set in PR collection');
      console.log(`✓ Created card ${cardRef.id} in cards_pr_123 as ${USER_1}`);
    });

    it('should allow create in preview collection (cards_preview_test-branch)', async () => {
      const cardRef = await helper.createCardAsUser(
        USER_1,
        {
          title: 'Preview Test Card',
          type: 'feature',
          description: 'Testing preview collection',
        },
        'cards_preview_test-branch'
      );

      assert.ok(cardRef.id, 'Card ID should be set in preview collection');
      console.log(`✓ Created card ${cardRef.id} in cards_preview_test-branch as ${USER_1}`);
    });

    it('should deny create with non-string title', { skip: true }, async () => {
      // SKIP: Security rules don't currently validate field types (tracking issue: #1044)
      // TODO(#1044): Update rules to validate title is string: request.resource.data.title is string
      // Security impact: Type coercion could cause unexpected behavior in client code
      // Current mitigation: Client-side validation prevents type errors before submission
      // Test with number title: 12345
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb
          .collection('cards')
          .doc()
          .set({
            title: 12345 as unknown, // Type coercion attack
            type: 'task',
            createdBy: USER_1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }, 'Create with non-string title should be denied');
    });

    it('should deny create with empty string title', { skip: true }, async () => {
      // SKIP: Security rules don't currently validate string length (tracking issue: #1044)
      // TODO(#1044): Update rules to validate title is non-empty: request.resource.data.title.size() > 0
      // Security impact: Empty strings could break UI/UX assumptions
      // Current mitigation: Client-side validation requires non-empty titles
      // Test with title: ''
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: '',
          type: 'task',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create with empty string title should be denied');
    });

    it('should deny create with null required fields', { skip: true }, async () => {
      // SKIP: Security rules don't currently validate against null (tracking issue: #1044)
      // TODO(#1044): Update rules to validate field is not null: request.resource.data.title != null
      // Security impact: Null values could cause unexpected behavior in queries
      // Current mitigation: Client-side validation prevents null submissions
      // Test with title: null
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb
          .collection('cards')
          .doc()
          .set({
            title: null as unknown,
            type: 'task',
            createdBy: USER_1,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
          });
      }, 'Create with null title should be denied');
    });

    it('should deny create with excessively long title', { skip: true }, async () => {
      // SKIP: Security rules don't currently validate field size limits (tracking issue: #1044)
      // TODO(#1044): Update rules to validate max size: request.resource.data.title.size() < 1000
      // Security impact: DoS risk from excessively large payloads
      // Current mitigation: Firestore has document size limits (1MB total)
      // Test with 1MB title for DoS protection
      const longTitle = 'A'.repeat(1024 * 1024); // 1MB string

      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: longTitle,
          type: 'task',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create with excessively long title should be denied');
    });

    it('should allow create with serverTimestamp() for createdAt', async () => {
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const docRef = userDb.collection('cards').doc();

      await docRef.set({
        title: 'Timestamp Test',
        type: 'task',
        subtype: 'default',
        createdBy: USER_1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(), // CORRECT usage
      });

      // Verify create succeeded and timestamp was set
      const doc = await docRef.get();
      assert.strictEqual(doc.data()?.title, 'Timestamp Test');
      assert.ok(doc.data()?.createdAt, 'createdAt should be set');
      assert.ok(
        doc.data()?.createdAt instanceof admin.firestore.Timestamp,
        'createdAt should be a Timestamp'
      );

      console.log('✓ Create with serverTimestamp() for createdAt succeeded as expected');
    });
  });

  describe('UPDATE operations', () => {
    let testCardId: string;

    before(async () => {
      // Create a test card for UPDATE tests
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Update Test Card',
        type: 'task',
        description: 'Card for testing updates',
      });
      testCardId = cardRef.id;
      console.log(`✓ Setup: Created test card ${testCardId} for UPDATE tests`);
    });

    it('should allow creator to update their own card', async () => {
      await helper.updateCardAsUser(USER_1, testCardId, {
        title: 'Updated Test Card',
        description: 'Updated by creator',
      });

      const userDb = await helper.getFirestoreAsUser(USER_1);
      const doc = await userDb.collection('cards').doc(testCardId).get();
      const data = doc.data();

      assert.strictEqual(data?.title, 'Updated Test Card', 'Title should be updated');
      console.log(`✓ Creator updated card ${testCardId}`);
    });

    it('should deny update if user is not the creator', async () => {
      await helper.assertPermissionDenied(async () => {
        await helper.updateCardAsUser(USER_2, testCardId, {
          title: 'Malicious Update',
          description: 'USER_2 trying to update USER_1 card',
        });
      }, 'Non-creator update should be denied');
    });

    it('should deny update if lastModifiedAt is missing', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Invalid Update',
          lastModifiedBy: USER_1,
          // Missing lastModifiedAt
        });
      }, 'Update without lastModifiedAt should be denied');
    });

    it('should deny update with custom lastModifiedAt timestamp (timestamp manipulation attack)', async () => {
      // This test prevents timestamp manipulation attacks where users set custom timestamps
      // to manipulate sort order or forge audit trails
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const customTimestamp = admin.firestore.Timestamp.fromDate(new Date('2099-01-01'));
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Timestamp Attack',
          lastModifiedBy: USER_1,
          lastModifiedAt: customTimestamp, // Custom timestamp instead of serverTimestamp()
        });
      }, 'Update with custom lastModifiedAt should be denied');
    });

    it('should deny update with past lastModifiedAt timestamp', async () => {
      // Users cannot backdate modifications to manipulate history
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const pastTimestamp = admin.firestore.Timestamp.fromDate(new Date('2020-01-01'));
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Past Timestamp Attack',
          lastModifiedBy: USER_1,
          lastModifiedAt: pastTimestamp,
        });
      }, 'Update with past lastModifiedAt should be denied');
    });

    it('should deny update if user tries to change createdBy field', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Updated Title',
          createdBy: USER_2, // Trying to transfer ownership
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'User should not be able to modify createdBy field');
    });

    it('should deny update if user tries to change createdAt timestamp', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const newTimestamp = admin.firestore.Timestamp.fromDate(new Date('2020-01-01'));
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Updated Title',
          createdAt: newTimestamp, // Trying to forge creation time
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'User should not be able to modify createdAt timestamp');
    });

    it('should deny update if lastModifiedBy is missing', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Invalid Update',
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          // Missing lastModifiedBy
        });
      }, 'Update without lastModifiedBy should be denied');
    });

    it('should deny update if lastModifiedBy does not match auth.uid', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Invalid Update',
          lastModifiedBy: USER_2, // Wrong user
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Update with wrong lastModifiedBy should be denied');
    });

    it('should deny update by non-creator (regression test for OR vulnerability)', async () => {
      // This test prevents regression back to the vulnerable OR condition where
      // any user could update any card by simply setting lastModifiedBy to their own UID.
      // The vulnerable rule was:
      // && (resource.data.createdBy == request.auth.uid
      //     || request.resource.data.lastModifiedBy == request.auth.uid)
      // The correct rule requires BOTH: user must be the creator AND must set lastModifiedBy correctly.

      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'USER_1 Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_2);
        await userDb.collection('cards').doc(cardRef.id).update({
          title: 'USER_2 trying to update USER_1 card',
          lastModifiedBy: USER_2,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Non-creator should never be able to update card, even with correct lastModifiedBy');
    });

    it('should deny partial update omitting lastModifiedBy', async () => {
      // Attacker tries to update without providing lastModifiedBy
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Partial Update Attack',
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
          // Missing lastModifiedBy - should be denied by 'lastModifiedBy' in request.writeFields check
        });
      }, 'Partial update omitting lastModifiedBy should be denied');
    });

    it('should deny adding createdBy field retroactively', async () => {
      // Create a card, then try to add createdBy field after creation
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const docRef = userDb.collection('cards').doc();

      // First, use admin to create a card without createdBy (simulating old data)
      const adminDb = await helper.getAdminFirestore();
      await adminDb.collection('cards').doc(docRef.id).set({
        title: 'Legacy Card',
        type: 'task',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Try to add createdBy retroactively
      await helper.assertPermissionDenied(async () => {
        await docRef.update({
          createdBy: USER_1, // Trying to add createdBy after creation
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Adding createdBy field retroactively should be denied (fails createdBy == resource.data.createdBy check)');
    });

    it('should deny removing immutable fields', async () => {
      // Try to remove createdBy via FieldValue.delete()
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Updated Title',
          createdBy: admin.firestore.FieldValue.delete(), // Trying to delete immutable field
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Removing immutable fields should be denied');
    });

    it('should deny update that removes required title field', async () => {
      // Users should not be able to delete required fields that ensure data integrity
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: admin.firestore.FieldValue.delete(), // Removing required field
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Update removing title field should be denied');
    });

    it('should deny update that removes required type field', async () => {
      // Users should not be able to delete required fields that ensure data integrity
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          type: admin.firestore.FieldValue.delete(), // Removing required field
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Update removing type field should be denied');
    });

    it('should deny update that removes required subtype field', async () => {
      // Subtype requirement added in #244 - users cannot remove it via FieldValue.delete()
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          subtype: admin.firestore.FieldValue.delete(), // Removing required subtype field
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Update removing subtype field should be denied');
    });

    it('should handle concurrent updates with last-write-wins semantics', async () => {
      // This test documents that Firestore uses last-write-wins without conflict detection
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Concurrent Test',
        type: 'task',
        subtype: 'default',
      });

      // Simulate two concurrent updates by the same user
      const update1 = helper.updateCardAsUser(USER_1, cardRef.id, {
        title: 'Update 1',
      });
      const update2 = helper.updateCardAsUser(USER_1, cardRef.id, {
        title: 'Update 2',
      });

      await Promise.all([update1, update2]);

      // Verify final state (one update wins)
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const doc = await userDb.collection('cards').doc(cardRef.id).get();
      const finalTitle = doc.data()?.title;

      // Assert that one update succeeded (last-write-wins)
      assert.ok(
        ['Update 1', 'Update 2'].includes(finalTitle),
        'One update should win (last-write-wins semantics)'
      );

      console.log(
        `✓ Concurrent update test: final title is "${finalTitle}" (last-write-wins confirmed)`
      );
    });

    it('should allow update with serverTimestamp() for lastModifiedAt', async () => {
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Timestamp Test',
        type: 'task',
        subtype: 'default',
      });

      // Explicitly test that serverTimestamp() is accepted
      const userDb = await helper.getFirestoreAsUser(USER_1);
      await userDb.collection('cards').doc(cardRef.id).update({
        title: 'Updated Title',
        lastModifiedBy: USER_1,
        lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(), // CORRECT usage
      });

      // Verify update succeeded and timestamp was set
      const doc = await userDb.collection('cards').doc(cardRef.id).get();
      assert.strictEqual(doc.data()?.title, 'Updated Title');
      assert.ok(doc.data()?.lastModifiedAt, 'lastModifiedAt should be set');
      assert.ok(
        doc.data()?.lastModifiedAt instanceof admin.firestore.Timestamp,
        'lastModifiedAt should be a Timestamp'
      );

      console.log('✓ Update with serverTimestamp() succeeded as expected');
    });
  });

  describe('DELETE operations', () => {
    let testCardId: string;

    before(async () => {
      // Create a test card for DELETE tests
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Delete Test Card',
        type: 'task',
        subtype: 'default',
        description: 'Card for testing deletes',
      });
      testCardId = cardRef.id;
      console.log(`✓ Setup: Created test card ${testCardId} for DELETE tests`);
    });

    it('should deny delete if user is not the creator', async () => {
      await helper.assertPermissionDenied(async () => {
        await helper.deleteCardAsUser(USER_2, testCardId);
      }, 'Non-creator delete should be denied');
    });

    it('should allow creator to delete their own card', async () => {
      await helper.deleteCardAsUser(USER_1, testCardId);

      const userDb = await helper.getFirestoreAsUser(USER_1);
      const doc = await userDb.collection('cards').doc(testCardId).get();

      assert.strictEqual(doc.exists, false, 'Card should be deleted');
      console.log(`✓ Creator deleted card ${testCardId}`);
    });
  });

  describe('READ operations', () => {
    it('should allow authenticated users to read cards', async () => {
      // USER_1 creates a card
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Readable Card',
        type: 'task',
      });

      // USER_2 reads it
      const user2Db = await helper.getFirestoreAsUser(USER_2);
      const doc = await user2Db.collection('cards').doc(cardRef.id).get();

      assert.ok(doc.exists, 'Authenticated user should be able to read cards');
      assert.strictEqual(doc.data()?.createdBy, USER_1);
    });

    it('should allow unauthenticated users to read cards', async () => {
      // Create a card as USER_1
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Public Card',
        type: 'task',
      });

      // Read as unauthenticated user
      const unauthDb = helper.getFirestoreAsUnauthenticated();
      const doc = await unauthDb.collection('cards').doc(cardRef.id).get();

      assert.ok(doc.exists, 'Unauthenticated user should be able to read cards');
    });

    it('should deny read from non-cards collections', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('forbidden_collection').doc('test').get();
      }, 'Read from non-cards collection should be denied');
    });

    it('should allow authenticated users to list cards', async () => {
      // Create multiple cards to verify list operations work
      await helper.createCardAsUser(USER_1, {
        title: 'List Test Card 1',
        type: 'task',
        subtype: 'default',
      });
      await helper.createCardAsUser(USER_2, {
        title: 'List Test Card 2',
        type: 'bug',
        subtype: 'default',
      });

      // List all cards as USER_1
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const snapshot = await userDb.collection('cards').get();

      assert.ok(snapshot.size >= 2, 'Should be able to list multiple cards');
      console.log(`Listed ${snapshot.size} cards`);
    });

    it('should allow querying cards with where clause', async () => {
      // Create a card with specific type for querying
      await helper.createCardAsUser(USER_1, {
        title: 'Query Test Card',
        type: 'feature',
        subtype: 'default',
      });

      const userDb = await helper.getFirestoreAsUser(USER_1);
      const snapshot = await userDb.collection('cards').where('type', '==', 'feature').get();

      assert.ok(snapshot.size >= 1, 'Should be able to query cards with where clause');
      console.log(`Queried ${snapshot.size} cards with type=feature`);
    });

    it('should allow reading non-existent documents (returns empty doc)', async () => {
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const doc = await userDb.collection('cards').doc('non-existent-id-12345').get();

      assert.strictEqual(doc.exists, false, 'Non-existent doc should return exists=false');
      assert.strictEqual(doc.data(), undefined, 'Non-existent doc should have no data');
      console.log('✓ Reading non-existent document is allowed and returns empty result');
    });

    it('should allow unauthenticated read of non-existent documents', async () => {
      const unauthDb = helper.getFirestoreAsUnauthenticated();
      const doc = await unauthDb.collection('cards').doc('non-existent-id-67890').get();

      assert.strictEqual(doc.exists, false, 'Should return empty doc, not throw error');
      console.log('✓ Unauthenticated read of non-existent document succeeded');
    });
  });

  describe('Unauthenticated user operations', () => {
    it('should deny create for unauthenticated users', { skip: true }, async () => {
      // SKIP: Firebase Admin SDK with @google-cloud/firestore doesn't properly simulate
      // unauthenticated access (request.auth == null) in the Firestore Emulator.
      // Evidence: @google-cloud/firestore always includes auth context when Authorization header is present,
      // and omitting the header causes connection failures rather than simulating request.auth == null.
      // Alternative: @firebase/rules-unit-testing library may support this, but requires migration.
      // Verification: The rules DO deny unauthenticated access (verified via manual testing in Firebase Console).
      // Tracking issue: #533
      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc().set({
          title: 'Unauth Card',
          type: 'task',
          subtype: 'default',
          createdBy: 'fake-uid',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Unauthenticated users should not be able to create cards');
    });

    it('should deny update for unauthenticated users', { skip: true }, async () => {
      // SKIP: Firebase Admin SDK with @google-cloud/firestore doesn't properly simulate
      // unauthenticated access (request.auth == null) in the Firestore Emulator.
      // Evidence: @google-cloud/firestore always includes auth context when Authorization header is present,
      // and omitting the header causes connection failures rather than simulating request.auth == null.
      // Alternative: @firebase/rules-unit-testing library may support this, but requires migration.
      // Verification: The rules DO deny unauthenticated access (verified via manual testing in Firebase Console).
      // Tracking issue: #533
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Test Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc(cardRef.id).update({
          title: 'Unauth Update',
        });
      }, 'Unauthenticated users should not be able to update cards');
    });

    it('should deny delete for unauthenticated users', { skip: true }, async () => {
      // SKIP: Firebase Admin SDK with @google-cloud/firestore doesn't properly simulate
      // unauthenticated access (request.auth == null) in the Firestore Emulator.
      // Evidence: @google-cloud/firestore always includes auth context when Authorization header is present,
      // and omitting the header causes connection failures rather than simulating request.auth == null.
      // Alternative: @firebase/rules-unit-testing library may support this, but requires migration.
      // Verification: The rules DO deny unauthenticated access (verified via manual testing in Firebase Console).
      // Tracking issue: #533
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Test Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc(cardRef.id).delete();
      }, 'Unauthenticated users should not be able to delete cards');
    });
  });

  describe('BATCH operations', () => {
    it('should allow batch create of multiple cards by same user', async () => {
      // Batch create 2 cards by USER_1
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const batch = userDb.batch();

      const card1Ref = userDb.collection('cards').doc();
      const card2Ref = userDb.collection('cards').doc();

      batch.set(card1Ref, {
        title: 'Batch Card 1',
        type: 'task',
        subtype: 'default',
        createdBy: USER_1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      batch.set(card2Ref, {
        title: 'Batch Card 2',
        type: 'bug',
        subtype: 'default',
        createdBy: USER_1,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await batch.commit();

      // Verify both cards were created
      const card1 = await userDb.collection('cards').doc(card1Ref.id).get();
      const card2 = await userDb.collection('cards').doc(card2Ref.id).get();

      assert.ok(card1.exists, 'Card 1 should exist');
      assert.ok(card2.exists, 'Card 2 should exist');
      console.log(`Batch created cards ${card1Ref.id} and ${card2Ref.id}`);
    });

    it('should deny batch if any operation violates rules', async () => {
      // Valid create + invalid update (non-creator) = entire batch fails
      const card1Ref = await helper.createCardAsUser(USER_1, {
        title: 'Batch Test Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const batch = userDb.batch();

        // Valid create
        const newCardRef = userDb.collection('cards').doc();
        batch.set(newCardRef, {
          title: 'Valid Batch Card',
          type: 'feature',
          subtype: 'default',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Invalid update (trying to change createdBy)
        batch.update(userDb.collection('cards').doc(card1Ref.id), {
          title: 'Updated Title',
          createdBy: USER_2, // Invalid: changing createdBy
          lastModifiedBy: USER_1,
          lastModifiedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();
      }, 'Batch with invalid operation should be denied');
    });

    it('should deny cross-user batch operations', async () => {
      // USER_1 tries to create card with createdBy: USER_2
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const batch = userDb.batch();

        const cardRef = userDb.collection('cards').doc();
        batch.set(cardRef, {
          title: 'Fake Card',
          type: 'task',
          subtype: 'default',
          createdBy: USER_2, // USER_1 trying to fake USER_2's creation
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();
      }, 'Cross-user batch operation should be denied');
    });

    it('should deny batch update missing required lastModifiedAt', async () => {
      // Batch updates must include lastModifiedAt per security rules
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Batch Update Test Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        const batch = userDb.batch();
        batch.update(userDb.collection('cards').doc(cardRef.id), {
          title: 'Updated via Batch',
          lastModifiedBy: USER_1,
          // Missing lastModifiedAt - should be denied
        });
        await batch.commit();
      }, 'Batch update without lastModifiedAt should be denied');
    });

    it('should deny batch delete by non-creator', async () => {
      // Creator-only delete rule must be enforced in batch operations
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Batch Delete Test Card',
        type: 'task',
        subtype: 'default',
      });

      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_2);
        const batch = userDb.batch();
        batch.delete(userDb.collection('cards').doc(cardRef.id));
        await batch.commit();
      }, 'Batch delete by non-creator should be denied');
    });

    it('should allow batch delete by creator', async () => {
      // Creator should be able to delete their own card via batch
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Batch Delete Test Card',
        type: 'task',
        subtype: 'default',
      });

      const userDb = await helper.getFirestoreAsUser(USER_1);
      const batch = userDb.batch();
      batch.delete(userDb.collection('cards').doc(cardRef.id));
      await batch.commit();

      const doc = await userDb.collection('cards').doc(cardRef.id).get();
      assert.strictEqual(doc.exists, false, 'Card should be deleted via batch');
      console.log(`Creator deleted card ${cardRef.id} via batch`);
    });

    it('should rollback all operations when batch fails (atomicity)', async () => {
      const userDb = await helper.getFirestoreAsUser(USER_1);
      const newCardRef = userDb.collection('cards').doc();
      const newCardId = newCardRef.id;

      // Attempt batch with valid + invalid operations
      await helper.assertPermissionDenied(async () => {
        const batch = userDb.batch();

        // Valid create
        batch.set(newCardRef, {
          title: 'Valid Batch Card',
          type: 'task',
          subtype: 'default',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        // Invalid create (missing required field)
        const invalidRef = userDb.collection('cards').doc();
        batch.set(invalidRef, {
          type: 'task',
          // Missing title - will cause batch to fail
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        await batch.commit();
      }, 'Batch should fail due to invalid operation');

      // CRITICAL: Verify the valid card was NOT created (atomicity)
      const doc = await userDb.collection('cards').doc(newCardId).get();
      assert.strictEqual(
        doc.exists,
        false,
        'Valid operation should be rolled back when batch fails (atomicity guarantee)'
      );
      console.log('✓ Atomicity verified: all operations rolled back on failure');
    });
  });

  describe('Collection Name Pattern Validation', () => {
    it('should allow operations on valid collection names', async () => {
      // Test: cards, cards_pr_123, cards_preview_test-branch should all work
      const validCollections = ['cards', 'cards_pr_456', 'cards_preview_my-test-branch'];

      for (const collection of validCollections) {
        const cardRef = await helper.createCardAsUser(
          USER_1,
          {
            title: `Test Card in ${collection}`,
            type: 'task',
            subtype: 'default',
          },
          collection
        );

        assert.ok(cardRef.id, `Card should be created in ${collection}`);
        console.log(`Created card ${cardRef.id} in ${collection}`);
      }
    });

    it('should deny operations on invalid PR collection names', async () => {
      // Test: cards_pr_abc (non-numeric) should deny
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards_pr_abc').doc().set({
          title: 'Invalid PR Collection',
          type: 'task',
          subtype: 'default',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create in cards_pr_abc (non-numeric suffix) should be denied');
    });

    it('should deny operations on invalid preview collection names', async () => {
      // Test: cards_preview_MyBranch (uppercase) should deny
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards_preview_MyBranch').doc().set({
          title: 'Invalid Preview Collection',
          type: 'task',
          subtype: 'default',
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create in cards_preview_MyBranch (uppercase) should be denied');
    });

    it('should deny operations on invalid collection patterns', async () => {
      // Test: cards_test, cardz should deny
      const invalidCollections = ['cards_test', 'cardz', 'cards_preview_', 'cards_pr_'];

      for (const collection of invalidCollections) {
        await helper.assertPermissionDenied(async () => {
          const userDb = await helper.getFirestoreAsUser(USER_1);
          await userDb
            .collection(collection)
            .doc()
            .set({
              title: `Test Card in ${collection}`,
              type: 'task',
              subtype: 'default',
              createdBy: USER_1,
              createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }, `Create in ${collection} should be denied`);
      }
    });
  });

  describe('Users collection security rules', () => {
    it('should allow authenticated users to read any user profile', async () => {
      // USER_1 creates their profile
      const user1Db = await helper.getFirestoreAsUser(USER_1);
      await user1Db.collection('users').doc(USER_1).set({
        displayName: 'User 1',
        email: 'user1@test.com',
      });

      // USER_2 reads USER_1's profile
      const user2Db = await helper.getFirestoreAsUser(USER_2);
      const doc = await user2Db.collection('users').doc(USER_1).get();

      assert.ok(doc.exists, 'Authenticated user should read other user profiles');
      assert.strictEqual(doc.data()?.displayName, 'User 1');
    });

    it('should deny unauthenticated read of user profiles', { skip: true }, async () => {
      // SKIP: Firebase Admin SDK with @google-cloud/firestore doesn't properly simulate
      // unauthenticated access (request.auth == null) in the Firestore Emulator.
      // Evidence: @google-cloud/firestore always includes auth context when Authorization header is present,
      // and omitting the header causes connection failures rather than simulating request.auth == null.
      // Alternative: @firebase/rules-unit-testing library may support this, but requires migration.
      // Verification: The rules DO deny unauthenticated access (verified via manual testing in Firebase Console).
      // Tracking issue: #533
      // Create a profile as USER_1
      const user1Db = await helper.getFirestoreAsUser(USER_1);
      await user1Db.collection('users').doc(USER_1).set({
        displayName: 'User 1',
      });

      // Try to read as unauthenticated
      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('users').doc(USER_1).get();
      }, 'Unauthenticated read of user profile should be denied');
    });

    it('should allow users to write their own profile', async () => {
      const userDb = await helper.getFirestoreAsUser(USER_1);
      await userDb
        .collection('users')
        .doc(USER_1)
        .set({
          displayName: 'My Name',
          preferences: { theme: 'dark' },
        });

      const doc = await userDb.collection('users').doc(USER_1).get();
      assert.ok(doc.exists, 'User should create their own profile');
    });

    it('should deny users from writing other users profiles', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('users').doc(USER_2).set({
          displayName: 'Fake Name',
        });
      }, 'User should not write to another user profile');
    });
  });
});
