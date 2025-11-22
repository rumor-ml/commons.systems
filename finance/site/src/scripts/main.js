/**
 * Finance Tracker - Main Application
 */

import {
  getAllAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAllTransactions,
  createTransaction,
  updateTransaction,
  deleteTransaction,
  getBudgetSummary,
  CATEGORIES,
  isFirebaseConfigured
} from './firebase.js';

/**
 * State
 */
let accounts = [];
let transactions = [];
let currentView = 'dashboard';
let filters = {
  search: '',
  category: '',
  account: '',
  month: ''
};

/**
 * DOM Elements
 */
const navButtons = document.querySelectorAll('.nav-btn');
const views = document.querySelectorAll('.view');

// Dashboard
const accountSummaryEl = document.getElementById('account-summary');
const recentTransactionsEl = document.getElementById('recent-transactions');
const budgetOverviewEl = document.getElementById('budget-overview');

// Transactions
const addTransactionBtn = document.getElementById('add-transaction-btn');
const allTransactionsEl = document.getElementById('all-transactions');
const transactionSearchInput = document.getElementById('transaction-search');
const categoryFilterSelect = document.getElementById('category-filter');
const accountFilterSelect = document.getElementById('account-filter');
const monthFilterInput = document.getElementById('month-filter');

// Accounts
const addAccountBtn = document.getElementById('add-account-btn');
const accountsListEl = document.getElementById('accounts-list');

// Budget
const budgetDetailsEl = document.getElementById('budget-details');

// Modals
const transactionModal = document.getElementById('transaction-modal');
const transactionForm = document.getElementById('transaction-form');
const transactionModalTitle = document.getElementById('transaction-modal-title');
const cancelTransactionBtn = document.getElementById('cancel-transaction-btn');

const accountModal = document.getElementById('account-modal');
const accountForm = document.getElementById('account-form');
const accountModalTitle = document.getElementById('account-modal-title');
const cancelAccountBtn = document.getElementById('cancel-account-btn');

/**
 * Utility Functions
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(amount);
}

function formatDate(date) {
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

function formatDateInput(date) {
  const d = new Date(date);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${year}-${month}-${day}`;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Navigation
 */
function switchView(viewName) {
  currentView = viewName;

  // Update nav buttons
  navButtons.forEach(btn => {
    if (btn.dataset.view === viewName) {
      btn.classList.add('nav-btn--active');
    } else {
      btn.classList.remove('nav-btn--active');
    }
  });

  // Update views
  views.forEach(view => {
    if (view.id === `${viewName}-view`) {
      view.classList.add('view--active');
    } else {
      view.classList.remove('view--active');
    }
  });

  // Load data for the view
  if (viewName === 'dashboard') {
    loadDashboard();
  } else if (viewName === 'transactions') {
    loadTransactionsView();
  } else if (viewName === 'accounts') {
    loadAccountsView();
  } else if (viewName === 'budget') {
    loadBudgetView();
  }
}

/**
 * Dashboard View
 */
async function loadDashboard() {
  // Check if Firebase is configured
  if (!isFirebaseConfigured) {
    showFirebaseConfigError();
    return;
  }

  try {
    // Load accounts
    accounts = await getAllAccounts();
    renderAccountSummary();

    // Load recent transactions
    transactions = await getAllTransactions({ limit: 10 });
    renderRecentTransactions();

    // Load budget overview
    const now = new Date();
    const budget = await getBudgetSummary(now.getFullYear(), now.getMonth() + 1);
    renderBudgetOverview(budget);
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showFirebaseConnectionError(error);
  }
}

/**
 * Show Firebase configuration error
 */
function showFirebaseConfigError() {
  const errorMessage = `
    <div class="error">
      <div class="error__title">⚠️ Firebase Not Configured</div>
      <div class="error__message">
        <p>The Finance Tracker requires Firebase/Firestore to store your financial data.</p>
        <p><strong>For local development:</strong></p>
        <ul>
          <li>Get your Firebase config from <a href="https://console.firebase.google.com/" target="_blank">Firebase Console</a></li>
          <li>Update <code>finance/site/src/firebase-config.js</code> with your project credentials</li>
        </ul>
        <p><strong>For production:</strong></p>
        <ul>
          <li>Firebase configuration is automatically injected during deployment</li>
          <li>If you're seeing this in production, the deployment may have failed</li>
        </ul>
      </div>
    </div>
  `;

  accountSummaryEl.innerHTML = errorMessage;
  recentTransactionsEl.innerHTML = '<div class="error"><div class="error__title">Firebase not configured</div></div>';
  budgetOverviewEl.innerHTML = '<div class="error"><div class="error__title">Firebase not configured</div></div>';
}

