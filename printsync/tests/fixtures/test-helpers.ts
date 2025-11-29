import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';

export interface FileData {
  localPath: string;
  gcsPath?: string;
  hash: string;
  status: string;
  metadata?: {
    title?: string;
    author?: string;
    [key: string]: any;
  };
}

export interface SessionData {
  userID: string;
  rootDir: string;
  files: FileData[];
}

/**
 * Test helpers for interacting with Firestore and GCS emulators
 */
export class TestHelpers {
  private firestore: Firestore;
  private storage: Storage;
  private createdSessionIDs: string[] = [];
  private createdFileIDs: string[] = [];

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
   * Creates a test session in Firestore
   * @param userID User ID for the session
   * @param rootDir Root directory path
   * @param files Array of file data objects
   * @returns Session ID
   */
  async createTestSession(
    userID: string,
    rootDir: string,
    files: FileData[]
  ): Promise<string> {
    const sessionID = `test-session-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const sessionData = {
      id: sessionID,
      userID,
      rootDir,
      status: 'running',
      startedAt: new Date(),
      stats: {
        discovered: files.length,
        uploaded: 0,
        failed: 0,
        deduplicated: 0,
      },
    };

    await this.firestore.collection('sessions').doc(sessionID).set(sessionData);
    this.createdSessionIDs.push(sessionID);

    return sessionID;
  }

  /**
   * Creates a test file in Firestore
   * @param sessionID Session ID to associate the file with
   * @param fileData File data object
   * @returns File ID
   */
  async createTestFile(sessionID: string, fileData: FileData): Promise<string> {
    const fileID = `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const file = {
      id: fileID,
      sessionID,
      localPath: fileData.localPath,
      gcsPath: fileData.gcsPath || '',
      hash: fileData.hash,
      status: fileData.status,
      metadata: fileData.metadata || {},
      updatedAt: new Date(),
    };

    await this.firestore.collection('files').doc(fileID).set(file);
    this.createdFileIDs.push(fileID);

    return fileID;
  }

  /**
   * Waits for a file to reach a specific status
   * @param fileID File ID to monitor
   * @param status Expected status
   * @param timeout Timeout in milliseconds (default: 30000)
   */
  async waitForFileStatus(
    fileID: string,
    status: string,
    timeout: number = 30000
  ): Promise<void> {
    const startTime = Date.now();
    const pollInterval = 100; // Poll every 100ms

    while (Date.now() - startTime < timeout) {
      const doc = await this.firestore.collection('files').doc(fileID).get();

      if (doc.exists) {
        const data = doc.data();
        if (data?.status === status) {
          return;
        }
      }

      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(
      `Timeout waiting for file ${fileID} to reach status ${status} after ${timeout}ms`
    );
  }

  /**
   * Asserts that a file exists in Firestore with expected state
   * @param fileID File ID to verify
   * @param expectedState Expected state object (partial match)
   */
  async assertFileInFirestore(
    fileID: string,
    expectedState: Partial<Record<string, any>>
  ): Promise<void> {
    const doc = await this.firestore.collection('files').doc(fileID).get();

    if (!doc.exists) {
      throw new Error(`File ${fileID} not found in Firestore`);
    }

    const data = doc.data();

    for (const [key, expectedValue] of Object.entries(expectedState)) {
      const actualValue = data?.[key];

      if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
        throw new Error(
          `File ${fileID} field ${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`
        );
      }
    }
  }

  /**
   * Asserts that a file exists in GCS
   * @param bucket Bucket name
   * @param path Object path
   */
  async assertFileInGCS(bucket: string, path: string): Promise<void> {
    const file = this.storage.bucket(bucket).file(path);
    const [exists] = await file.exists();

    if (!exists) {
      throw new Error(`File ${path} not found in GCS bucket ${bucket}`);
    }
  }

  /**
   * Cleans up all test data created by this helper instance
   */
  async cleanup(): Promise<void> {
    // Delete all created files
    const fileDeletePromises = this.createdFileIDs.map(fileID =>
      this.firestore.collection('files').doc(fileID).delete().catch(() => {
        // Ignore errors during cleanup
      })
    );

    // Delete all created sessions
    const sessionDeletePromises = this.createdSessionIDs.map(sessionID =>
      this.firestore.collection('sessions').doc(sessionID).delete().catch(() => {
        // Ignore errors during cleanup
      })
    );

    await Promise.all([...fileDeletePromises, ...sessionDeletePromises]);

    // Clear the tracking arrays
    this.createdFileIDs = [];
    this.createdSessionIDs = [];
  }

  /**
   * Gets the Firestore client instance
   */
  getFirestore(): Firestore {
    return this.firestore;
  }

  /**
   * Gets the Storage client instance
   */
  getStorage(): Storage {
    return this.storage;
  }
}
