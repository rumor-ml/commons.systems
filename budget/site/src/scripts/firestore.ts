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

const missingVars = requiredEnvVars.filter(
  (key) => !import.meta.env[key] || import.meta.env[key] === ''
);

if (missingVars.length > 0) {
  const error = new Error(
    `Missing required Firebase environment variables: ${missingVars.join(', ')}. ` +
      'Check your .env file or deployment configuration.'
  );
  console.error(error);
  throw error;
}

// Firebase configuration from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Transaction interface matching Firestore schema
export interface Transaction {
  id: string;
  userId: string;
  date: string; // Date-only string in YYYY-MM-DD format (no time or timezone)
  description: string;
  amount: number; // Positive = income, Negative = expense (normalized after parsing)
  category: string;
  redeemable?: boolean;
  vacation?: boolean;
  transfer?: boolean;
  redemptionRate?: number;
  linkedTransactionId?: string;
  statementIds: string[];
  createdAt?: Date;
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

// Initialize Firebase
export function initFirebase(): FirebaseApp {
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
  }
  return firebaseApp;
}

// Get Firestore instance
export function getFirestoreDb(): Firestore {
  if (!firestoreDb) {
    const app = initFirebase();
    firestoreDb = getFirestore(app);
  }
  return firestoreDb;
}

// Map Firestore document data to Transaction object
function mapDocumentToTransaction(data: DocumentData): Transaction {
  return {
    id: data.id,
    userId: data.userId,
    date: data.date,
    description: data.description,
    amount: data.amount,
    category: data.category,
    redeemable: data.redeemable,
    vacation: data.vacation,
    transfer: data.transfer,
    redemptionRate: data.redemptionRate,
    linkedTransactionId: data.linkedTransactionId,
    statementIds: data.statementIds || [],
    createdAt: data.createdAt?.toDate(),
  };
}

// Validate Transaction data from Firestore
export function validateTransaction(data: any): Transaction | null {
  // Validate required fields
  if (!data.id || !data.userId || !data.date || !data.description) {
    console.warn('Transaction missing required fields:', {
      hasId: !!data.id,
      hasUserId: !!data.userId,
      hasDate: !!data.date,
      hasDescription: !!data.description,
    });
    return null;
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
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
  const transactionsRef = collection(db, getTransactionsCollectionName());

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
      options,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to load demo transactions: ${error instanceof Error ? error.message : 'Unknown error'}`
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