/**
 * Show Firebase connection error
 */
function showFirebaseConnectionError(error) {
  const isDummyConfig = error.message?.includes('API key not valid') ||
                       error.code === 'auth/invalid-api-key';

  const errorMessage = isDummyConfig ? `
    <div class="error">
      <div class="error__title">⚠️ Invalid Firebase API Key</div>
      <div class="error__message">
        <p>The Firebase API key appears to be invalid or not configured.</p>
        <p>This usually means the deployment process didn't inject the real Firebase credentials.</p>
        <p><strong>Error:</strong> ${escapeHtml(error.message || 'Unknown error')}</p>
      </div>
    </div>
  ` : `
    <div class="error">
      <div class="error__title">❌ Failed to Load Data</div>
      <div class="error__message">
        <p>Could not connect to Firebase/Firestore.</p>
        <p><strong>Error:</strong> ${escapeHtml(error.message || 'Unknown error')}</p>
        <p>Check your browser console for more details.</p>
      </div>
    </div>
  `;

  accountSummaryEl.innerHTML = errorMessage;
  recentTransactionsEl.innerHTML = '<div class="error"><div class="error__title">Connection failed</div></div>';
  budgetOverviewEl.innerHTML = '<div class="error"><div class="error__title">Connection failed</div></div>';
}

function renderAccountSummary() {
  if (accounts.length === 0) {
    accountSummaryEl.innerHTML = '<div class="empty-state">No accounts yet. Add your first account!</div>';
    return;
  }

  const totalBalance = accounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);

  accountSummaryEl.innerHTML = `
    <div class="summary-total">
      <div class="summary-total__label">Total Balance</div>
      <div class="summary-total__amount">${formatCurrency(totalBalance)}</div>
    </div>
    <div class="account-cards">
      ${accounts.map(acc => `
        <div class="account-card">
          <div class="account-card__name">${escapeHtml(acc.name)}</div>
          <div class="account-card__type">${escapeHtml(acc.type)}</div>
          <div class="account-card__balance">${formatCurrency(acc.balance || 0)}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderRecentTransactions() {
  if (transactions.length === 0) {
    recentTransactionsEl.innerHTML = '<div class="empty-state">No transactions yet. Add your first transaction!</div>';
    return;
  }

  recentTransactionsEl.innerHTML = transactions.slice(0, 5).map(transaction => {
    const account = accounts.find(a => a.id === transaction.accountId);
    const amountClass = transaction.type === 'income' ? 'transaction-item__amount--income' : 'transaction-item__amount--expense';
    const amountSign = transaction.type === 'income' ? '+' : '-';

    return `
      <div class="transaction-item">
        <div class="transaction-item__date">${formatDate(transaction.date)}</div>
        <div class="transaction-item__description">
          <div class="transaction-item__name">${escapeHtml(transaction.description)}</div>
          <div class="transaction-item__meta">${escapeHtml(transaction.category)} • ${escapeHtml(account?.name || 'Unknown')}</div>
        </div>
        <div class="transaction-item__amount ${amountClass}">${amountSign}${formatCurrency(Math.abs(transaction.amount))}</div>
      </div>
    `;
  }).join('');
}

function renderBudgetOverview(budget) {
  budgetOverviewEl.innerHTML = `
    <div class="budget-summary">
      <div class="budget-summary__item budget-summary__item--income">
        <div class="budget-summary__label">Income</div>
        <div class="budget-summary__amount">${formatCurrency(budget.income)}</div>
      </div>
      <div class="budget-summary__item budget-summary__item--expense">
        <div class="budget-summary__label">Expenses</div>
        <div class="budget-summary__amount">${formatCurrency(budget.expenses)}</div>
      </div>
      <div class="budget-summary__item budget-summary__item--net">
        <div class="budget-summary__label">Net</div>
        <div class="budget-summary__amount">${formatCurrency(budget.net)}</div>
      </div>
    </div>
  `;
}

