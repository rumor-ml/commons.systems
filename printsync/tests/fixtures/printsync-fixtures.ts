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

    // NOTE: Do NOT call clearAllFirestoreData() here - it causes race conditions when
    // tests run in parallel (worker A's session gets deleted by worker B's clearAll).
    // The per-test cleanup in helpers.cleanup() is sufficient.

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
   * Page fixture - creates an unauthenticated browser context by default.
   * Tests that need authentication should use helpers.createAuthenticatedPage()
   * or explicitly set auth headers after creating the page.
   */
  page: async ({ browser }, use) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await use(page);
    await context.close();
  },
});

export { expect };
