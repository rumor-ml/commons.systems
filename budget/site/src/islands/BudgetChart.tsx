import { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import { Transaction, MonthlyData, Category, TooltipData, QualifierBreakdown } from './types';
import { CATEGORY_COLORS } from './constants';
import { SegmentTooltip } from './SegmentTooltip';

interface BudgetChartProps {
  transactions: Transaction[];
  hiddenCategories: string[];
  showVacation: boolean;
}

export function BudgetChart({ transactions, hiddenCategories, showVacation }: BudgetChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pinnedSegmentRef = useRef<TooltipData | null>(null);
  const monthlyDataRef = useRef<MonthlyData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredSegment, setHoveredSegment] = useState<TooltipData | null>(null);
  const [pinnedSegment, setPinnedSegment] = useState<TooltipData | null>(null);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    // Guard clause: validate transactions prop
    if (!transactions || !Array.isArray(transactions)) {
      setError('Invalid or missing transaction data');
      setLoading(false);
      return;
    }

    // TODO: See issue #384 - Split this broad try-catch into separate blocks for transformation, rendering, and event listeners
    try {
      setLoading(true);

      // Filter out transfers and apply filters
      const hiddenSet = new Set(hiddenCategories);
      const filteredTransactions = transactions.filter((txn) => {
        if (txn.transfer) return false;
        if (!showVacation && txn.vacation) return false;
        if (hiddenSet.has(txn.category)) return false;
        return true;
      });

      // TODO: See issue #445 - Extract data transformation to pure function for unit testing
      // Transform to monthly aggregates with qualifier tracking
      const monthlyMap = new Map<
        string,
        Map<Category, { amount: number; qualifiers: QualifierBreakdown }>
      >();

      filteredTransactions.forEach((txn) => {
        const month = txn.date.substring(0, 7); // YYYY-MM
        const displayAmount = txn.redeemable ? txn.amount * txn.redemptionRate : txn.amount;

        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, new Map());
        }

        const categoryMap = monthlyMap.get(month)!;
        const current = categoryMap.get(txn.category) || {
          amount: 0,
          qualifiers: {
            redeemable: 0,
            nonRedeemable: 0,
            vacation: 0,
            nonVacation: 0,
            transactionCount: 0,
          },
        };

        // Update amount
        current.amount += displayAmount;

        // Track qualifier breakdowns
        if (txn.redeemable) {
          current.qualifiers.redeemable += displayAmount;
        } else {
          current.qualifiers.nonRedeemable += displayAmount;
        }

        if (txn.vacation) {
          current.qualifiers.vacation += displayAmount;
        } else {
          current.qualifiers.nonVacation += displayAmount;
        }

        current.qualifiers.transactionCount++;

        categoryMap.set(txn.category, current);
      });

      // Convert to array format for Plot
      const monthlyData: MonthlyData[] = [];
      const netIncomeData: { month: Date; netIncome: number }[] = [];

      monthlyMap.forEach((categoryMap, month) => {
        let monthIncome = 0;
        let monthExpense = 0;

        categoryMap.forEach((data, category) => {
          monthlyData.push({
            month,
            category,
            amount: data.amount,
            isIncome: data.amount > 0,
            qualifiers: data.qualifiers,
          });

          if (data.amount > 0) {
            monthIncome += data.amount;
          } else {
            monthExpense += Math.abs(data.amount);
          }
        });

        // Calculate net income for this month
        const netIncome = monthIncome - monthExpense;
        netIncomeData.push({
          month: new Date(month + '-01'),
          netIncome,
        });
      });

      // Sort by month AND category to match Observable Plot's rendering order
      monthlyData.sort((a, b) => {
        const monthCompare = a.month.localeCompare(b.month);
        if (monthCompare !== 0) return monthCompare;
        // If months are equal, sort by category
        return a.category.localeCompare(b.category);
      });
      netIncomeData.sort((a, b) => a.month.getTime() - b.month.getTime());

      // Store monthlyData in ref for tooltip access
      monthlyDataRef.current = monthlyData;

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

      // Clear container
      containerRef.current.replaceChildren();

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
          domain: Object.keys(CATEGORY_COLORS),
          range: Object.values(CATEGORY_COLORS),
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
            })
          ),

          // Stacked bars for income (positive values)
          Plot.barY(
            monthlyData.filter((d) => d.isIncome),
            Plot.stackY({
              x: 'month',
              y: 'amount',
              fill: 'category',
            })
          ),

          // Net income line
          Plot.line(netIncomeData, {
            x: (d) => d.month.toISOString().substring(0, 7),
            y: 'netIncome',
            stroke: '#00d4ed',
            strokeWidth: 3,
          }),

          // 3-month trailing average line
          Plot.line(trailingAvgData, {
            x: (d) => d.month.toISOString().substring(0, 7),
            y: 'trailingAvg',
            stroke: '#00d4ed',
            strokeWidth: 2,
            strokeDasharray: '5,5',
            strokeOpacity: 0.7,
          }),
        ],
      });

      containerRef.current.appendChild(plot);

      // Attach event listeners to bar segments for tooltips
      // We need to match bars to data - Plot renders bars in two groups (expenses and income)
      // The bars are in g[aria-label="bar"] elements - expenses first, then income
      // TODO: See issue #384 - Log warnings when bar groups/elements not found for tooltip attachment
      const barGroups = plot.querySelectorAll('g[aria-label="bar"]');
      const expenseBars = barGroups[0]?.querySelectorAll('rect') || [];
      const incomeBars = barGroups[1]?.querySelectorAll('rect') || [];

      // Helper function to attach event listeners to bar segments
      const attachBarEventListeners = (bars: NodeListOf<Element>, data: MonthlyData[]) => {
        bars.forEach((rect, index) => {
          const barData = data[index];
          if (!barData) return;

          const element = rect as SVGRectElement;
          element.style.cursor = 'pointer';

          // Add data attributes for testing (only for expense bars)
          if (!barData.isIncome) {
            element.setAttribute('data-month', barData.month);
            element.setAttribute('data-category', barData.category);
            element.setAttribute('data-amount', barData.amount.toString());
          }

          // Mouse enter - show tooltip on hover
          element.addEventListener('mouseenter', (e: MouseEvent) => {
            if (pinnedSegmentRef.current) return;

            const tooltipData: TooltipData = {
              month: barData.month,
              category: barData.category,
              amount: barData.amount,
              isIncome: barData.isIncome,
              qualifiers: barData.qualifiers,
              x: e.clientX + 10,
              y: e.clientY + 10,
            };

            setHoveredSegment(tooltipData);
          });

          // Mouse leave - hide hover tooltip
          element.addEventListener('mouseleave', () => {
            setHoveredSegment(null);
          });

          // Click - pin tooltip
          element.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();

            const tooltipData: TooltipData = {
              month: barData.month,
              category: barData.category,
              amount: barData.amount,
              isIncome: barData.isIncome,
              qualifiers: barData.qualifiers,
              x: e.clientX + 10,
              y: e.clientY + 10,
            };

            pinnedSegmentRef.current = tooltipData;
            setPinnedSegment(tooltipData);
            setHoveredSegment(null);
          });
        });
      };

      // Match expense bars to expense data
      const expenseData = monthlyData.filter((d) => !d.isIncome);
      attachBarEventListeners(expenseBars, expenseData);

      // Match income bars to income data
      const incomeData = monthlyData.filter((d) => d.isIncome);
      attachBarEventListeners(incomeBars, incomeData);

      setLoading(false);
    } catch (err) {
      console.error('Error rendering chart:', err);
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  }, [transactions, hiddenCategories, showVacation]);

  // Handle document clicks to unpin tooltip
  useEffect(() => {
    const handleDocumentClick = () => {
      pinnedSegmentRef.current = null;
      setPinnedSegment(null);
    };

    if (pinnedSegment) {
      document.addEventListener('click', handleDocumentClick);
    }

    return () => {
      document.removeEventListener('click', handleDocumentClick);
    };
  }, [pinnedSegment]);

  // Clear pinned tooltip when filters change
  useEffect(() => {
    pinnedSegmentRef.current = null;
    setPinnedSegment(null);
  }, [hiddenCategories, showVacation]);

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
      <SegmentTooltip
        data={pinnedSegment || hoveredSegment}
        isPinned={!!pinnedSegment}
        onClose={() => {
          pinnedSegmentRef.current = null;
          setPinnedSegment(null);
        }}
      />
    </div>
  );
}
