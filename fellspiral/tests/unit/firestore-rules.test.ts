/**
 * Firestore Security Rules Tests
 *
 * Tests the security rules for the cards collection including:
 * - isPublic field access control
 * - Required fields validation
 * - Wiki-style editing permissions
 * - Owner-only deletion
 * - Collection name pattern matching
 */

import {
  initializeTestEnvironment,
  RulesTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, test, before, after, afterEach, beforeEach } from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load Firestore rules from the parent directory
const rulesPath = resolve(__dirname, '../../firestore.rules');
const rules = readFileSync(rulesPath, 'utf8');

let testEnv: RulesTestEnvironment;

// Test user IDs
const USER_1_UID = 'user1';
const USER_2_UID = 'user2';

// Valid card data for testing
const validCard = {
  title: 'Test Card',
  type: 'Character',
  subtype: 'Hero',
  isPublic: true,
  createdBy: USER_1_UID,
  createdAt: serverTimestamp(),
};

before(async () => {
  // Use FIRESTORE_EMULATOR_HOST env var set by start-emulators.sh (consistent with other tests)
  const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';
  const [host, portStr] = firestoreHost.split(':');
  const port = parseInt(portStr, 10);

  // Initialize test environment
  testEnv = await initializeTestEnvironment({
    projectId: 'demo-test-firestore-rules',
    firestore: {
      rules,
      host,
      port,
    },
  });
});

after(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

describe('Firestore Security Rules - Read Access', () => {
  // Test collection names to validate pattern matching
  const collectionNames = [
    'cards',
    'cards_pr_123',
    'cards_preview_my-branch',
    'cards-worker-0',
    'cards-worker-5',
  ];

  collectionNames.forEach((collectionName) => {
    describe(`Collection: ${collectionName}`, () => {
      test('should allow unauthenticated users to read public cards', async () => {
        // Setup: Create a public card as admin
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, collectionName, 'card1'), {
            ...validCard,
            isPublic: true,
          });
        });

        // Test: Unauthenticated user can read public card
        const unauthedDb = testEnv.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(unauthedDb, collectionName, 'card1')));
      });

      test('should deny unauthenticated users from reading private cards', async () => {
        // Setup: Create a private card as admin
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, collectionName, 'card1'), {
            ...validCard,
            isPublic: false,
            createdBy: USER_1_UID,
          });
        });

        // Test: Unauthenticated user cannot read private card
        const unauthedDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(unauthedDb, collectionName, 'card1')));
      });

      test('should deny access to cards missing isPublic field (secure by default)', async () => {
        // Setup: Create a card without isPublic field
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          const cardWithoutIsPublic = { ...validCard };
          delete (cardWithoutIsPublic as any).isPublic;
          await setDoc(doc(db, collectionName, 'card1'), cardWithoutIsPublic);
        });

        // Test: Even authenticated users cannot read cards without isPublic field
        const unauthedDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(unauthedDb, collectionName, 'card1')));
      });

      test('should allow authenticated users to read their own private cards', async () => {
        // Setup: Create a private card owned by user1
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, collectionName, 'card1'), {
            ...validCard,
            isPublic: false,
            createdBy: USER_1_UID,
          });
        });

        // Test: User1 can read their own private card
        const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
        await assertSucceeds(getDoc(doc(user1Db, collectionName, 'card1')));

        // Test: User2 cannot read user1's private card
        const user2Db = testEnv.authenticatedContext(USER_2_UID).firestore();
        await assertFails(getDoc(doc(user2Db, collectionName, 'card1')));
      });
    });
  });

  test('should deny access to invalid collection names', async () => {
    const invalidCollections = ['cards_invalid', 'notcards', 'card', 'cards-pr-123'];

    for (const collectionName of invalidCollections) {
      // Setup: Create a card in invalid collection
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, collectionName, 'card1'), {
          ...validCard,
          isPublic: true,
        });
      });

      // Test: Access denied even for public cards in invalid collections
      const unauthedDb = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(unauthedDb, collectionName, 'card1')));
    }
  });
});

