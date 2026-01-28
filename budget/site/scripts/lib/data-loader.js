/**
 * Data loader for budget demo data
 *
 * Loads and validates transactions.json data
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function loadTransactionData() {
  const dataPath = join(__dirname, '../../src/data/transactions.json');

  let data;
  try {
    const dataContent = readFileSync(dataPath, 'utf8');
    data = JSON.parse(dataContent);
  } catch (error) {
    console.error(`\n❌ Failed to load transactions data from ${dataPath}:`, error.message);

    if (error.code === 'ENOENT') {
      console.error('The transactions.json file does not exist.');
      console.error('Expected location: budget/site/src/data/transactions.json');
    } else if (error instanceof SyntaxError) {
      console.error('The transactions.json file contains invalid JSON.');
    } else {
      console.error('Ensure the file exists and is readable.');
    }

    process.exit(1);
  }

  // Validate data structure
  if (!data.institutions || !Array.isArray(data.institutions)) {
    console.error('\n❌ Invalid data format: missing or invalid "institutions" array');
    process.exit(1);
  }

  if (!data.accounts || !Array.isArray(data.accounts)) {
    console.error('\n❌ Invalid data format: missing or invalid "accounts" array');
    process.exit(1);
  }

  if (!data.statements || !Array.isArray(data.statements)) {
    console.error('\n❌ Invalid data format: missing or invalid "statements" array');
    process.exit(1);
  }

  if (!data.transactions || !Array.isArray(data.transactions)) {
    console.error('\n❌ Invalid data format: missing or invalid "transactions" array');
    process.exit(1);
  }

  console.log(`\n📦 Loaded data:`);
  console.log(`   Institutions: ${data.institutions.length}`);
  console.log(`   Accounts: ${data.accounts.length}`);
  console.log(`   Statements: ${data.statements.length}`);
  console.log(`   Transactions: ${data.transactions.length}`);

  return data;
}

/**
 * Validates that an object is Firestore-compatible
 * @param {object} obj - The object to validate
 * @param {string} path - The current path in the object hierarchy (for error messages)
 * @returns {Array<string>} Array of validation error messages (empty if valid)
 *
 * Firestore does not support:
 * - undefined values (use null instead)
 * - function values
 * - symbol values
 */
export function validateFirestoreData(obj, path = 'root') {
  const errors = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = `${path}.${key}`;

    if (value === undefined) {
      errors.push(`${currentPath} is undefined (Firestore does not support undefined values)`);
    } else if (typeof value === 'function') {
      errors.push(`${currentPath} is a function (Firestore does not support functions)`);
    } else if (typeof value === 'symbol') {
      errors.push(`${currentPath} is a symbol (Firestore does not support symbols)`);
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      !(value instanceof Date)
    ) {
      // Recursively validate nested objects
      const nestedErrors = validateFirestoreData(value, currentPath);
      errors.push(...nestedErrors);
    } else if (Array.isArray(value)) {
      // Validate array elements
      value.forEach((item, index) => {
        if (item !== null && typeof item === 'object') {
          const arrayErrors = validateFirestoreData(item, `${currentPath}[${index}]`);
          errors.push(...arrayErrors);
        } else if (item === undefined) {
          errors.push(
            `${currentPath}[${index}] is undefined (Firestore does not support undefined values)`
          );
        } else if (typeof item === 'function') {
          errors.push(
            `${currentPath}[${index}] is a function (Firestore does not support functions)`
          );
        } else if (typeof item === 'symbol') {
          errors.push(`${currentPath}[${index}] is a symbol (Firestore does not support symbols)`);
        }
      });
    }
  }

  return errors;
}