/**
 * Transactions View
 */
async function loadTransactionsView() {
  try {
    // Load all data
    accounts = await getAllAccounts();
    transactions = await getAllTransactions();

    // Populate filters
    populateFilters();

    // Render transactions
    renderAllTransactions();
  } catch (error) {
    console.error('Error loading transactions:', error);
    showError('Failed to load transactions');
  }
}

function populateFilters() {
  // Populate category filter
  categoryFilterSelect.innerHTML = '<option value="">All Categories</option>';
  [...CATEGORIES.INCOME, ...CATEGORIES.EXPENSE].forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categoryFilterSelect.appendChild(option);
  });

  // Populate account filter
  accountFilterSelect.innerHTML = '<option value="">All Accounts</option>';
  accounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.name;
    accountFilterSelect.appendChild(option);
  });

  // Set current month as default
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  monthFilterInput.value = currentMonth;
}

function filterTransactions() {
  let filtered = [...transactions];

  // Search filter
  if (filters.search) {
    const search = filters.search.toLowerCase();
    filtered = filtered.filter(t =>
      t.description.toLowerCase().includes(search) ||
      t.category.toLowerCase().includes(search)
    );
  }

  // Category filter
  if (filters.category) {
    filtered = filtered.filter(t => t.category === filters.category);
  }

  // Account filter
  if (filters.account) {
    filtered = filtered.filter(t => t.accountId === filters.account);
  }

  // Month filter
  if (filters.month) {
    const [year, month] = filters.month.split('-').map(Number);
    filtered = filtered.filter(t => {
      const date = new Date(t.date);
      return date.getFullYear() === year && date.getMonth() + 1 === month;
    });
  }

  return filtered;
}

