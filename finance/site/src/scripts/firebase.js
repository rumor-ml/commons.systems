/**
 * Firebase and Firestore operations for Finance Tracker
 */

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  query,
  orderBy,
  where,
  limit,
  serverTimestamp,
  Timestamp
} from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config.js';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firestore
const db = getFirestore(app);

// Collection references
const accountsCollection = collection(db, 'finance_accounts');
const transactionsCollection = collection(db, 'finance_transactions');

/**
 * Expense categories (hardcoded for now)
 */
export const CATEGORIES = {
  INCOME: [
    'Salary',
    'Freelance',
    'Investment Income',
    'Other Income'
  ],
  EXPENSE: [
    'Housing',
    'Transportation',
    'Food & Dining',
    'Utilities',
    'Healthcare',
    'Insurance',
    'Entertainment',
    'Shopping',
    'Personal Care',
    'Education',
    'Savings',
    'Taxes',
    'Other'
  ]
};

/**
 * Account Operations
 */

// Get all accounts
export async function getAllAccounts() {
  try {
    const q = query(accountsCollection, orderBy('name', 'asc'));
    const querySnapshot = await getDocs(q);
    const accounts = [];
    querySnapshot.forEach((doc) => {
      accounts.push({
        id: doc.id,
        ...doc.data()
      });
    });
    return accounts;
  } catch (error) {
    console.error('Error getting accounts:', error);
    throw error;
  }
}

// Get a single account by ID
export async function getAccount(accountId) {
  try {
    const accountRef = doc(db, 'finance_accounts', accountId);
    const accountSnap = await getDoc(accountRef);
    if (accountSnap.exists()) {
      return {
        id: accountSnap.id,
        ...accountSnap.data()
      };
    } else {
      throw new Error('Account not found');
    }
  } catch (error) {
    console.error('Error getting account:', error);
    throw error;
  }
}

// Create a new account
export async function createAccount(accountData) {
  try {
    const docRef = await addDoc(accountsCollection, {
      name: accountData.name,
      type: accountData.type,
      institution: accountData.institution,
      balance: parseFloat(accountData.balance) || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating account:', error);
    throw error;
  }
}

// Update an existing account
export async function updateAccount(accountId, accountData) {
  try {
    const accountRef = doc(db, 'finance_accounts', accountId);
    await updateDoc(accountRef, {
      name: accountData.name,
      type: accountData.type,
      institution: accountData.institution,
      balance: parseFloat(accountData.balance) || 0,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating account:', error);
    throw error;
  }
}

// Delete an account
export async function deleteAccount(accountId) {
  try {
    const accountRef = doc(db, 'finance_accounts', accountId);
    await deleteDoc(accountRef);
  } catch (error) {
    console.error('Error deleting account:', error);
    throw error;
  }
}

/**
 * Transaction Operations
 */

// Get all transactions
export async function getAllTransactions(options = {}) {
  try {
    let q = query(transactionsCollection, orderBy('date', 'desc'));

    // Apply filters
    if (options.accountId) {
      q = query(transactionsCollection, where('accountId', '==', options.accountId), orderBy('date', 'desc'));
    }
    if (options.category) {
      q = query(transactionsCollection, where('category', '==', options.category), orderBy('date', 'desc'));
    }
    if (options.limit) {
      q = query(q, limit(options.limit));
    }

    const querySnapshot = await getDocs(q);
    const transactions = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        // Convert Firestore Timestamp to Date
        date: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      });
    });
    return transactions;
  } catch (error) {
    console.error('Error getting transactions:', error);
    throw error;
  }
}

// Get a single transaction by ID
export async function getTransaction(transactionId) {
  try {
    const transactionRef = doc(db, 'finance_transactions', transactionId);
    const transactionSnap = await getDoc(transactionRef);
    if (transactionSnap.exists()) {
      const data = transactionSnap.data();
      return {
        id: transactionSnap.id,
        ...data,
        date: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      };
    } else {
      throw new Error('Transaction not found');
    }
  } catch (error) {
    console.error('Error getting transaction:', error);
    throw error;
  }
}

// Create a new transaction
export async function createTransaction(transactionData) {
  try {
    const docRef = await addDoc(transactionsCollection, {
      date: Timestamp.fromDate(new Date(transactionData.date)),
      amount: parseFloat(transactionData.amount) || 0,
      description: transactionData.description,
      category: transactionData.category,
      accountId: transactionData.accountId,
      type: transactionData.type || 'expense',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    return docRef.id;
  } catch (error) {
    console.error('Error creating transaction:', error);
    throw error;
  }
}

// Update an existing transaction
export async function updateTransaction(transactionId, transactionData) {
  try {
    const transactionRef = doc(db, 'finance_transactions', transactionId);
    await updateDoc(transactionRef, {
      date: Timestamp.fromDate(new Date(transactionData.date)),
      amount: parseFloat(transactionData.amount) || 0,
      description: transactionData.description,
      category: transactionData.category,
      accountId: transactionData.accountId,
      type: transactionData.type || 'expense',
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    console.error('Error updating transaction:', error);
    throw error;
  }
}

// Delete a transaction
export async function deleteTransaction(transactionId) {
  try {
    const transactionRef = doc(db, 'finance_transactions', transactionId);
    await deleteDoc(transactionRef);
  } catch (error) {
    console.error('Error deleting transaction:', error);
    throw error;
  }
}

/**
 * Budget and Analytics Operations
 */

// Get transactions for a specific month
export async function getTransactionsByMonth(year, month) {
  try {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const q = query(
      transactionsCollection,
      where('date', '>=', Timestamp.fromDate(startDate)),
      where('date', '<=', Timestamp.fromDate(endDate)),
      orderBy('date', 'desc')
    );

    const querySnapshot = await getDocs(q);
    const transactions = [];
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      transactions.push({
        id: doc.id,
        ...data,
        date: data.date?.toDate ? data.date.toDate() : new Date(data.date)
      });
    });
    return transactions;
  } catch (error) {
    console.error('Error getting transactions by month:', error);
    throw error;
  }
}

// Calculate budget summary for a month
export async function getBudgetSummary(year, month) {
  try {
    const transactions = await getTransactionsByMonth(year, month);

    const summary = {
      income: 0,
      expenses: 0,
      byCategory: {}
    };

    transactions.forEach(transaction => {
      if (transaction.type === 'income') {
        summary.income += transaction.amount;
      } else if (transaction.type === 'expense') {
        summary.expenses += transaction.amount;

        if (!summary.byCategory[transaction.category]) {
          summary.byCategory[transaction.category] = 0;
        }
        summary.byCategory[transaction.category] += transaction.amount;
      }
    });

    summary.net = summary.income - summary.expenses;

    return summary;
  } catch (error) {
    console.error('Error calculating budget summary:', error);
    throw error;
  }
}

export { db };
