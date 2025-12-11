import { Firestore } from '@google-cloud/firestore';
import { Storage } from '@google-cloud/storage';
import { AuthHelper } from './auth-helper';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';

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

export interface FileDataWithGcs extends FileData {
  gcsPath: string;
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
  private authHelper: AuthHelper;
  private createdSessionIDs: string[] = [];
  private createdFileIDs: string[] = [];
  private createdUserIDs: string[] = [];
  private createdFilePaths: string[] = [];
  private listeners = new Map<string, () => void>();

  constructor() {
    console.log('[TestHelpers] Initializing... ENV vars:', {
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST || '(not set)',
      STORAGE_EMULATOR_HOST: process.env.STORAGE_EMULATOR_HOST || '(not set)',
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST || '(not set)',
      GCP_PROJECT_ID: process.env.GCP_PROJECT_ID || '(not set)',
    });

    // Check for emulator environment variables
    const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
    const storageHost = process.env.STORAGE_EMULATOR_HOST;

    if (!firestoreHost) {
      console.error('[TestHelpers] FIRESTORE_EMULATOR_HOST not set!');
      throw new Error('FIRESTORE_EMULATOR_HOST environment variable not set');
    }
    if (!storageHost) {
      console.error('[TestHelpers] STORAGE_EMULATOR_HOST not set!');
      throw new Error('STORAGE_EMULATOR_HOST environment variable not set');
    }

    try {
      console.log('[TestHelpers] Initializing Firestore with host:', firestoreHost);
      // Initialize Firestore client with emulator
      this.firestore = new Firestore({
        projectId: 'demo-test',
        host: firestoreHost,
        ssl: false,
      });
      console.log('[TestHelpers] Firestore initialized successfully');

      console.log('[TestHelpers] Initializing Storage with host:', storageHost);
      // Initialize GCS client with emulator
      // The Storage SDK uses STORAGE_EMULATOR_HOST env var directly
      process.env.STORAGE_EMULATOR_HOST = storageHost;
      this.storage = new Storage({
        projectId: 'demo-test',
      });
      console.log('[TestHelpers] Storage initialized successfully');

      console.log('[TestHelpers] Initializing AuthHelper...');
      // Initialize Auth helper
      this.authHelper = new AuthHelper();
      console.log('[TestHelpers] AuthHelper initialized successfully');
    } catch (error) {
      console.error('[TestHelpers] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Creates a test session in Firestore
   * @param userID User ID for the session
   * @param rootDir Root directory path
   * @param files Array of file data objects
   * @returns Session ID
   */
  async createTestSession(userID: string, rootDir: string, files: FileData[]): Promise<string> {
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
   * Creates a physical test file on disk
   * @param filePath Absolute path where the file should be created
   * @param size File size in bytes (default: 1024)
   */
  private async createPhysicalFile(filePath: string, size: number = 1024): Promise<void> {
    // Convert absolute /test paths to temp directory to avoid permission issues
    let actualPath = filePath;
    if (filePath.startsWith('/test/')) {
      actualPath = filePath.replace('/test/', '/tmp/printsync-test-files/');
    }

    const dir = path.dirname(actualPath);
    await fs.mkdir(dir, { recursive: true });

    // Generate minimal valid file content based on extension
    const ext = path.extname(filePath).toLowerCase();
    let content: Buffer;

    if (ext === '.pdf') {
      // Minimal valid PDF with correct structure
      const pdfContent = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 4 0 R >> >> /MediaBox [0 0 612 792] /Contents 5 0 R >>
endobj
4 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
5 0 obj
<< /Length 44 >>
stream
BT
/F1 12 Tf
100 700 Td
(Test PDF) Tj
ET
endstream
endobj
xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000262 00000 n
0000000341 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
434
%%EOF`;
      content = Buffer.from(pdfContent);
    } else if (ext === '.epub') {
      // Minimal valid EPUB (just a ZIP with mimetype file)
      const mimetype = 'application/epub+zip';
      content = Buffer.from(mimetype);
    } else {
      // Default: random binary data
      content = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        content[i] = Math.floor(Math.random() * 256);
      }
    }

    await fs.writeFile(actualPath, content);
    this.createdFilePaths.push(actualPath);
  }

  /**
   * Creates a test file in Firestore
   * @param userID User ID for the file
   * @param sessionID Session ID to associate the file with
   * @param fileData File data object
   * @returns File ID
   */
  async createTestFile(userID: string, sessionID: string, fileData: FileData): Promise<string> {
    // Convert absolute /test paths to temp directory (same as createPhysicalFile)
    let actualPath = fileData.localPath;
    if (fileData.localPath && fileData.localPath.startsWith('/test/')) {
      actualPath = fileData.localPath.replace('/test/', '/tmp/printsync-test-files/');
    }

    // Create physical file on disk if path is provided
    if (fileData.localPath) {
      await this.createPhysicalFile(fileData.localPath, 1024);
    }
    const fileID = `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}`;

    const file = {
      userId: userID,
      sessionId: sessionID,
      localPath: actualPath,
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
  async waitForFileStatus(fileID: string, status: string, timeout: number = 30000): Promise<void> {
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
    await Promise.all(fileIDs.map((fileID) => this.waitForFileStatus(fileID, status, timeout)));
  }

  /**
   * Creates multiple test files in Firestore in parallel
   * @param userID User ID for the files
   * @param sessionID Session ID to associate the files with
   * @param files Array of file data objects
   * @returns Array of file IDs
   */
  async createTestFiles(userID: string, sessionID: string, files: FileData[]): Promise<string[]> {
    // Create physical files first
    await Promise.all(
      files.map((file) => {
        if (file.localPath) {
          return this.createPhysicalFile(file.localPath, 1024);
        }
        return Promise.resolve();
      })
    );

    const fileIDsWithData = files.map((file) => {
      // Convert absolute /test paths to temp directory
      let actualPath = file.localPath;
      if (file.localPath && file.localPath.startsWith('/test/')) {
        actualPath = file.localPath.replace('/test/', '/tmp/printsync-test-files/');
      }

      return {
        id: `test-file-${Date.now()}-${Math.random().toString(36).substring(7)}`,
        data: {
          userId: userID,
          sessionId: sessionID,
          localPath: actualPath,
          gcsPath: file.gcsPath || '',
          hash: file.hash,
          status: file.status,
          metadata: file.metadata || {},
          updatedAt: new Date(),
        },
      };
    });

    // Parallel Firestore writes
    await Promise.all(
      fileIDsWithData.map(({ id, data }) =>
        this.firestore.collection('printsync-files').doc(id).set(data)
      )
    );

    this.createdFileIDs.push(...fileIDsWithData.map((f) => f.id));
    return fileIDsWithData.map((f) => f.id);
  }

  /**
   * Updates session stats based on file statuses
   * Call this after creating test files to ensure stats reflect file states
   * @param sessionID Session ID to update
   * @param files Array of file data objects (same as passed to createTestFiles)
   */
  async updateSessionStats(sessionID: string, files: FileData[]): Promise<void> {
    const stats = {
      discovered: files.length,
      extracted: files.length,
      approved: 0,
      rejected: 0,
      skipped: 0,
      uploaded: 0,
      failed: 0,
      deduplicated: 0,
    };

    // Count file statuses
    for (const file of files) {
      switch (file.status) {
        case 'uploaded':
          stats.uploaded++;
          break;
        case 'rejected':
          stats.rejected++;
          break;
        case 'skipped':
          stats.skipped++;
          break;
        case 'failed':
          stats.failed++;
          break;
        case 'approved':
          stats.approved++;
          break;
        case 'deduplicated':
          stats.deduplicated++;
          break;
      }
    }

    await this.firestore.collection('printsync-sessions').doc(sessionID).update({ stats });
  }

  /**
   * Creates a Firebase Auth token for a test user
   * @param userID User ID (should match the userID in test session)
   * @returns Firebase ID token for use in Authorization: Bearer header
   */
  async createAuthToken(userID: string): Promise<string> {
    const token = await this.authHelper.createUserAndGetToken(userID);
    this.createdUserIDs.push(userID);
    return token;
  }

  /**
   * Injects authentication into a Playwright page context
   * This sets both the Authorization header and firebase_token cookie
   * @param page Playwright page object
   * @param userID User ID to authenticate as
   */
  async setPageAuth(page: any, userID: string): Promise<void> {
    // Create auth token for the user
    const authToken = await this.createAuthToken(userID);

    // Get the browser context from the page
    const context = page.context();

    // Set Authorization header for API calls
    await context.setExtraHTTPHeaders({
      Authorization: `Bearer ${authToken}`,
    });

    // Set auth token as cookie for EventSource/SSE connections
    // EventSource cannot send custom headers, so we use cookies as fallback
    await context.addCookies([
      {
        name: 'firebase_token',
        value: authToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);
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
   * Clears ALL data from Firestore emulator (not just test-created data)
   * Use this between tests to prevent path conflicts from previous test runs
   */
  async clearAllFirestoreData(): Promise<void> {
    try {
      const projectId = 'demo-test';
      const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8081';
      const deleteUrl = `http://${firestoreHost}/emulator/v1/projects/${projectId}/databases/(default)/documents`;

      await fetch(deleteUrl, { method: 'DELETE' });
    } catch (error: any) {
      // Silently ignore errors - database might already be empty
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
      ...this.createdFileIDs.map((id) =>
        this.firestore
          .collection('printsync-files')
          .doc(id)
          .delete()
          .catch(() => {})
      ),
      ...this.createdSessionIDs.map((id) =>
        this.firestore
          .collection('printsync-sessions')
          .doc(id)
          .delete()
          .catch(() => {})
      ),
      ...this.createdUserIDs.map((id) => this.authHelper.deleteUser(id).catch(() => {})),
      ...this.createdFilePaths.map((filePath) => fs.unlink(filePath).catch(() => {})),
    ]);

    this.createdFileIDs = [];
    this.createdSessionIDs = [];
    this.createdUserIDs = [];
    this.createdFilePaths = [];

    // Cleanup auth helper
    await this.authHelper.cleanup();
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

  /**
   * Update file status in Firestore to simulate SSE events
   * @param fileID File ID to update
   * @param status New status value
   */
  async updateFileStatus(fileID: string, status: string): Promise<void> {
    const docRef = this.firestore.collection('printsync-files').doc(fileID);
    await docRef.update({
      status,
      updatedAt: new Date(),
    });
  }

  /**
   * Generates a unique test user ID
   */
  generateTestUserID(): string {
    return `test-user-${randomUUID()}`;
  }

  /**
   * Generates test PDF file data
   */
  generateTestPDFFile(overrides?: any): FileData {
    const uniqueId = randomUUID().substring(0, 8);
    return {
      localPath: '/test/documents/sample.pdf',
      hash: randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, ''),
      status: 'extracted',
      metadata: {
        title: `Test PDF ${uniqueId}`,
        author: `Author ${uniqueId}`,
        subject: 'Test Subject',
      },
      ...overrides,
    };
  }
}