function renderAllTransactions() {
  const filtered = filterTransactions();

  if (filtered.length === 0) {
    allTransactionsEl.innerHTML = '<div class="empty-state">No transactions found</div>';
    return;
  }

  allTransactionsEl.innerHTML = filtered.map(transaction => {
    const account = accounts.find(a => a.id === transaction.accountId);
    const amountClass = transaction.type === 'income' ? 'transaction-item__amount--income' : 'transaction-item__amount--expense';
    const amountSign = transaction.type === 'income' ? '+' : '-';

    return `
      <div class="transaction-item" data-id="${transaction.id}">
        <div class="transaction-item__date">${formatDate(transaction.date)}</div>
        <div class="transaction-item__description">
          <div class="transaction-item__name">${escapeHtml(transaction.description)}</div>
          <div class="transaction-item__meta">${escapeHtml(transaction.category)} • ${escapeHtml(account?.name || 'Unknown')}</div>
        </div>
        <div class="transaction-item__amount ${amountClass}">${amountSign}${formatCurrency(Math.abs(transaction.amount))}</div>
        <div class="transaction-item__actions">
          <button class="btn-icon" onclick="window.editTransaction('${transaction.id}')">✎</button>
          <button class="btn-icon" onclick="window.deleteTransactionConfirm('${transaction.id}')">🗑</button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Accounts View
 */
async function loadAccountsView() {
  try {
    accounts = await getAllAccounts();
    renderAccountsList();
  } catch (error) {
    console.error('Error loading accounts:', error);
    showError('Failed to load accounts');
  }
}

function renderAccountsList() {
  if (accounts.length === 0) {
    accountsListEl.innerHTML = '<div class="empty-state">No accounts yet. Add your first account!</div>';
    return;
  }

  accountsListEl.innerHTML = accounts.map(account => `
    <div class="account-list-item" data-id="${account.id}">
      <div class="account-list-item__info">
        <div class="account-list-item__name">${escapeHtml(account.name)}</div>
        <div class="account-list-item__meta">${escapeHtml(account.type)} • ${escapeHtml(account.institution)}</div>
      </div>
      <div class="account-list-item__balance">${formatCurrency(account.balance || 0)}</div>
      <div class="account-list-item__actions">
        <button class="btn-icon" onclick="window.editAccount('${account.id}')">✎</button>
        <button class="btn-icon" onclick="window.deleteAccountConfirm('${account.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

/**
 * Budget View
 */
async function loadBudgetView() {
  try {
    const now = new Date();
    const budget = await getBudgetSummary(now.getFullYear(), now.getMonth() + 1);
    renderBudgetDetails(budget);
  } catch (error) {
    console.error('Error loading budget:', error);
    showError('Failed to load budget');
  }
}

function renderBudgetDetails(budget) {
  const categories = Object.entries(budget.byCategory)
    .sort((a, b) => b[1] - a[1]);

  budgetDetailsEl.innerHTML = `
    <div class="budget-summary budget-summary--large">
      <div class="budget-summary__item budget-summary__item--income">
        <div class="budget-summary__label">Income</div>
        <div class="budget-summary__amount">${formatCurrency(budget.income)}</div>
      </div>
      <div class="budget-summary__item budget-summary__item--expense">
        <div class="budget-summary__label">Expenses</div>
        <div class="budget-summary__amount">${formatCurrency(budget.expenses)}</div>
      </div>
      <div class="budget-summary__item budget-summary__item--net">
        <div class="budget-summary__label">Net</div>
        <div class="budget-summary__amount">${formatCurrency(budget.net)}</div>
      </div>
    </div>

    <h3>Expenses by Category</h3>
    <div class="category-breakdown">
      ${categories.length === 0 ? '<div class="empty-state">No expenses this month</div>' : categories.map(([category, amount]) => {
        const percentage = budget.expenses > 0 ? (amount / budget.expenses * 100).toFixed(1) : 0;
        return `
          <div class="category-item">
            <div class="category-item__header">
              <div class="category-item__name">${escapeHtml(category)}</div>
              <div class="category-item__amount">${formatCurrency(amount)}</div>
            </div>
            <div class="category-item__bar">
              <div class="category-item__bar-fill" style="width: ${percentage}%"></div>
            </div>
            <div class="category-item__percentage">${percentage}%</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/**
 * Transaction Modal
 */
function openTransactionModal(transactionId = null) {
  if (transactionId) {
    // Edit mode
    const transaction = transactions.find(t => t.id === transactionId);
    if (!transaction) return;

    transactionModalTitle.textContent = 'Edit Transaction';
    document.getElementById('transaction-id').value = transaction.id;
    document.getElementById('transaction-date').value = formatDateInput(transaction.date);
    document.getElementById('transaction-amount').value = Math.abs(transaction.amount);
    document.getElementById('transaction-description').value = transaction.description;
    document.getElementById('transaction-category').value = transaction.category;
    document.getElementById('transaction-account').value = transaction.accountId;
    document.getElementById('transaction-type').value = transaction.type;
  } else {
    // Add mode
    transactionModalTitle.textContent = 'Add Transaction';
    transactionForm.reset();
    document.getElementById('transaction-date').value = formatDateInput(new Date());
  }

  // Populate dropdowns
  populateTransactionForm();

  transactionModal.style.display = 'flex';
}

function closeTransactionModal() {
  transactionModal.style.display = 'none';
  transactionForm.reset();
}

function populateTransactionForm() {
  const categorySelect = document.getElementById('transaction-category');
  const accountSelect = document.getElementById('transaction-account');

  // Populate categories
  categorySelect.innerHTML = '<option value="">Select category...</option>';
  [...CATEGORIES.INCOME, ...CATEGORIES.EXPENSE].forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category;
    categorySelect.appendChild(option);
  });

  // Populate accounts
  accountSelect.innerHTML = '<option value="">Select account...</option>';
  accounts.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.name;
    accountSelect.appendChild(option);
  });
}

async function saveTransaction(e) {
  e.preventDefault();

  const transactionId = document.getElementById('transaction-id').value;
  const transactionData = {
    date: document.getElementById('transaction-date').value,
    amount: parseFloat(document.getElementById('transaction-amount').value),
    description: document.getElementById('transaction-description').value,
    category: document.getElementById('transaction-category').value,
    accountId: document.getElementById('transaction-account').value,
    type: document.getElementById('transaction-type').value
  };

  try {
    if (transactionId) {
      await updateTransaction(transactionId, transactionData);
    } else {
      await createTransaction(transactionData);
    }

    closeTransactionModal();

    // Reload current view
    if (currentView === 'dashboard') {
      loadDashboard();
    } else if (currentView === 'transactions') {
      loadTransactionsView();
    }
  } catch (error) {
    console.error('Error saving transaction:', error);
    showError('Failed to save transaction');
  }
}

