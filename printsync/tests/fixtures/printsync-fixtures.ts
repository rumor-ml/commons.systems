import { test as base, expect } from '@playwright/test';
import { TestHelpers } from './test-helpers';
import { generateTestUserID, generateTestPDFFile, generateTestEPUBFile } from './test-data';

export interface TestSession {
  sessionID: string;
  userID: string;
  fileIDs: string[];
  authToken: string;
}

/**
 * Extended Playwright fixtures for PrintSync E2E tests
 */
export const test = base.extend<{
  helpers: TestHelpers;
  testSession: TestSession;
}>({
  /**
   * TestHelpers fixture - automatically creates and cleans up after each test
   */
  helpers: async ({}, use) => {
    const helpers = new TestHelpers();

    // Clear Firestore BEFORE each test to prevent path conflicts from previous tests
    await helpers.clearAllFirestoreData();

    // Provide the helpers to the test
    await use(helpers);

    // Cleanup after the test
    await helpers.cleanup();
  },

  /**
   * Pre-seeded test session fixture
   * Creates a session with 2 PDF files and 1 EPUB file
   */
  testSession: async ({ helpers }, use) => {
    const userID = generateTestUserID();
    const rootDir = '/test/documents';

    // Generate test files
    const pdfFile1 = generateTestPDFFile({
      localPath: '/test/documents/sample1.pdf',
    });

    const pdfFile2 = generateTestPDFFile({
      localPath: '/test/documents/sample2.pdf',
    });

    const epubFile = generateTestEPUBFile({
      localPath: '/test/documents/book.epub',
    });

    const files = [
      {
        localPath: pdfFile1.localPath,
        hash: pdfFile1.hash,
        status: pdfFile1.status,
        metadata: pdfFile1.metadata,
      },
      {
        localPath: pdfFile2.localPath,
        hash: pdfFile2.hash,
        status: pdfFile2.status,
        metadata: pdfFile2.metadata,
      },
      {
        localPath: epubFile.localPath,
        hash: epubFile.hash,
        status: epubFile.status,
        metadata: epubFile.metadata,
      },
    ];

    // Create session
    const sessionID = await helpers.createTestSession(userID, rootDir, files);

    // Create files
    const fileIDs: string[] = [];
    for (const file of files) {
      const fileID = await helpers.createTestFile(userID, sessionID, file);
      fileIDs.push(fileID);
    }

    // Generate auth token for this user
    const authToken = await helpers.createAuthToken(userID);

    const testSession: TestSession = {
      sessionID,
      userID,
      fileIDs,
      authToken,
    };

    // Provide the test session to the test
    await use(testSession);

    // Cleanup is handled by the helpers fixture
  },

  /**
   * Override page fixture to inject Firebase auth token in all requests
   * This makes authenticated API calls work in e2e tests
   */
  page: async ({ browser, testSession }, use) => {
    const context = await browser.newContext({
      extraHTTPHeaders: {
        'Authorization': `Bearer ${testSession.authToken}`,
      },
    });

    // Set auth token as cookie for EventSource/SSE connections
    // EventSource cannot send custom headers, so we use cookies as fallback
    await context.addCookies([{
      name: 'firebase_token',
      value: testSession.authToken,
      domain: 'localhost',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    }]);

    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
