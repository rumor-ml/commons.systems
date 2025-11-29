import { test as base, expect } from '@playwright/test';
import { TestHelpers } from './test-helpers';
import { generateTestUserID, generateTestPDFFile, generateTestEPUBFile } from './test-data';

export interface TestSession {
  sessionID: string;
  userID: string;
  fileIDs: string[];
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
      const fileID = await helpers.createTestFile(sessionID, file);
      fileIDs.push(fileID);
    }

    const testSession: TestSession = {
      sessionID,
      userID,
      fileIDs,
    };

    // Provide the test session to the test
    await use(testSession);

    // Cleanup is handled by the helpers fixture
  },
});

export { expect };
