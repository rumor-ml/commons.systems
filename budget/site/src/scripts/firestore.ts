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
} from 'firebase/firestore';
import {
  getTransactionsCollectionName,
  getStatementsCollectionName,
  getAccountsCollectionName,
  getInstitutionsCollectionName,
} from './collection-names';

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
  date: string; // ISO format YYYY-MM-DD
  description: string;
  amount: number; // Positive = income, Negative = expense
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

// Account interface
export interface Account {
  id: string;
  userId: string;
  institutionId: string;
  name: string;
  type: string; // 'checking' | 'savings' | 'credit' | 'investment'
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
  const transactionsRef = collection(db, 'budget-transactions');

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
  const querySnapshot = await getDocs(q);

  const transactions: Transaction[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    transactions.push({
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
    });
  });

  return transactions;
}

// Load demo transactions (publicly available)
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
  const querySnapshot = await getDocs(q);

  const transactions: Transaction[] = [];
  querySnapshot.forEach((doc) => {
    const data = doc.data();
    transactions.push({
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
    });
  });

  return transactions;
}

// Load statements for a user
export async function loadUserStatements(userId: string): Promise<Statement[]> {
  const db = getFirestoreDb();
  const statementsRef = collection(db, getStatementsCollectionName());

  const q = query(statementsRef, where('userId', '==', userId), orderBy('startDate', 'desc'));

  const querySnapshot = await getDocs(q);

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

  const querySnapshot = await getDocs(q);

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

  const querySnapshot = await getDocs(q);

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
