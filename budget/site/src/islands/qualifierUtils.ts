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
  return txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;
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
