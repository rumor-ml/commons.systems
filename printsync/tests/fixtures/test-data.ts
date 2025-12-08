import { randomUUID } from 'crypto';

/**
 * Generates test PDF metadata with optional overrides
 * Each invocation generates unique title/author to avoid GCS path conflicts
 */
export function generateTestPDFMetadata(overrides?: Record<string, any>) {
  const uniqueId = randomUUID().substring(0, 8);
  return {
    title: `Test PDF ${uniqueId}`,
    author: `Author ${uniqueId}`,
    subject: 'Test Subject',
    keywords: 'test, pdf, document',
    creator: 'Test Creator',
    producer: 'Test Producer',
    creationDate: new Date('2024-01-01'),
    modificationDate: new Date('2024-01-15'),
    pageCount: 10,
    fileSize: 1024 * 100, // 100KB
    mimeType: 'application/pdf',
    ...overrides,
  };
}

/**
 * Generates test EPUB metadata with optional overrides
 * Each invocation generates unique title/author to avoid GCS path conflicts
 */
export function generateTestEPUBMetadata(overrides?: Record<string, any>) {
  const uniqueId = randomUUID().substring(0, 8);
  return {
    title: `Test EPUB ${uniqueId}`,
    author: `Author ${uniqueId}`,
    publisher: 'Test Publisher',
    language: 'en',
    isbn: '978-1234567890',
    publicationDate: new Date('2024-01-01'),
    description: 'A test EPUB book for testing purposes',
    subject: 'Fiction',
    rights: 'Copyright 2024 Test Author',
    fileSize: 1024 * 200, // 200KB
    mimeType: 'application/epub+zip',
    ...overrides,
  };
}

/**
 * Generates a test user ID
 */
export function generateTestUserID(): string {
  return `test-user-${randomUUID()}`;
}

/**
 * Generates a test session ID
 */
export function generateTestSessionID(): string {
  return `test-session-${randomUUID()}`;
}

/**
 * Generates test file content as a buffer
 * @param size Size in bytes (default: 1024)
 */
export function generateTestFileContent(size: number = 1024): Buffer {
  // Generate a buffer filled with test data
  const content = Buffer.alloc(size);

  // Fill with readable test pattern
  for (let i = 0; i < size; i++) {
    // Create a pattern of ASCII characters
    content[i] = 32 + (i % 95); // ASCII printable characters (32-126)
  }

  return content;
}

/**
 * Generates a test file hash (SHA256-like format)
 */
export function generateTestFileHash(): string {
  return randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
}

/**
 * Generates complete test file data
 */
export interface TestFileData {
  localPath: string;
  hash: string;
  status: string;
  metadata: Record<string, any>;
  size: number;
}

/**
 * Generates a complete test PDF file data object
 */
export function generateTestPDFFile(overrides?: Partial<TestFileData>): TestFileData {
  return {
    localPath: '/test/documents/sample.pdf',
    hash: generateTestFileHash(),
    status: 'extracted',
    metadata: generateTestPDFMetadata(),
    size: 1024 * 100,
    ...overrides,
  };
}

/**
 * Generates a complete test EPUB file data object
 */
export function generateTestEPUBFile(overrides?: Partial<TestFileData>): TestFileData {
  return {
    localPath: '/test/books/sample.epub',
    hash: generateTestFileHash(),
    status: 'extracted',
    metadata: generateTestEPUBMetadata(),
    size: 1024 * 200,
    ...overrides,
  };
}

/**
 * Generates a batch of test files
 */
export function generateTestFileBatch(count: number, type: 'pdf' | 'epub' = 'pdf'): TestFileData[] {
  const files: TestFileData[] = [];

  for (let i = 0; i < count; i++) {
    const generator = type === 'pdf' ? generateTestPDFFile : generateTestEPUBFile;
    const extension = type === 'pdf' ? 'pdf' : 'epub';

    files.push(
      generator({
        localPath: `/test/${type}s/file-${i + 1}.${extension}`,
        metadata: {
          title: `Test ${type.toUpperCase()} ${i + 1}`,
        },
      })
    );
  }

  return files;
}
