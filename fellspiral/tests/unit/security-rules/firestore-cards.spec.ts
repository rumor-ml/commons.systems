import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { FirestoreTestHelper } from '../fixtures/firestore-test-helper.js';
import admin from 'firebase-admin';

describe('Firestore Security Rules - Cards Collection', () => {
  let helper: FirestoreTestHelper;
  let testCardId: string;
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
});
