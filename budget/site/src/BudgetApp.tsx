import React, { useState, useMemo } from 'react';
import { BudgetChart } from './islands/BudgetChart';
import { Legend } from './islands/Legend';
import { Category, CategoryFilter, Transaction } from './islands/types';
import transactionsData from './data/transactions.json';

export function BudgetApp() {
  // Initialize all categories as visible
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>({
    income: true,
    housing: true,
    utilities: true,
    groceries: true,
    dining: true,
    transportation: true,
    healthcare: true,
    entertainment: true,
    shopping: true,
    travel: true,
    investment: true,
    other: true,
  });

  const [showVacation, setShowVacation] = useState(true);

  const handleCategoryToggle = (category: Category) => {
    setCategoryFilter((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  };

  const handleVacationToggle = () => {
    setShowVacation((prev) => !prev);
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const transactions = transactionsData.transactions as Transaction[];

    const filteredTransactions = transactions.filter((txn) => {
      if (txn.transfer) return false;
      if (!showVacation && txn.vacation) return false;
      if (!categoryFilter[txn.category]) return false;
      return true;
    });

    let totalIncome = 0;
    let totalExpenses = 0;

    filteredTransactions.forEach((txn) => {
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
  }, [categoryFilter, showVacation]);

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1 className="app-title">Budget Visualization</h1>
        <p className="app-subtitle">Track your income and expenses with interactive charts</p>
      </header>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-label">Total Income</div>
          <div className="summary-value positive">
            $
            {summaryStats.totalIncome.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Total Expenses</div>
          <div className="summary-value negative">
            $
            {summaryStats.totalExpenses.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Net Income</div>
          <div className={`summary-value ${summaryStats.netIncome >= 0 ? 'positive' : 'negative'}`}>
            $
            {summaryStats.netIncome.toLocaleString(undefined, {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Savings Rate</div>
          <div
            className={`summary-value ${summaryStats.savingsRate >= 20 ? 'positive' : 'neutral'}`}
          >
            {summaryStats.savingsRate.toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Main Layout */}
      <div className="main-layout">
        <BudgetChart categoryFilter={categoryFilter} showVacation={showVacation} />
        <Legend
          categoryFilter={categoryFilter}
          onCategoryToggle={handleCategoryToggle}
          showVacation={showVacation}
          onVacationToggle={handleVacationToggle}
        />
      </div>
    </div>
  );
}