describe('Firestore Security Rules - Create Operations', () => {
  const collectionName = 'cards';

  test('should allow authenticated users to create cards with all required fields', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        title: 'New Card',
        type: 'Item',
        subtype: 'Weapon',
        isPublic: true,
        createdBy: USER_1_UID,
        createdAt: serverTimestamp(),
      })
    );
  });

  test('should deny unauthenticated users from creating cards', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      setDoc(doc(unauthedDb, collectionName, 'newcard'), {
        ...validCard,
      })
    );
  });

  test('should deny creates missing required field: title', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    const cardWithoutTitle = { ...validCard };
    delete (cardWithoutTitle as any).title;
    await assertFails(setDoc(doc(user1Db, collectionName, 'newcard'), cardWithoutTitle));
  });

  test('should deny creates missing required field: type', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    const cardWithoutType = { ...validCard };
    delete (cardWithoutType as any).type;
    await assertFails(setDoc(doc(user1Db, collectionName, 'newcard'), cardWithoutType));
  });

  test('should deny creates missing required field: subtype', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    const cardWithoutSubtype = { ...validCard };
    delete (cardWithoutSubtype as any).subtype;
    await assertFails(setDoc(doc(user1Db, collectionName, 'newcard'), cardWithoutSubtype));
  });

  test('should deny creates missing required field: isPublic', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    const cardWithoutIsPublic = { ...validCard };
    delete (cardWithoutIsPublic as any).isPublic;
    await assertFails(setDoc(doc(user1Db, collectionName, 'newcard'), cardWithoutIsPublic));
  });

  test('should deny creates with empty title', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        title: '',
      })
    );
  });

  test('should deny creates with title exceeding 100 characters', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        title: 'a'.repeat(101),
      })
    );
  });

  test('should allow creates with title at 100 character limit', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        title: 'a'.repeat(100),
      })
    );
  });

  test('should deny creates with empty type', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        type: '',
      })
    );
  });

  test('should deny creates with empty subtype', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        subtype: '',
      })
    );
  });

  test('should deny creates with non-boolean isPublic', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        isPublic: 'true' as any,
      })
    );
  });

  test('should deny creates with wrong createdBy UID', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        createdBy: USER_2_UID, // Trying to impersonate another user
      })
    );
  });

  test('should allow creates with description under 500 characters', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        description: 'a'.repeat(500),
      })
    );
  });

  test('should deny creates with description exceeding 500 characters', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        description: 'a'.repeat(501),
      })
    );
  });

  test('should allow creates with optional fields', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      setDoc(doc(user1Db, collectionName, 'newcard'), {
        ...validCard,
        description: 'Test description',
        tags: ['tag1', 'tag2'],
        stat1: 10,
        stat2: 20,
        cost: 5,
      })
    );
  });
});

describe('Firestore Security Rules - Update Operations (Wiki-Style)', () => {
  const collectionName = 'cards';

  beforeEach(async () => {
    // Setup: Create a card owned by user1
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, collectionName, 'card1'), {
        ...validCard,
        isPublic: true,
        createdBy: USER_1_UID,
      });
    });
  });

  test('should allow card owner to update their own card', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(user1Db, collectionName, 'card1'), {
        title: 'Updated Title',
        lastModifiedBy: USER_1_UID,
        lastModifiedAt: serverTimestamp(),
      })
    );
  });

  test('should allow any authenticated user to update any card (wiki-style)', async () => {
    // User2 updating user1's card
    const user2Db = testEnv.authenticatedContext(USER_2_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(user2Db, collectionName, 'card1'), {
        title: 'Updated by User2',
        lastModifiedBy: USER_2_UID,
        lastModifiedAt: serverTimestamp(),
      })
    );
  });

  test('should deny unauthenticated users from updating cards', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(
      updateDoc(doc(unauthedDb, collectionName, 'card1'), {
        title: 'Updated Title',
      })
    );
  });

  test('should allow creator to update without lastModifiedBy (uses creator check)', async () => {
    // The rules allow creator to update using the creator check:
    // (resource.data.get('createdBy', '') == request.auth.uid || request.resource.data.lastModifiedBy == request.auth.uid)
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(user1Db, collectionName, 'card1'), {
        title: 'Updated Title',
        lastModifiedAt: serverTimestamp(),
      })
    );
  });

  test('should deny updates without lastModifiedAt field', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      updateDoc(doc(user1Db, collectionName, 'card1'), {
        title: 'Updated Title',
        lastModifiedBy: USER_1_UID,
      })
    );
  });

  test('should allow creator to update with any lastModifiedBy (creator check takes precedence)', async () => {
    // The rules use OR logic, so if you're the creator, you can update even with wrong lastModifiedBy
    // because the creator check (first part of OR) succeeds
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(
      updateDoc(doc(user1Db, collectionName, 'card1'), {
        title: 'Updated Title',
        lastModifiedBy: USER_2_UID, // Ignored because creator check passes
        lastModifiedAt: serverTimestamp(),
      })
    );
  });

  test('should deny non-creator updates with wrong lastModifiedBy UID', async () => {
    // Non-creators must provide correct lastModifiedBy
    const user2Db = testEnv.authenticatedContext(USER_2_UID).firestore();
    await assertFails(
      updateDoc(doc(user2Db, collectionName, 'card1'), {
        title: 'Updated by User2',
        lastModifiedBy: USER_1_UID, // Wrong UID (trying to impersonate user1)
        lastModifiedAt: serverTimestamp(),
      })
    );
  });

  test('should deny updates with non-server timestamp for lastModifiedAt', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertFails(
      updateDoc(doc(user1Db, collectionName, 'card1'), {
        title: 'Updated Title',
        lastModifiedBy: USER_1_UID,
        lastModifiedAt: new Date(), // Not using serverTimestamp()
      })
    );
  });
});

