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
  private listeners = new Map<string, () => void>();

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
      userId: userID,
      rootDir,
      status: 'running',
      startedAt: new Date(),
      stats: {
        discovered: files.length,
        extracted: files.length,
        approved: 0,
        rejected: 0,
        skipped: 0,
        uploaded: 0,
        failed: 0,
        deduplicated: 0,
      },
    };

    await this.firestore.collection('printsync-sessions').doc(sessionID).set(sessionData);
    this.createdSessionIDs.push(sessionID);

    return sessionID;
  }

  /**
   * Creates a test file in Firestore
   * @param userID User ID for the file
   * @param sessionID Session ID to associate the file with
   * @param fileData File data object
   * @returns File ID
   */
  async createTestFile(userID: string, sessionID: string, fileData: FileData): Promise<string> {
    const fileID = `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const file = {
      userId: userID,
      sessionId: sessionID,
      localPath: fileData.localPath,
      gcsPath: fileData.gcsPath || '',
      hash: fileData.hash,
      status: fileData.status,
      metadata: fileData.metadata || {},
      updatedAt: new Date(),
    };

    await this.firestore.collection('printsync-files').doc(fileID).set(file);
    this.createdFileIDs.push(fileID);

    return fileID;
  }

  /**
   * Waits for a file to reach a specific status using Firestore snapshot listeners
   * @param fileID File ID to monitor
   * @param status Expected status
   * @param timeout Timeout in milliseconds (default: 30000)
   */
  async waitForFileStatus(
    fileID: string,
    status: string,
    timeout: number = 30000
  ): Promise<void> {
    // First check if file already has the target status
    const initialDoc = await this.firestore.collection('printsync-files').doc(fileID).get();
    if (initialDoc.exists && initialDoc.data()?.status === status) {
      return;
    }

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        unsubscribe();
        this.listeners.delete(fileID);
        reject(new Error(`Timeout waiting for file ${fileID} to reach ${status}`));
      }, timeout);

      // Firestore snapshot listener - fires on all changes including initial snapshot
      const unsubscribe = this.firestore
        .collection('printsync-files')
        .doc(fileID)
        .onSnapshot(
          (snapshot) => {
            const data = snapshot.data();
            if (data?.status === status) {
              clearTimeout(timeoutHandle);
              unsubscribe();
              this.listeners.delete(fileID);
              resolve();
            }
          },
          (error) => {
            clearTimeout(timeoutHandle);
            unsubscribe();
            this.listeners.delete(fileID);
            reject(error);
          }
        );

      this.listeners.set(fileID, unsubscribe);
    });
  }

  /**
   * Waits for multiple files to reach a specific status in parallel
   * @param fileIDs Array of file IDs to monitor
   * @param status Expected status
   * @param timeout Timeout in milliseconds (default: 30000)
   */
  async waitForFilesStatus(
    fileIDs: string[],
    status: string,
    timeout: number = 30000
  ): Promise<void> {
    await Promise.all(
      fileIDs.map(fileID => this.waitForFileStatus(fileID, status, timeout))
    );
  }

  /**
   * Creates multiple test files in Firestore in parallel
   * @param userID User ID for the files
   * @param sessionID Session ID to associate the files with
   * @param files Array of file data objects
   * @returns Array of file IDs
   */
  async createTestFiles(
    userID: string,
    sessionID: string,
    files: FileData[]
  ): Promise<string[]> {
    const fileIDsWithData = files.map(file => ({
      id: `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}`,
      data: {
        userId: userID,
        sessionId: sessionID,
        localPath: file.localPath,
        gcsPath: file.gcsPath || '',
        hash: file.hash,
        status: file.status,
        metadata: file.metadata || {},
        updatedAt: new Date(),
      },
    }));

    // Parallel Firestore writes
    await Promise.all(
      fileIDsWithData.map(({ id, data }) =>
        this.firestore.collection('printsync-files').doc(id).set(data)
      )
    );

    this.createdFileIDs.push(...fileIDsWithData.map(f => f.id));
    return fileIDsWithData.map(f => f.id);
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
    const doc = await this.firestore.collection('printsync-files').doc(fileID).get();

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
    // Unsubscribe all listeners first
    for (const unsubscribe of this.listeners.values()) {
      unsubscribe();
    }
    this.listeners.clear();

    // Parallel cleanup
    await Promise.all([
      ...this.createdFileIDs.map(id =>
        this.firestore.collection('printsync-files').doc(id).delete().catch(() => {})
      ),
      ...this.createdSessionIDs.map(id =>
        this.firestore.collection('printsync-sessions').doc(id).delete().catch(() => {})
      )
    ]);

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
