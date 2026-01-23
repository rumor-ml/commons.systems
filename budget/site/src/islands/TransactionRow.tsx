import React, { useState } from 'react';
import { Transaction } from '../scripts/firestore';

interface TransactionRowProps {
  transaction: Transaction;
}

export function TransactionRow({ transaction }: TransactionRowProps) {
  const [expanded, setExpanded] = useState(false);

  // Format amount with proper sign and color
  const amountColor = transaction.amount >= 0 ? 'text-success' : 'text-error';
  const formattedAmount =
    transaction.amount >= 0
      ? `+$${transaction.amount.toFixed(2)}`
      : `-$${Math.abs(transaction.amount).toFixed(2)}`;

  return (
    <>
      <tr
        className="border-b border-bg-hover hover:bg-bg-hover cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-4 py-3 text-sm">{transaction.date}</td>
        <td className="px-4 py-3 text-sm">{transaction.description}</td>
        <td className={`px-4 py-3 text-sm font-mono ${amountColor}`}>{formattedAmount}</td>
        <td className="px-4 py-3 text-sm">
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-bg-elevated text-text-secondary">
            {transaction.category}
          </span>
        </td>
        <td className="px-4 py-3 text-sm">
          <div className="flex gap-1">
            {transaction.redeemable && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary-muted text-primary">
                Redeemable
              </span>
            )}
            {transaction.vacation && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary-muted text-secondary">
                Vacation
              </span>
            )}
            {transaction.transfer && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-bg-elevated text-text-secondary">
                Transfer
              </span>
            )}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="bg-bg-elevated border-b border-bg-hover">
          <td colSpan={5} className="px-4 py-4">
            <div className="text-sm space-y-2">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-text-tertiary">Transaction ID:</span>
                  <span className="ml-2 font-mono text-xs">{transaction.id}</span>
                </div>
                {transaction.linkedTransactionId && (
                  <div>
                    <span className="text-text-tertiary">Linked Transaction:</span>
                    <span className="ml-2 font-mono text-xs">
                      {transaction.linkedTransactionId}
                    </span>
                  </div>
                )}
                {transaction.redemptionRate && (
                  <div>
                    <span className="text-text-tertiary">Redemption Rate:</span>
                    <span className="ml-2">{(transaction.redemptionRate * 100).toFixed(1)}%</span>
                  </div>
                )}
                {transaction.statementIds.length > 0 && (
                  <div>
                    <span className="text-text-tertiary">Statements:</span>
                    <span className="ml-2">{transaction.statementIds.length}</span>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
