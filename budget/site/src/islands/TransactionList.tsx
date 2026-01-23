import React, { useState, useEffect, useMemo } from 'react';
import {
  Transaction,
  loadUserTransactions,
  loadDemoTransactions,
  isFirebaseConfigured,
  getFirestoreDebugInfo,
} from '../scripts/firestore';
import { getCurrentUser } from '../scripts/auth';
import { TransactionRow } from './TransactionRow';
import { TransactionFilters } from './TransactionFilters';
import { FirebaseSetupGuide } from './FirebaseSetupGuide';

export function TransactionList() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Load transactions on mount
  useEffect(() => {
    // Log debug info on mount
    const debugInfo = getFirestoreDebugInfo();
    console.log('Firestore Debug Info:', debugInfo);

    loadTransactions();
  }, []);

  const loadTransactions = async () => {
    // Check if Firebase is configured before attempting to load
    if (!isFirebaseConfigured()) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const user = getCurrentUser();
      let data: Transaction[];

      if (user) {
        // Load user transactions
        data = await loadUserTransactions(user.uid, {
          limitCount: 1000,
        });
      } else {
        // Load demo transactions
        data = await loadDemoTransactions({ limitCount: 100 });
      }

      setTransactions(data);
      console.log(`Successfully loaded ${data.length} transactions`);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('Error loading transactions:', err);
      setError(`Failed to load transactions: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  // Filter transactions
  const filteredTransactions = useMemo(() => {
    return transactions.filter((txn) => {
      // Date range filter
      if (startDate && txn.date < startDate) return false;
      if (endDate && txn.date > endDate) return false;

      // Category filter
      if (category !== 'all' && txn.category !== category) return false;

      // Search filter
      if (searchQuery && !txn.description.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      return true;
    });
  }, [transactions, startDate, endDate, category, searchQuery]);

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'Date',
      'Description',
      'Amount',
      'Category',
      'Redeemable',
      'Vacation',
      'Transfer',
    ];
    const rows = filteredTransactions.map((txn) => [
      txn.date,
      `"${txn.description.replace(/"/g, '""')}"`,
      txn.amount.toFixed(2),
      txn.category,
      txn.redeemable ? 'Yes' : 'No',
      txn.vacation ? 'Yes' : 'No',
      txn.transfer ? 'Yes' : 'No',
    ]);

    const csv = [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Reset filters
  const resetFilters = () => {
    setStartDate('');
    setEndDate('');
    setCategory('all');
    setSearchQuery('');
  };

  // Show setup guide if Firebase is not configured
  if (!isFirebaseConfigured()) {
    return <FirebaseSetupGuide />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="spinner"></div>
        <span className="ml-3 text-text-secondary">Loading transactions...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-error-muted border border-error rounded-lg p-4">
        <p className="text-error">{error}</p>
        <button onClick={loadTransactions} className="mt-2 btn btn-sm btn-primary">
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-text-primary">Transaction Review</h2>
          <p className="text-text-secondary mt-1">
            {filteredTransactions.length} of {transactions.length} transactions
          </p>
        </div>
        <button onClick={exportToCSV} className="btn btn-primary">
          Export to CSV
        </button>
      </div>

      {/* Filters */}
      <TransactionFilters
        startDate={startDate}
        endDate={endDate}
        category={category}
        searchQuery={searchQuery}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        onCategoryChange={setCategory}
        onSearchChange={setSearchQuery}
        onReset={resetFilters}
      />

      {/* Transaction Table */}
      {filteredTransactions.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-text-secondary">No transactions match your filters.</p>
          <button onClick={resetFilters} className="mt-4 btn btn-sm btn-secondary">
            Clear Filters
          </button>
        </div>
      ) : (
        <div className="bg-bg-surface rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-bg-elevated border-b border-bg-hover">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Description
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Category
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-text-secondary uppercase tracking-wider">
                    Flags
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-hover">
                {filteredTransactions.map((txn) => (
                  <TransactionRow key={txn.id} transaction={txn} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
