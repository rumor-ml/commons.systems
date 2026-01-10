import { QualifierBreakdown, Transaction } from './types';

/**
 * Update qualifier breakdown with transaction data.
 * Tracks redeemable/nonRedeemable, vacation/nonVacation, and transaction count.
 *
 * This shared helper eliminates duplicate logic between BudgetChart.tsx monthly aggregation
 * and weeklyAggregation.ts weekly aggregation.
 */
export function updateQualifierBreakdown(
  qualifiers: QualifierBreakdown,
  txn: Transaction,
  displayAmount: number
): void {
  // Validate displayAmount is finite before accumulating
  if (!Number.isFinite(displayAmount)) {
    console.error('Invalid displayAmount in qualifier breakdown:', { txn, displayAmount });
    return; // Skip this transaction
  }

  if (txn.redeemable) {
    qualifiers.redeemable += displayAmount;
  } else {
    qualifiers.nonRedeemable += displayAmount;
  }

  if (txn.vacation) {
    qualifiers.vacation += displayAmount;
  } else {
    qualifiers.nonVacation += displayAmount;
  }

  qualifiers.transactionCount++;
}

/**
 * Filter transactions by removing transfers and applying category/vacation filters.
 * Consolidates duplicate filtering logic from BudgetChart.tsx, weeklyAggregation.ts, and Legend.tsx.
 */
export function filterTransactions(
  transactions: Transaction[],
  options: { hiddenCategories: Set<string>; showVacation: boolean }
): Transaction[] {
  return transactions.filter((txn) => {
    if (txn.transfer) return false;
    if (!options.showVacation && txn.vacation) return false;
    if (options.hiddenCategories.has(txn.category)) return false;
    return true;
  });
}

/**
 * Calculate display amount for a transaction, applying redemption rate if redeemable.
 * Consolidates duplicate calculation logic from BudgetChart.tsx, weeklyAggregation.ts, and Legend.tsx.
 */
export function getDisplayAmount(txn: Transaction): number {
  if (!Number.isFinite(txn.amount)) {
    console.error(`Invalid transaction amount: ${txn.amount}`, txn);
    return 0; // Safe fallback
  }

  if (txn.redeemable) {
    if (!Number.isFinite(txn.redemptionRate)) {
      console.error(`Invalid redemption rate: ${txn.redemptionRate}`, txn);
      return txn.amount; // Fallback: treat as non-redeemable
    }
    return txn.amount * txn.redemptionRate;
  }

  return txn.amount;
}

/**
 * Partition data by income/expense status.
 * Generic helper for separating income from expenses in financial data.
 */
export function partitionByIncome<T extends { isIncome: boolean }>(
  data: T[]
): { income: T[]; expense: T[] } {
  return {
    income: data.filter((d) => d.isIncome),
    expense: data.filter((d) => !d.isIncome),
  };
}
