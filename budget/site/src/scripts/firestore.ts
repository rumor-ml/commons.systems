import { initializeApp, FirebaseApp } from 'firebase/app';
import {
  getFirestore,
  Firestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  QueryConstraint,
  DocumentData,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import {
  getTransactionsCollectionName,
  getStatementsCollectionName,
  getAccountsCollectionName,
  getInstitutionsCollectionName,
} from './collection-names';

// TODO(#1455): Add test coverage for Firestore query functions (loadUserTransactions,
// loadDemoTransactions, loadUserStatements, loadUserAccounts, loadUserInstitutions).
// Need tests for: query constraints, data transformation, error handling, empty results.

// Validate required Firebase environment variables
const requiredEnvVars = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

// Validate Firebase environment variables (lazy - only when Firebase is initialized)
function validateFirebaseConfig(): void {
  const missingVars = requiredEnvVars.filter(
    (key) => !import.meta.env[key] || import.meta.env[key] === ''
  );

  if (missingVars.length > 0) {
    const error = new Error(
      `Missing required Firebase environment variables: ${missingVars.join(', ')}. ` +
        'Check your .env file or deployment configuration. ' +
        'For local development, copy .env.example to .env and fill in your Firebase values.'
    );
    console.error(error);
    throw error;
  }
}

// Check if Firebase is properly configured (non-throwing variant for UI checks)
export function isFirebaseConfigured(): boolean {
  // Check if all required environment variables are present and not empty
  const hasAllVars = requiredEnvVars.every(
    (key) => import.meta.env[key] && import.meta.env[key] !== ''
  );

  if (!hasAllVars) {
    return false;
  }

  // Check if any values contain placeholder text from .env.example
  const hasPlaceholders = requiredEnvVars.some((key) => {
    const value = import.meta.env[key] as string;
    return value.includes('your-');
  });

  return !hasPlaceholders;
}

// Firebase configuration from environment variables (lazy initialization)
function getFirebaseConfig() {
  // For emulator mode, use dummy values if env vars are missing
  const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';
  const projectId =
    import.meta.env.VITE_FIREBASE_PROJECT_ID ||
    import.meta.env.VITE_GCP_PROJECT_ID ||
    (useEmulator ? 'demo-test' : '');

  if (useEmulator) {
    // Emulator mode: use dummy values, only projectId matters
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'dummy-api-key-for-emulator',
      authDomain:
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || `${projectId}.firebaseapp.com`,
      projectId,
      storageBucket:
        import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.appspot.com`,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '000000000000',
      appId:
        import.meta.env.VITE_FIREBASE_APP_ID ||
        '1:000000000000:web:0000000000000000000000',
    };
  } else {
    // Production mode: validate all required env vars
    validateFirebaseConfig();
    return {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
  }
}

// Branded type for YYYY-MM-DD date strings with compile-time safety
export type DateString = string & { readonly __brand: 'DateString' };

// Type guard to validate date string format
export function isValidDateString(s: string): s is DateString {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// Factory function to create validated DateString
export function createDateString(s: string): DateString {
  if (!isValidDateString(s)) {
    throw new Error(`Invalid date format: ${s}. Expected YYYY-MM-DD format.`);
  }
  return s;
}

// Transaction interface matching Firestore schema
export interface Transaction {
  readonly id: string;
  readonly userId: string;
  readonly date: DateString; // Type-safe date string in YYYY-MM-DD format
  readonly description: string;
  readonly amount: number; // Positive = income, Negative = expense (normalized after parsing)
  readonly category: string;
  readonly redeemable?: boolean;
  readonly vacation?: boolean;
  readonly transfer?: boolean;
  readonly redemptionRate?: number;
  readonly linkedTransactionId?: string;
  readonly statementIds: string[];
  readonly createdAt?: Date;
}

// Statement interface
export interface Statement {
  id: string;
  userId: string;
  accountId: string;
  startDate: string;
  endDate: string;
  transactionIds: string[];
  createdAt?: Date;
}

// Account type union for compile-time safety
export type AccountType = 'checking' | 'savings' | 'credit' | 'investment';

// Account interface
export interface Account {
  id: string;
  userId: string;
  institutionId: string;
  name: string;
  type: AccountType;
  createdAt?: Date;
}

// Institution interface
export interface Institution {
  id: string;
  userId: string;
  name: string;
  createdAt?: Date;
}

// Firestore client singleton
let firebaseApp: FirebaseApp | null = null;
let firestoreDb: Firestore | null = null;
let emulatorConnected = false;

// Initialize Firebase
export function initFirebase(): FirebaseApp {
  if (!firebaseApp) {
    const config = getFirebaseConfig(); // Lazy validation happens here
    firebaseApp = initializeApp(config);
  }
  return firebaseApp;
}

// Get Firestore instance
export function getFirestoreDb(): Firestore {
  if (!firestoreDb) {
    const app = initFirebase();
    firestoreDb = getFirestore(app);

    // Connect to Firestore emulator if configured
    if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true' && !emulatorConnected) {
      const port = import.meta.env.VITE_FIREBASE_EMULATOR_FIRESTORE_PORT || '8081';
      try {
        connectFirestoreEmulator(firestoreDb, 'localhost', parseInt(port, 10));
        emulatorConnected = true;
        console.log(`✓ Connected to Firestore emulator on localhost:${port}`);
      } catch (error) {
        // Ignore "already initialized" errors from hot reload
        if (
          error instanceof Error &&
          error.message.includes('Firestore has already been started')
        ) {
          console.log('Firestore emulator connection already established');
        } else {
          console.error('Failed to connect to Firestore emulator:', error);
          throw error;
        }
      }
    }
  }
  return firestoreDb;
}

// Map Firestore document data to Transaction object
function mapDocumentToTransaction(data: DocumentData): Transaction {
  // Handle createdAt - could be Timestamp, Date, or undefined
  let createdAt: Date | undefined;
  if (data.createdAt) {
    if (typeof data.createdAt.toDate === 'function') {
      // Firestore Timestamp
      createdAt = data.createdAt.toDate();
    } else if (data.createdAt instanceof Date) {
      // Already a Date
      createdAt = data.createdAt;
    }
    // Ignore other types (strings, etc.)
  }

  return {
    id: data.id,
    userId: data.userId,
    date: data.date as DateString, // Already validated by validateTransaction
    description: data.description,
    amount: data.amount,
    category: data.category,
    redeemable: data.redeemable,
    vacation: data.vacation,
    transfer: data.transfer,
    redemptionRate: data.redemptionRate,
    linkedTransactionId: data.linkedTransactionId,
    statementIds: data.statementIds || [],
    createdAt,
  };
}

// Validate Transaction data from Firestore
export function validateTransaction(data: any): Transaction | null {
  // Validate required fields
  // Note: userId is optional for demo transactions (shared data without ownership)
  if (!data.id || !data.date || !data.description) {
    console.warn('Transaction missing required fields:', {
      hasId: !!data.id,
      hasUserId: !!data.userId,
      hasDate: !!data.date,
      hasDescription: !!data.description,
    });
    return null;
  }

  // Validate date format using type guard
  if (!isValidDateString(data.date)) {
    console.warn('Transaction has invalid date format:', data.date);
    return null;
  }

  // Validate amount is number
  if (typeof data.amount !== 'number' || isNaN(data.amount)) {
    console.warn('Transaction has invalid amount:', data.amount);
    return null;
  }

  // Validate redemptionRate range if present
  if (data.redemptionRate !== undefined && (data.redemptionRate < 0 || data.redemptionRate > 1)) {
    console.warn('Transaction has invalid redemptionRate:', data.redemptionRate);
    return null;
  }

  return mapDocumentToTransaction(data);
}

// Factory function to create a Transaction with validation
export function createTransaction(data: {
  id: string;
  userId: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  redeemable?: boolean;
  vacation?: boolean;
  transfer?: boolean;
  redemptionRate?: number;
  linkedTransactionId?: string;
  statementIds?: string[];
  createdAt?: Date;
}): Transaction | null {
  // Use existing validation logic
  return validateTransaction({
    ...data,
    statementIds: data.statementIds || [],
  });
}

// Load transactions for a user
export async function loadUserTransactions(
  userId: string,
  options?: {
    startDate?: string;
    endDate?: string;
    category?: string;
    limitCount?: number;
  }
): Promise<Transaction[]> {
  const db = getFirestoreDb();
  const transactionsRef = collection(db, getTransactionsCollectionName());

  const constraints: QueryConstraint[] = [where('userId', '==', userId), orderBy('date', 'desc')];

  if (options?.startDate) {
    constraints.push(where('date', '>=', options.startDate));
  }

  if (options?.endDate) {
    constraints.push(where('date', '<=', options.endDate));
  }

  if (options?.category) {
    constraints.push(where('category', '==', options.category));
  }

  if (options?.limitCount) {
    constraints.push(limit(options.limitCount));
  }

  const q = query(transactionsRef, ...constraints);

  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (error) {
    console.error('Failed to load user transactions:', {
      userId,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  const transactions: Transaction[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    const transaction = validateTransaction(data);
    if (transaction) {
      transactions.push(transaction);
    }
  });

  return transactions;
}

// Load demo transactions (access depends on Firestore security rules)
export async function loadDemoTransactions(options?: {
  limitCount?: number;
}): Promise<Transaction[]> {
  const db = getFirestoreDb();
  const collectionName = getTransactionsCollectionName();
  console.log(`Loading demo transactions from collection: ${collectionName}`);

  const transactionsRef = collection(db, collectionName);

  const constraints: QueryConstraint[] = [orderBy('date', 'desc')];

  if (options?.limitCount) {
    constraints.push(limit(options.limitCount));
  }

  const q = query(transactionsRef, ...constraints);

  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (error) {
    console.error('Failed to load demo transactions:', {
      collection: collectionName,
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load demo transactions from ${collectionName}: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  const transactions: Transaction[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    const transaction = validateTransaction(data);
    if (transaction) {
      transactions.push(transaction);
    }
  });

  console.log(`Loaded ${transactions.length} demo transactions from ${collectionName}`);
  return transactions;
}

// Load statements for a user
export async function loadUserStatements(userId: string): Promise<Statement[]> {
  const db = getFirestoreDb();
  const statementsRef = collection(db, getStatementsCollectionName());

  const q = query(statementsRef, where('userId', '==', userId), orderBy('startDate', 'desc'));

  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (error) {
    console.error('Failed to load user statements:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load statements: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  const statements: Statement[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    statements.push({
      id: data.id,
      userId: data.userId,
      accountId: data.accountId,
      startDate: data.startDate,
      endDate: data.endDate,
      transactionIds: data.transactionIds || [],
      createdAt: data.createdAt?.toDate(),
    });
  });

  return statements;
}

// Load accounts for a user
export async function loadUserAccounts(userId: string): Promise<Account[]> {
  const db = getFirestoreDb();
  const accountsRef = collection(db, getAccountsCollectionName());

  const q = query(accountsRef, where('userId', '==', userId));

  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (error) {
    console.error('Failed to load user accounts:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load accounts: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  const accounts: Account[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    accounts.push({
      id: data.id,
      userId: data.userId,
      institutionId: data.institutionId,
      name: data.name,
      type: data.type,
      createdAt: data.createdAt?.toDate(),
    });
  });

  return accounts;
}

// Load institutions for a user
export async function loadUserInstitutions(userId: string): Promise<Institution[]> {
  const db = getFirestoreDb();
  const institutionsRef = collection(db, getInstitutionsCollectionName());

  const q = query(institutionsRef, where('userId', '==', userId));

  let querySnapshot;
  try {
    querySnapshot = await getDocs(q);
  } catch (error) {
    console.error('Failed to load user institutions:', {
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load institutions: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }

  const institutions: Institution[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    institutions.push({
      id: data.id,
      userId: data.userId,
      name: data.name,
      createdAt: data.createdAt?.toDate(),
    });
  });

  return institutions;
}

/**
 * Get diagnostic information about Firestore configuration
 * Useful for debugging collection name issues
 */
export function getFirestoreDebugInfo(): {
  collections: {
    transactions: string;
    statements: string;
    accounts: string;
    institutions: string;
  };
  emulatorMode: boolean;
  prNumber: string | undefined;
  branchName: string | undefined;
} {
  return {
    collections: {
      transactions: getTransactionsCollectionName(),
      statements: getStatementsCollectionName(),
      accounts: getAccountsCollectionName(),
      institutions: getInstitutionsCollectionName(),
    },
    emulatorMode: import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true',
    prNumber: import.meta.env.VITE_PR_NUMBER,
    branchName: import.meta.env.VITE_BRANCH_NAME,
  };
}
