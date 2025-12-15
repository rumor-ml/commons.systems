import { Transaction, Category } from '../islands/types';
import { BudgetState } from './state';

// Category definitions (must match types.ts)
const CATEGORIES: Category[] = [
  'income',
  'housing',
  'utilities',
  'groceries',
  'dining',
  'transportation',
  'healthcare',
  'entertainment',
  'shopping',
  'travel',
  'investment',
  'other',
];

const CATEGORY_LABELS: Record<Category, string> = {
  income: 'Income',
  housing: 'Housing',
  utilities: 'Utilities',
  groceries: 'Groceries',
  dining: 'Dining',
  transportation: 'Transportation',
  healthcare: 'Healthcare',
  entertainment: 'Entertainment',
  shopping: 'Shopping',
  travel: 'Travel',
  investment: 'Investment',
  other: 'Other',
};

interface SummaryStats {
  totalIncome: number;
  totalExpenses: number;
  netIncome: number;
  savingsRate: number;
}

export function filterTransactions(
  transactions: Transaction[],
  state: BudgetState
): Transaction[] {
  const hiddenSet = new Set(state.hiddenCategories);

  return transactions.filter((txn) => {
    // Always exclude transfers
    if (txn.transfer) return false;

    // Filter by vacation
    if (!state.showVacation && txn.vacation) return false;

    // Filter by hidden categories
    if (hiddenSet.has(txn.category)) return false;

    return true;
  });
}

export function calculateSummary(transactions: Transaction[]): SummaryStats {
  let totalIncome = 0;
  let totalExpenses = 0;

  transactions.forEach((txn) => {
    const displayAmount = txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;

    if (displayAmount > 0) {
      totalIncome += displayAmount;
    } else {
      totalExpenses += Math.abs(displayAmount);
    }
  });

  const netIncome = totalIncome - totalExpenses;
  const savingsRate = totalIncome > 0 ? (netIncome / totalIncome) * 100 : 0;

  return {
    totalIncome,
    totalExpenses,
    netIncome,
    savingsRate,
  };
}

export function formatCurrency(value: number): string {
  return `$${value.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function renderSummaryCards(transactions: Transaction[], state: BudgetState): void {
  const container = document.getElementById('summary-cards');
  if (!container) return;

  const filtered = filterTransactions(transactions, state);
  const summary = calculateSummary(filtered);

  // Create grid container
  const grid = document.createElement('div');
  grid.className = 'summary-cards';

  // Helper function to create a card using safe DOM methods
  const createCard = (label: string, value: string, colorClass: string) => {
    const card = document.createElement('div');
    card.className = 'summary-card';

    const labelEl = document.createElement('div');
    labelEl.className = 'summary-label';
    labelEl.textContent = label;

    const valueEl = document.createElement('div');
    valueEl.className = `summary-value ${colorClass}`;
    valueEl.textContent = value;

    card.appendChild(labelEl);
    card.appendChild(valueEl);
    return card;
  };

  grid.appendChild(
    createCard('Total Income', formatCurrency(summary.totalIncome), 'positive')
  );
  grid.appendChild(
    createCard('Total Expenses', formatCurrency(summary.totalExpenses), 'negative')
  );
  grid.appendChild(
    createCard(
      'Net Income',
      formatCurrency(summary.netIncome),
      summary.netIncome >= 0 ? 'positive' : 'negative'
    )
  );
  grid.appendChild(
    createCard(
      'Savings Rate',
      `${summary.savingsRate.toFixed(1)}%`,
      summary.savingsRate >= 20 ? 'positive' : 'neutral'
    )
  );

  // Replace all children safely
  container.replaceChildren(grid);
}

