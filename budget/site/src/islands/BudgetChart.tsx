import React, { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import { Transaction, MonthlyData, Category, CategoryFilter } from './types';
import transactionsData from '../data/transactions.json';

interface BudgetChartProps {
  categoryFilter: CategoryFilter;
  showVacation: boolean;
}

export function BudgetChart({ categoryFilter, showVacation }: BudgetChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    try {
      setLoading(true);

      // Process transactions
      const transactions = transactionsData.transactions as Transaction[];

      // Filter out transfers and apply filters
      const filteredTransactions = transactions.filter((txn) => {
        if (txn.transfer) return false;
        if (!showVacation && txn.vacation) return false;
        if (!categoryFilter[txn.category]) return false;
        return true;
      });

      // Transform to monthly aggregates
      const monthlyMap = new Map<string, Map<Category, number>>();

      filteredTransactions.forEach((txn) => {
        const month = txn.date.substring(0, 7); // YYYY-MM
        const displayAmount = txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;

        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, new Map());
        }

        const categoryMap = monthlyMap.get(month)!;
        const currentAmount = categoryMap.get(txn.category) || 0;
        categoryMap.set(txn.category, currentAmount + displayAmount);
      });

      // Convert to array format for Plot
      const monthlyData: MonthlyData[] = [];
      const netIncomeData: { month: Date; netIncome: number }[] = [];

      monthlyMap.forEach((categoryMap, month) => {
        let monthIncome = 0;
        let monthExpense = 0;

        categoryMap.forEach((amount, category) => {
          monthlyData.push({
            month,
            category,
            amount,
            isIncome: amount > 0,
          });

          if (amount > 0) {
            monthIncome += amount;
          } else {
            monthExpense += Math.abs(amount);
          }
        });

        // Calculate net income for this month
        const netIncome = monthIncome - monthExpense;
        netIncomeData.push({
          month: new Date(month + '-01'),
          netIncome,
        });
      });

      // Sort by month
      monthlyData.sort((a, b) => a.month.localeCompare(b.month));
      netIncomeData.sort((a, b) => a.month.getTime() - b.month.getTime());

      // Calculate 3-month trailing average
      const trailingAvgData = netIncomeData.map((item, idx) => {
        const start = Math.max(0, idx - 2);
        const slice = netIncomeData.slice(start, idx + 1);
        const avg = d3.mean(slice, (d) => d.netIncome) || 0;
        return {
          month: item.month,
          trailingAvg: avg,
        };
      });

      // Category colors (using design system inspired colors)
      const categoryColors: Record<string, string> = {
        income: '#10b981',
        housing: '#ef4444',
        utilities: '#f59e0b',
        groceries: '#8b5cf6',
        dining: '#ec4899',
        transportation: '#3b82f6',
        healthcare: '#14b8a6',
        entertainment: '#f97316',
        shopping: '#a855f7',
        travel: '#06b6d4',
        investment: '#6366f1',
        other: '#6b7280',
      };

      // Clear container by removing child nodes
      while (containerRef.current.firstChild) {
        containerRef.current.removeChild(containerRef.current.firstChild);
      }

      // Create the plot
      const plot = Plot.plot({
        width: containerRef.current.clientWidth || 800,
        height: 500,
        marginTop: 20,
        marginRight: 20,
        marginBottom: 40,
        marginLeft: 60,
        x: {
          type: 'band',
          label: 'Month',
          tickFormat: (d: string) => {
            const date = new Date(d + '-01');
            return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
          },
        },
        y: {
          label: 'Amount ($)',
          grid: true,
          tickFormat: (d: number) => `$${Math.abs(d).toLocaleString()}`,
        },
        color: {
          type: 'categorical',
          domain: Object.keys(categoryColors),
          range: Object.values(categoryColors),
          legend: false,
        },
        marks: [
          // Zero line
          Plot.ruleY([0], { stroke: '#666', strokeWidth: 1.5 }),

          // Stacked bars for expenses (negative values)
          Plot.barY(
            monthlyData.filter((d) => !d.isIncome),
            Plot.stackY({
              x: 'month',
              y: 'amount',
              fill: 'category',
              title: (d: MonthlyData) => `${d.category}: $${Math.abs(d.amount).toFixed(2)}`,
            })
          ),

          // Stacked bars for income (positive values)
          Plot.barY(
            monthlyData.filter((d) => d.isIncome),
            Plot.stackY({
              x: 'month',
              y: 'amount',
              fill: 'category',
              title: (d: MonthlyData) => `${d.category}: $${d.amount.toFixed(2)}`,
            })
          ),

          // Net income line
          Plot.line(netIncomeData, {
            x: (d: { month: Date; netIncome: number }) => {
              const month = d.month.toISOString().substring(0, 7);
              return month;
            },
            y: 'netIncome',
            stroke: '#00d4ed',
            strokeWidth: 3,
            title: (d: { month: Date; netIncome: number }) => `Net: $${d.netIncome.toFixed(2)}`,
          }),

          // 3-month trailing average line
          Plot.line(trailingAvgData, {
            x: (d: { month: Date; trailingAvg: number }) => {
              const month = d.month.toISOString().substring(0, 7);
              return month;
            },
            y: 'trailingAvg',
            stroke: '#00d4ed',
            strokeWidth: 2,
            strokeDasharray: '5,5',
            strokeOpacity: 0.7,
            title: (d: { month: Date; trailingAvg: number }) =>
              `3-mo avg: $${d.trailingAvg.toFixed(2)}`,
          }),
        ],
      });

      containerRef.current.appendChild(plot);
      setLoading(false);
    } catch (err) {
      console.error('Error rendering chart:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [categoryFilter, showVacation]);

  if (loading) {
    return (
      <div className="p-8 bg-bg-elevated rounded-lg shadow-lg flex items-center justify-center">
        <div className="spinner"></div>
        <span className="ml-3 text-text-secondary">Loading chart...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 bg-error-muted text-error rounded-lg border border-error">
        Error loading chart: {error}
      </div>
    );
  }

  return (
    <div className="p-6 bg-bg-elevated rounded-lg shadow-lg">
      <h2 className="text-2xl font-semibold mb-4 text-text-primary">Budget Overview</h2>
      <div ref={containerRef} className="w-full"></div>
    </div>
  );
}