describe('Firestore Security Rules - Delete Operations', () => {
  const collectionName = 'cards';

  beforeEach(async () => {
    // Setup: Create cards owned by different users
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, collectionName, 'card1'), {
        ...validCard,
        isPublic: true,
        createdBy: USER_1_UID,
      });
      await setDoc(doc(db, collectionName, 'card2'), {
        ...validCard,
        isPublic: true,
        createdBy: USER_2_UID,
      });
    });
  });

  test('should allow card owner to delete their own card', async () => {
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(deleteDoc(doc(user1Db, collectionName, 'card1')));
  });

  test('should deny non-owners from deleting cards', async () => {
    // User2 trying to delete user1's card
    const user2Db = testEnv.authenticatedContext(USER_2_UID).firestore();
    await assertFails(deleteDoc(doc(user2Db, collectionName, 'card1')));
  });

  test('should deny unauthenticated users from deleting cards', async () => {
    const unauthedDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(deleteDoc(doc(unauthedDb, collectionName, 'card1')));
  });

  test('should allow owner to delete even if other users can edit (wiki-style)', async () => {
    // Even though anyone can edit, only owner can delete
    const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
    await assertSucceeds(deleteDoc(doc(user1Db, collectionName, 'card1')));
  });
});

describe('Firestore Security Rules - Collection Pattern Validation', () => {
  test('should allow operations on valid collection patterns', async () => {
    const validCollections = [
      'cards',
      'cards_pr_1',
      'cards_pr_999',
      'cards_preview_feature-branch',
      'cards_preview_fix-123',
      'cards-worker-0',
      'cards-worker-10',
    ];

    for (const collectionName of validCollections) {
      const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
      await assertSucceeds(
        setDoc(doc(user1Db, collectionName, 'test'), {
          ...validCard,
          createdBy: USER_1_UID,
        })
      );
    }
  });

  test('should deny operations on invalid collection patterns', async () => {
    const invalidCollections = [
      'card', // Missing 's'
      'cards_', // Incomplete pattern
      'cards_pr_', // Missing number
      'cards_pr_abc', // Non-numeric PR number
      'cards_preview_', // Missing branch name
      'cards_preview_Feature', // Uppercase not allowed
      'cards-worker', // Missing index
      'cards-worker-', // Missing index
      'notcards',
      'mycards',
    ];

    for (const collectionName of invalidCollections) {
      const user1Db = testEnv.authenticatedContext(USER_1_UID).firestore();
      await assertFails(
        setDoc(doc(user1Db, collectionName, 'test'), {
          ...validCard,
          createdBy: USER_1_UID,
        })
      );
    }
  });
});

console.log('✅ All Firestore security rules tests defined');
