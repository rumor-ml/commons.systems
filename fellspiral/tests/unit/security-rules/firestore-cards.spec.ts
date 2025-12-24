import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FirestoreTestHelper } from '../fixtures/firestore-test-helper.js';
import admin from 'firebase-admin';

// TODO(#485): Add batch operation tests, invalid collection name tests, and field edge case tests
describe('Firestore Security Rules - Cards Collection', () => {
  let helper: FirestoreTestHelper;
  let testCardId: string;
  // TODO(#485): Use before() hooks for test isolation instead of shared testCardId
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

      testCardId = cardRef.id;
      assert.ok(testCardId, 'Card ID should be set');
      console.log(`✓ Created card ${testCardId} as ${USER_1}`);
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
          createdBy: USER_1,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Create without type should be denied');
    });

    it('should deny create if createdBy does not match auth.uid (fake creator)', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc().set({
          title: 'Fake Card',
          type: 'task',
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
  });

  describe('UPDATE operations', () => {
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

    it('should deny update if lastModifiedAt is not set to request.time', async () => {
      await helper.assertPermissionDenied(async () => {
        const userDb = await helper.getFirestoreAsUser(USER_1);
        await userDb.collection('cards').doc(testCardId).update({
          title: 'Invalid Update',
          lastModifiedBy: USER_1,
          // Missing lastModifiedAt or setting it to a custom value
        });
      }, 'Update without proper lastModifiedAt should be denied');
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
      // This test prevents regression back to the vulnerable OR condition:
      // && (resource.data.createdBy == request.auth.uid
      //     || request.resource.data.lastModifiedBy == request.auth.uid)

      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'USER_1 Card',
        type: 'task',
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
  });

  describe('DELETE operations', () => {
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
  });

  describe('Unauthenticated user operations', () => {
    it('should deny create for unauthenticated users', async () => {
      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc().set({
          title: 'Unauth Card',
          type: 'task',
          createdBy: 'fake-uid',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }, 'Unauthenticated users should not be able to create cards');
    });

    it('should deny update for unauthenticated users', async () => {
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Test Card',
        type: 'task',
      });

      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc(cardRef.id).update({
          title: 'Unauth Update',
        });
      }, 'Unauthenticated users should not be able to update cards');
    });

    it('should deny delete for unauthenticated users', async () => {
      const cardRef = await helper.createCardAsUser(USER_1, {
        title: 'Test Card',
        type: 'task',
      });

      await helper.assertPermissionDenied(async () => {
        const unauthDb = helper.getFirestoreAsUnauthenticated();
        await unauthDb.collection('cards').doc(cardRef.id).delete();
      }, 'Unauthenticated users should not be able to delete cards');
    });
  });
});
