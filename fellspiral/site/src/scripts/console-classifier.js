/**
 * Console Error Classifier
 * Categorizes console errors into benign, expected, and critical types
 * Used by E2E tests to focus on critical errors only
 */

export class ConsoleErrorClassifier {
  static CATEGORIES = {
    BENIGN: 'benign',
    EXPECTED: 'expected',
    CRITICAL: 'critical',
  };

  /**
   * Classify a console error message
   * @param {string} errorMessage - The console error message
   * @returns {string} One of: 'benign', 'expected', 'critical'
   */
  static classify(errorMessage) {
    // Benign - external resources that don't affect functionality
    if (errorMessage.includes('favicon.ico')) {
      return this.CATEGORIES.BENIGN;
    }

    if (errorMessage.includes('[vite]')) {
      return this.CATEGORIES.BENIGN;
    }

    // Expected - known initialization races (with TODO for fix)
    // These errors are caught and retried by the application
    if (errorMessage.includes('Auth not initialized')) {
      console.warn('[Expected Error] Auth initialization race - will retry');
      return this.CATEGORIES.EXPECTED;
    }

    // Emulator connectivity issues - temporary state, app operates in offline mode
    if (errorMessage.includes('Could not reach Cloud Firestore backend')) {
      return this.CATEGORIES.EXPECTED;
    }

    if (errorMessage.includes('CORS request did not succeed')) {
      return this.CATEGORIES.EXPECTED;
    }

    // Future: Add more expected error patterns here
    // Example: if (errorMessage.includes('Firestore not ready')) { return this.CATEGORIES.EXPECTED; }

    // Critical - everything else should fail tests
    return this.CATEGORIES.CRITICAL;
  }

  /**
   * Determine if an error should fail E2E tests
   * @param {string} errorMessage - The console error message
   * @returns {boolean} True if error should fail tests
   */
  static shouldFailTest(errorMessage) {
    return this.classify(errorMessage) === this.CATEGORIES.CRITICAL;
  }

  /**
   * Get a human-readable description of the error category
   * @param {string} errorMessage - The console error message
   * @returns {string} Description of the category
   */
  static describe(errorMessage) {
    const category = this.classify(errorMessage);

    switch (category) {
      case this.CATEGORIES.BENIGN:
        return 'Benign error (external resource)';
      case this.CATEGORIES.EXPECTED:
        return 'Expected error (handled by retry logic)';
      case this.CATEGORIES.CRITICAL:
        return 'Critical error (should be fixed)';
      default:
        return 'Unknown category';
    }
  }
}
