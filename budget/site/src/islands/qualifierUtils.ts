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