/**
 * Account Modal
 */
function openAccountModal(accountId = null) {
  if (accountId) {
    // Edit mode
    const account = accounts.find(a => a.id === accountId);
    if (!account) return;

    accountModalTitle.textContent = 'Edit Account';
    document.getElementById('account-id').value = account.id;
    document.getElementById('account-name').value = account.name;
    document.getElementById('account-type').value = account.type;
    document.getElementById('account-institution').value = account.institution;
    document.getElementById('account-balance').value = account.balance;
  } else {
    // Add mode
    accountModalTitle.textContent = 'Add Account';
    accountForm.reset();
  }

  accountModal.style.display = 'flex';
}

function closeAccountModal() {
  accountModal.style.display = 'none';
  accountForm.reset();
}

async function saveAccount(e) {
  e.preventDefault();

  const accountId = document.getElementById('account-id').value;
  const accountData = {
    name: document.getElementById('account-name').value,
    type: document.getElementById('account-type').value,
    institution: document.getElementById('account-institution').value,
    balance: parseFloat(document.getElementById('account-balance').value)
  };

  try {
    if (accountId) {
      await updateAccount(accountId, accountData);
    } else {
      await createAccount(accountData);
    }

    closeAccountModal();

    // Reload current view
    if (currentView === 'dashboard') {
      loadDashboard();
    } else if (currentView === 'accounts') {
      loadAccountsView();
    }
  } catch (error) {
    console.error('Error saving account:', error);
    showError('Failed to save account');
  }
}

/**
 * Delete Functions
 */
window.deleteTransactionConfirm = async function(transactionId) {
  if (!confirm('Are you sure you want to delete this transaction?')) return;

  try {
    await deleteTransaction(transactionId);

    // Reload current view
    if (currentView === 'dashboard') {
      loadDashboard();
    } else if (currentView === 'transactions') {
      loadTransactionsView();
    }
  } catch (error) {
    console.error('Error deleting transaction:', error);
    showError('Failed to delete transaction');
  }
};

window.deleteAccountConfirm = async function(accountId) {
  if (!confirm('Are you sure you want to delete this account?')) return;

  try {
    await deleteAccount(accountId);

    // Reload current view
    if (currentView === 'dashboard') {
      loadDashboard();
    } else if (currentView === 'accounts') {
      loadAccountsView();
    }
  } catch (error) {
    console.error('Error deleting account:', error);
    showError('Failed to delete account');
  }
};

window.editTransaction = function(transactionId) {
  openTransactionModal(transactionId);
};

window.editAccount = function(accountId) {
  openAccountModal(accountId);
};

/**
 * Error Handling
 */
function showError(message) {
  alert(message); // Simple error display for now
}

/**
 * Event Listeners
 */
function setupEventListeners() {
  // Navigation
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });

  // Transaction modal
  addTransactionBtn.addEventListener('click', () => openTransactionModal());
  cancelTransactionBtn.addEventListener('click', closeTransactionModal);
  transactionForm.addEventListener('submit', saveTransaction);
  transactionModal.querySelector('.modal__close').addEventListener('click', closeTransactionModal);

  // Account modal
  addAccountBtn.addEventListener('click', () => openAccountModal());
  cancelAccountBtn.addEventListener('click', closeAccountModal);
  accountForm.addEventListener('submit', saveAccount);
  accountModal.querySelector('.modal__close').addEventListener('click', closeAccountModal);

  // Filters
  transactionSearchInput.addEventListener('input', (e) => {
    filters.search = e.target.value;
    renderAllTransactions();
  });

  categoryFilterSelect.addEventListener('change', (e) => {
    filters.category = e.target.value;
    renderAllTransactions();
  });

  accountFilterSelect.addEventListener('change', (e) => {
    filters.account = e.target.value;
    renderAllTransactions();
  });

  monthFilterInput.addEventListener('change', (e) => {
    filters.month = e.target.value;
    renderAllTransactions();
  });

  // Close modals on outside click
  transactionModal.addEventListener('click', (e) => {
    if (e.target === transactionModal) closeTransactionModal();
  });

  accountModal.addEventListener('click', (e) => {
    if (e.target === accountModal) closeAccountModal();
  });
}

/**
 * Initialize
 */
async function init() {
  setupEventListeners();
  await loadDashboard();
}

// Start the application
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
