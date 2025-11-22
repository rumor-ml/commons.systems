#!/usr/bin/env node
/**
 * Seed Firestore with sample finance data
 *
 * Usage: node seed-firestore.js
 *
 * Requires GOOGLE_APPLICATION_CREDENTIALS environment variable
 * or GOOGLE_APPLICATION_CREDENTIALS_JSON for JSON credentials
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';

// Initialize Firebase Admin
let serviceAccount;

if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  // Parse credentials from JSON string (used in CI/CD)
  serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
} else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  // Load from file path
  serviceAccount = JSON.parse(
    readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8')
  );
} else {
  console.error('Error: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_APPLICATION_CREDENTIALS_JSON not set');
  process.exit(1);
}

initializeApp({
  credential: cert(serviceAccount),
  projectId: serviceAccount.project_id
});

const db = getFirestore();

// Sample accounts
const accounts = [
  {
    id: 'chase-checking',
    name: 'Chase Checking',
    type: 'checking',
    institution: 'Chase Bank',
    balance: 5420.50
  },
  {
    id: 'ally-savings',
    name: 'Ally Savings',
    type: 'savings',
    institution: 'Ally Bank',
    balance: 12850.00
  },
  {
    id: 'amex-blue',
    name: 'Amex Blue Cash',
    type: 'credit_card',
    institution: 'American Express',
    balance: -1240.75
  },
  {
    id: 'vanguard-401k',
    name: 'Vanguard 401(k)',
    type: 'retirement',
    institution: 'Vanguard',
    balance: 45600.00
  }
];

// Generate sample transactions for the last 3 months
function generateTransactions() {
  const transactions = [];
  const now = new Date();
  const accountIds = accounts.map(a => a.id);

  // Transaction templates
  const expenseTemplates = [
    { description: 'Whole Foods Market', category: 'Food & Dining', amount: -85.42, accountId: 'amex-blue' },
    { description: 'Shell Gas Station', category: 'Transportation', amount: -52.30, accountId: 'chase-checking' },
    { description: 'Netflix Subscription', category: 'Entertainment', amount: -15.99, accountId: 'chase-checking' },
    { description: 'Electric Bill - PG&E', category: 'Utilities', amount: -120.50, accountId: 'chase-checking' },
    { description: 'Target', category: 'Shopping', amount: -67.89, accountId: 'amex-blue' },
    { description: 'Starbucks', category: 'Food & Dining', amount: -6.25, accountId: 'amex-blue' },
    { description: 'Rent Payment', category: 'Housing', amount: -1800.00, accountId: 'chase-checking' },
    { description: 'Internet Bill - Comcast', category: 'Utilities', amount: -79.99, accountId: 'chase-checking' },
    { description: 'Amazon Prime', category: 'Shopping', amount: -139.00, accountId: 'amex-blue' },
    { description: 'Gym Membership', category: 'Personal Care', amount: -45.00, accountId: 'chase-checking' },
    { description: 'CVS Pharmacy', category: 'Healthcare', amount: -32.50, accountId: 'chase-checking' },
    { description: 'Chipotle', category: 'Food & Dining', amount: -12.75, accountId: 'amex-blue' },
    { description: 'Uber', category: 'Transportation', amount: -18.50, accountId: 'chase-checking' },
    { description: 'Apple Music', category: 'Entertainment', amount: -10.99, accountId: 'chase-checking' },
    { description: 'Trader Joes', category: 'Food & Dining', amount: -95.30, accountId: 'amex-blue' }
  ];

  const incomeTemplates = [
    { description: 'Salary Deposit', category: 'Salary', amount: 4200.00, accountId: 'chase-checking' },
    { description: 'Freelance Project', category: 'Freelance', amount: 850.00, accountId: 'chase-checking' }
  ];

  // Generate transactions for last 3 months
  for (let monthOffset = 0; monthOffset < 3; monthOffset++) {
    const month = new Date(now.getFullYear(), now.getMonth() - monthOffset, 1);

    // Add monthly salary
    const salaryDate = new Date(month.getFullYear(), month.getMonth(), 1);
    transactions.push({
      ...incomeTemplates[0],
      date: Timestamp.fromDate(salaryDate),
      type: 'income'
    });

    // Add random freelance income (50% chance)
    if (Math.random() > 0.5) {
      const freelanceDate = new Date(month.getFullYear(), month.getMonth(), 15);
      transactions.push({
        ...incomeTemplates[1],
        date: Timestamp.fromDate(freelanceDate),
        type: 'income'
      });
    }

    // Add rent on the 1st
    transactions.push({
      ...expenseTemplates[6], // Rent
      date: Timestamp.fromDate(new Date(month.getFullYear(), month.getMonth(), 1)),
      type: 'expense'
    });

    // Add recurring bills
    transactions.push({
      ...expenseTemplates[3], // Electric
      date: Timestamp.fromDate(new Date(month.getFullYear(), month.getMonth(), 5)),
      type: 'expense'
    });
    transactions.push({
      ...expenseTemplates[7], // Internet
      date: Timestamp.fromDate(new Date(month.getFullYear(), month.getMonth(), 10)),
      type: 'expense'
    });

    // Add random expenses throughout the month
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    const numExpenses = Math.floor(Math.random() * 15) + 20; // 20-35 expenses per month

    for (let i = 0; i < numExpenses; i++) {
      const randomDay = Math.floor(Math.random() * daysInMonth) + 1;
      const randomExpense = expenseTemplates[Math.floor(Math.random() * expenseTemplates.length)];

      // Add some variation to the amount
      const variation = 0.8 + Math.random() * 0.4; // 80% to 120% of base amount
      const amount = Math.round(randomExpense.amount * variation * 100) / 100;

      transactions.push({
        ...randomExpense,
        amount,
        date: Timestamp.fromDate(new Date(month.getFullYear(), month.getMonth(), randomDay)),
        type: 'expense'
      });
    }
  }

  return transactions;
}

console.log('\n📦 Seeding Firestore with sample finance data\n');

// Seed data
async function seedFinanceData() {
  try {
    // Seed accounts
    console.log('Creating accounts...');
    const accountsCollection = db.collection('finance_accounts');

    for (const account of accounts) {
      const { id, ...accountData } = account;
      await accountsCollection.doc(id).set({
        ...accountData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      console.log(`  ✓ Created account: ${account.name} ($${account.balance.toFixed(2)})`);
    }

    // Seed transactions
    console.log('\nCreating transactions...');
    const transactions = generateTransactions();
    const transactionsCollection = db.collection('finance_transactions');

    // Use batched writes for better performance
    const batchSize = 500;
    for (let i = 0; i < transactions.length; i += batchSize) {
      const batch = db.batch();
      const batchTransactions = transactions.slice(i, i + batchSize);

      for (const transaction of batchTransactions) {
        const docRef = transactionsCollection.doc();
        batch.set(docRef, {
          ...transaction,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }

      await batch.commit();
      console.log(`  ✓ Created ${batchTransactions.length} transactions (batch ${Math.floor(i / batchSize) + 1})`);
    }

    console.log(`\n✅ Seeding complete!`);
    console.log(`   Accounts: ${accounts.length}`);
    console.log(`   Transactions: ${transactions.length}`);
    console.log('\n💡 You can now view your finance tracker at the deployed URL\n');

  } catch (error) {
    console.error('\n❌ Error seeding data:', error);
    process.exit(1);
  }
}

// Run seeding
seedFinanceData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
