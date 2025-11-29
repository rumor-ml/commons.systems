import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

/**
 * Generic data structure for items in the app
 * Override this in your app-specific code with your actual data types
 */
export interface ItemData {
  id?: string;
  [key: string]: any;
}

/**
 * Test helpers for interacting with Firestore and GCS emulators
 *
 * This class provides generic utilities for E2E tests that need to:
 * - Seed test data in Firestore
 * - Verify async operations completed in Firestore
 * - Assert files exist in GCS
 * - Clean up test data automatically
 */
export class TestHelpers {
  private firestore: Firestore;
  private storage: Storage;
  private createdCollections: Map<string, string[]> = new Map();

  constructor() {
    // Check for emulator environment variables
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    const storageHost = process.env.STORAGE_EMULATOR_HOST;

    if (!firestoreHost) {
      throw new Error('FIRESTORE_EMULATOR_HOST environment variable not set');
    }
    if (!storageHost) {
      throw new Error('STORAGE_EMULATOR_HOST environment variable not set');
    }

    // Initialize Firestore client with emulator
    this.firestore = new Firestore({
      projectId: 'demo-test',
      host: firestoreHost,
      ssl: false,
    });

    // Initialize GCS client with emulator
    this.storage = new Storage({
      projectId: 'demo-test',
      apiEndpoint: `http://${storageHost}`,
    });
  }

  /**
   * Creates a test item in a Firestore collection
   * @param collection Collection name (e.g., '{{APP_NAME}}-items')
   * @param data Item data
   * @param customID Optional custom document ID
   * @returns Document ID
   */
  async createItem(
    collection: string,
    data: ItemData,
    customID?: string
  ): Promise<string> {
    const id = customID || `test-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const itemData = {
      id,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };

    await this.firestore.collection(collection).doc(id).set(itemData);

    // Track for cleanup
    if (!this.createdCollections.has(collection)) {
      this.createdCollections.set(collection, []);
    }
    this.createdCollections.get(collection)!.push(id);

    return id;
  }

  /**
   * Gets an item from Firestore
   * @param collection Collection name
   * @param id Document ID
   * @returns Document data or null if not found
   */
  async getItem(collection: string, id: string): Promise<ItemData | null> {
    const doc = await this.firestore.collection(collection).doc(id).get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as ItemData;
  }

  /**
   * Waits for an item to reach a specific state
   * Polls Firestore until the condition is met or timeout is reached
   *
   * @param collection Collection name
   * @param id Document ID
   * @param condition Function that returns true when desired state is reached
   * @param timeout Timeout in milliseconds (default: 30000)
   * @param pollInterval Poll interval in milliseconds (default: 100)
   *
   * @example
   * // Wait for status to be 'completed'
   * await helpers.waitForCondition('tasks', taskID, (data) => data.status === 'completed');
   */
  async waitForCondition(
    collection: string,
    id: string,
    condition: (data: ItemData) => boolean,
    timeout: number = 30000,
    pollInterval: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const doc = await this.firestore.collection(collection).doc(id).get();

      if (doc.exists) {
        const data = doc.data() as ItemData;
        if (condition(data)) {
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Timeout waiting for condition on ${collection}/${id} after ${timeout}ms`
    );
  }

  /**
   * Asserts that an item exists in Firestore with expected state
   * Performs partial matching - only checks fields specified in expectedState
   *
   * @param collection Collection name
   * @param id Document ID
   * @param expectedState Expected state object (partial match)
   *
   * @example
   * await helpers.assertItemInFirestore('tasks', taskID, {
   *   status: 'completed',
   *   result: { success: true }
   * });
   */
  async assertItemInFirestore(
    collection: string,
    id: string,
    expectedState: Partial<ItemData>
  ): Promise<void> {
    const doc = await this.firestore.collection(collection).doc(id).get();

    if (!doc.exists) {
      throw new Error(`Item ${id} not found in collection ${collection}`);
    }

    const data = doc.data() as ItemData;

    for (const [key, expectedValue] of Object.entries(expectedState)) {
      const actualValue = data[key];

      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        throw new Error(
          `Item ${collection}/${id} field ${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
        );
      }
    }
  }

  /**
   * Asserts that a file exists in GCS
   *
   * @param bucket Bucket name
   * @param path Object path
   *
   * @example
   * await helpers.assertFileInGCS('my-bucket', 'uploads/file.pdf');
   */
  async assertFileInGCS(bucket: string, path: string): Promise<void> {
    const file = this.storage.bucket(bucket).file(path);
    const [exists] = await file.exists();

    if (!exists) {
      throw new Error(`File ${path} not found in GCS bucket ${bucket}`);
    }
  }

  /**
   * Gets file content from GCS
   *
   * @param bucket Bucket name
   * @param path Object path
   * @returns File content as Buffer
   */
  async getFileFromGCS(bucket: string, path: string): Promise<Buffer> {
    const file = this.storage.bucket(bucket).file(path);
    const [content] = await file.download();
    return content;
  }

  /**
   * Uploads a file to GCS (useful for seeding test data)
   *
   * @param bucket Bucket name
   * @param path Object path
   * @param content File content
   */
  async uploadFileToGCS(bucket: string, path: string, content: Buffer): Promise<void> {
    const file = this.storage.bucket(bucket).file(path);
    await file.save(content);
  }

  /**
   * Queries a collection with optional filters
   *
   * @param collection Collection name
   * @param filters Optional filters as field-value pairs
   * @returns Array of items
   *
   * @example
   * const items = await helpers.queryCollection('tasks', { status: 'pending' });
   */
  async queryCollection(
    collection: string,
    filters?: Record<string, any>
  ): Promise<ItemData[]> {
    let query: any = this.firestore.collection(collection);

    if (filters) {
      for (const [field, value] of Object.entries(filters)) {
        query = query.where(field, '==', value);
      }
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc: any) => doc.data() as ItemData);
  }

  /**
   * Cleans up all test data created by this helper instance
   * Automatically called by fixtures after each test
   */
  async cleanup(): Promise<void> {
    const deletePromises: Promise<any>[] = [];

    // Delete all created documents from all collections
    for (const [collection, ids] of this.createdCollections.entries()) {
      for (const id of ids) {
        deletePromises.push(
          this.firestore.collection(collection).doc(id).delete().catch(() => {
            // Ignore errors during cleanup
          })
        );
      }
    }

    await Promise.all(deletePromises);

    // Clear the tracking map
    this.createdCollections.clear();
  }

  /**
   * Gets the Firestore client instance
   * Use this for advanced queries or operations not covered by helper methods
   */
  getFirestore(): Firestore {
    return this.firestore;
  }

  /**
   * Gets the Storage client instance
   * Use this for advanced GCS operations not covered by helper methods
   */
  getStorage(): Storage {
    return this.storage;
  }
}
