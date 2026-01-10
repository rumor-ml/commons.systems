import { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import {
  Transaction,
  MonthlyData,
  Category,
  TooltipData,
  QualifierBreakdown,
  TimeGranularity,
  WeekId,
  BudgetPlan,
  createQualifierBreakdown,
} from './types';
import { CATEGORY_COLORS } from './constants';
import { SegmentTooltip } from './SegmentTooltip';
import {
  aggregateTransactionsByWeek,
  calculateWeeklyComparison,
  getCurrentWeek,
} from '../scripts/weeklyAggregation';
import {
  updateQualifierBreakdown,
  filterTransactions,
  getDisplayAmount,
  partitionByIncome,
} from './qualifierUtils';

/**
 * Render an empty state message in the chart container.
 */
function renderEmptyState(container: HTMLElement, message: string): void {
  container.replaceChildren();
  const emptyDiv = document.createElement('div');
  emptyDiv.className = 'p-8 text-center text-text-secondary';
  emptyDiv.textContent = message;
  container.appendChild(emptyDiv);
}

/**
 * Transform transactions to monthly aggregates with qualifier tracking.
 * Filters out transfers and applies category/vacation filters.
 * @returns Object containing monthlyData, netIncomeData, and trailingAvgData
 */
function transformToMonthlyData(
  transactions: Transaction[],
  hiddenSet: Set<Category>,
  showVacation: boolean
): {
  monthlyData: MonthlyData[];
  netIncomeData: { month: Date; netIncome: number }[];
  trailingAvgData: { month: Date; trailingAvg: number }[];
} {
  // Filter out transfers and apply filters
  const filteredTransactions = filterTransactions(transactions, {
    hiddenCategories: hiddenSet,
    showVacation,
  });

  // Transform to monthly aggregates with qualifier tracking
  const monthlyMap = new Map<
    string,
    Map<Category, { amount: number; qualifiers: QualifierBreakdown }>
  >();

  filteredTransactions.forEach((txn) => {
    const month = txn.date.substring(0, 7); // YYYY-MM
    const displayAmount = getDisplayAmount(txn);

    if (!monthlyMap.has(month)) {
      monthlyMap.set(month, new Map());
    }

    const categoryMap = monthlyMap.get(month)!;
    const current = categoryMap.get(txn.category) || {
      amount: 0,
      qualifiers: createQualifierBreakdown(),
    };

    // Update amount
    current.amount += displayAmount;

    // Track qualifier breakdowns
    updateQualifierBreakdown(current.qualifiers, txn, displayAmount);

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

  // Calculate 3-month trailing average
  const trailingAvgData = netIncomeData.map((item, idx) => {
    const start = Math.max(0, idx - 2);
    const slice = netIncomeData.slice(start, idx + 1);

    // Validate slice has data before calculating mean
    if (slice.length === 0) {
      console.warn(`No data for trailing average at index ${idx}`);
      return {
        month: item.month,
        trailingAvg: 0,
      };
    }

    const avg = d3.mean(slice, (d) => d.netIncome);

    // Validate mean calculation succeeded
    // d3.mean returns undefined for empty arrays and NaN for arrays of all NaN values
    if (avg === undefined || !Number.isFinite(avg)) {
      console.error(`Invalid trailing average at index ${idx}:`, {
        slice: slice.map((d) => ({ month: d.month, netIncome: d.netIncome })),
        calculatedMean: avg,
      });

      // Return 0 for empty data - intentional fallback for display purposes
      return {
        month: item.month,
        trailingAvg: 0,
      };
    }

    return {
      month: item.month,
      trailingAvg: avg,
    };
  });

  return { monthlyData, netIncomeData, trailingAvgData };
}

/**
 * Render monthly stacked bar chart with trend lines.
 * @returns Object containing plot element and partitioned data
 */
function renderMonthlyChart(
  container: HTMLElement,
  monthlyData: MonthlyData[],
  netIncomeData: { month: Date; netIncome: number }[],
  trailingAvgData: { month: Date; trailingAvg: number }[]
): { plot: Element; expenseData: MonthlyData[]; incomeData: MonthlyData[] } {
  // Partition data once for both plot rendering and event listeners
  const { expense: expenseData, income: incomeData } = partitionByIncome(monthlyData);

  // Create the plot
  const plot = Plot.plot({
    width: container.clientWidth || 800,
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
        expenseData,
        Plot.stackY({
          x: 'month',
          y: 'amount',
          fill: 'category',
        })
      ),

      // Stacked bars for income (positive values)
      Plot.barY(
        incomeData,
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

  return { plot, expenseData, incomeData };
}

/**
 * Attach event listeners to bar segments for tooltip interactivity.
 * @param expenseData Pre-partitioned expense data (negative amounts)
 * @param incomeData Pre-partitioned income data (positive amounts)
 * @throws Error if bar groups not found (caller should handle gracefully)
 */
function attachTooltipListeners(
  plot: Element,
  expenseData: MonthlyData[],
  incomeData: MonthlyData[],
  setHoveredSegment: (data: TooltipData | null) => void,
  pinnedSegmentRef: React.MutableRefObject<TooltipData | null>,
  setPinnedSegment: (data: TooltipData | null) => void
): void {
  // Attach event listeners to bar segments for tooltips
  // Expected DOM structure from Observable Plot:
  //   - Two g[aria-label="bar"] groups (one for expenses, one for income)
  //   - barGroups[0] contains expense bars (negative values, stacked)
  //   - barGroups[1] contains income bars (positive values, stacked)
  //   - Each group's rect elements map 1:1 to filtered data array (after partitionByIncome)
  // Observable Plot may render differently if:
  //   - Only expenses or only income present (single bar group)
  //   - Empty data (no bar groups)
  //   - Future Plot version changes aria-label structure
  // If structure doesn't match expectations, we fail fast with clear error rather than silently attaching listeners to wrong elements.
  const barGroups = plot.querySelectorAll('g[aria-label="bar"]');
  const expenseBars = barGroups[0]?.querySelectorAll('rect') || [];
  const incomeBars = barGroups[1]?.querySelectorAll('rect') || [];

  // Validate bar groups were found before attaching listeners
  if (barGroups.length === 0) {
    throw new Error('Chart bars not found - tooltip interactivity unavailable');
  }

  // Helper function to attach event listeners to bar segments
  const attachBarEventListeners = (bars: NodeListOf<Element> | Element[], data: MonthlyData[]) => {
    bars.forEach((rect, index) => {
      const barData = data[index];
      if (!barData) return;

      const element = rect as SVGRectElement;
      element.style.cursor = 'pointer';

      // Add data attributes for E2E testing expense bars
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

  attachBarEventListeners(expenseBars, expenseData);
  attachBarEventListeners(incomeBars, incomeData);
}

interface BudgetChartProps {
  transactions: Transaction[];
  hiddenCategories: readonly Category[];
  showVacation: boolean;
  granularity?: TimeGranularity;
  selectedWeek?: WeekId | null;
  budgetPlan?: BudgetPlan | null;
}

export function BudgetChart({
  transactions,
  hiddenCategories,
  showVacation,
  granularity = 'month',
  selectedWeek = null,
  budgetPlan = null,
}: BudgetChartProps) {
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

    setLoading(true);

    const hiddenSet = new Set(hiddenCategories);

    // WEEKLY vs MONTHLY modes use separate rendering paths for code clarity and maintainability.
    // Weekly mode adds budget overlay marks and rollover badges; monthly mode adds trend lines
    // and time-series formatting. Both use the same Plot.plot() structure with different data
    // sources, marks arrays, and axis configurations.

    // WEEKLY MODE
    if (granularity === 'week') {
      // Aggregate transactions by week
      let weeklyData;
      try {
        weeklyData = aggregateTransactionsByWeek(transactions, {
          hiddenCategories: hiddenSet,
          showVacation,
        });
      } catch (err) {
        console.error('Failed to aggregate transactions by week:', err, {
          transactionCount: transactions.length,
          hiddenCategories: Array.from(hiddenSet),
        });
        setError('Failed to process transaction data. Check console for details.');
        setLoading(false);
        return;
      }

      if (weeklyData.length === 0) {
        const hasAnyTransactions = transactions.length > 0;
        const allCategoriesHidden = hiddenCategories.length > 0;
        const nonTransferCount = transactions.filter((t) => !t.transfer).length;

        const getMessage = (): string => {
          if (!hasAnyTransactions) {
            return 'No transactions loaded. Import transaction data to begin.';
          }
          if (nonTransferCount === 0) {
            return 'Only transfers found (transfers are excluded from budget view)';
          }
          if (allCategoriesHidden) {
            return `${hiddenCategories.length} categories are hidden. Click categories in the legend to show them.`;
          }
          if (!showVacation) {
            return 'No non-vacation transactions available. Enable "Show Vacation" to see vacation spending.';
          }
          return 'No transaction data available for weekly view';
        };

        renderEmptyState(containerRef.current, getMessage());
        setLoading(false);
        return;
      }

      // Determine which week to display
      const activeWeek = selectedWeek || getCurrentWeek();

      // Filter data for the selected week only
      const weekData = weeklyData.filter((d) => d.week === activeWeek);

      if (weekData.length === 0) {
        renderEmptyState(
          containerRef.current,
          `No transaction data for week ${activeWeek}. Try navigating to a different week.`
        );
        setLoading(false);
        return;
      }

      // Calculate budget comparisons if budget plan exists
      let comparisons: Map<Category, { target: number; rolloverAccumulated: number }> = new Map();
      let budgetComparisonFailed = false;
      if (budgetPlan && Object.keys(budgetPlan.categoryBudgets).length > 0) {
        try {
          const comparisonData = calculateWeeklyComparison(weeklyData, budgetPlan, activeWeek);
          comparisonData.forEach((c) => {
            comparisons.set(c.category, {
              target: c.target,
              rolloverAccumulated: c.rolloverAccumulated,
            });
          });
        } catch (err) {
          console.error('Failed to calculate budget comparisons:', err, {
            activeWeek,
            budgetCategories: Object.keys(budgetPlan.categoryBudgets),
          });
          // Show degraded chart without budget overlays instead of complete failure
          budgetComparisonFailed = true;
          // comparisons Map is already empty, so no budget overlays will be added
        }
      }

      // Chart rendering
      try {
        // Clear container
        containerRef.current.replaceChildren();

        // Create the weekly chart
        const marks: any[] = [
          // Zero line
          Plot.ruleY([0], { stroke: '#666', strokeWidth: 1.5 }),
        ];

        const { expense: expenseData, income: incomeData } = partitionByIncome(weekData);

        if (expenseData.length > 0) {
          marks.push(
            Plot.barY(expenseData, {
              x: 'category',
              y: 'amount',
              fill: 'category',
            })
          );
        }

        if (incomeData.length > 0) {
          marks.push(
            Plot.barY(incomeData, {
              x: 'category',
              y: 'amount',
              fill: 'category',
            })
          );
        }

        // Add budget target overlays if budget plan exists
        if (budgetPlan && comparisons.size > 0) {
          const targetData: { category: Category; target: number; hasRollover: boolean }[] = [];
          comparisons.forEach((data, category) => {
            if (data.target !== 0) {
              targetData.push({
                category,
                target: data.target,
                hasRollover: data.rolloverAccumulated !== 0,
              });
            }
          });

          if (targetData.length > 0) {
            // Target bars with lower opacity
            marks.push(
              Plot.barY(targetData, {
                x: 'category',
                y: 'target',
                fill: 'category',
                opacity: 0.3,
                stroke: 'category',
                strokeWidth: 2,
                strokeDasharray: '4,4',
              })
            );

            // Rollover badges
            const rolloverData = targetData.filter((d) => d.hasRollover);
            if (rolloverData.length > 0) {
              marks.push(
                Plot.text(rolloverData, {
                  x: 'category',
                  y: () => 0,
                  text: () => '🔄',
                  dy: -10,
                  fontSize: 12,
                })
              );
            }
          }
        }

        const plot = Plot.plot({
          width: containerRef.current.clientWidth || 800,
          height: 500,
          marginTop: 20,
          marginRight: 20,
          marginBottom: 80,
          marginLeft: 60,
          x: {
            label: 'Category',
            tickRotate: -45,
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
          marks,
        });

        containerRef.current.appendChild(plot);

        // Add warning indicator if budget comparison failed
        if (budgetComparisonFailed && containerRef.current) {
          const warningDiv = document.createElement('div');
          warningDiv.className = 'text-xs text-warning bg-warning-muted p-2 rounded mt-2';
          warningDiv.innerHTML =
            '⚠️ Budget overlays unavailable - showing spending data only. Check your budget settings.';
          containerRef.current.appendChild(warningDiv);
        }
      } catch (err) {
        console.error('Failed to render weekly chart:', err, {
          activeWeek,
          dataPoints: weekData.length,
          budgetOverlays: comparisons.size,
        });
        setError('Failed to render chart visualization. Try switching to monthly view.');
        setLoading(false);
        return;
      }

      setLoading(false);
      return;
    }

    // MONTHLY MODE
    // Data transformation
    let monthlyData: MonthlyData[];
    let netIncomeData: { month: Date; netIncome: number }[];
    let trailingAvgData: { month: Date; trailingAvg: number }[];

    try {
      ({ monthlyData, netIncomeData, trailingAvgData } = transformToMonthlyData(
        transactions,
        hiddenSet,
        showVacation
      ));
    } catch (err) {
      console.error('Failed to transform monthly data:', err);
      setError('Failed to process transaction data for monthly view.');
      setLoading(false);
      return;
    }

    // Store monthlyData in ref for tooltip access
    monthlyDataRef.current = monthlyData;

    // Chart rendering
    let plot: Element;
    let expenseData: MonthlyData[];
    let incomeData: MonthlyData[];
    try {
      containerRef.current.replaceChildren();
      const result = renderMonthlyChart(
        containerRef.current,
        monthlyData,
        netIncomeData,
        trailingAvgData
      );
      plot = result.plot;
      expenseData = result.expenseData;
      incomeData = result.incomeData;
      containerRef.current.appendChild(plot);
    } catch (err) {
      console.error('Failed to render monthly chart:', err);
      setError('Failed to render chart visualization. Try switching to weekly view.');
      setLoading(false);
      return;
    }

    // Event listener attachment
    try {
      attachTooltipListeners(
        plot,
        expenseData,
        incomeData,
        setHoveredSegment,
        pinnedSegmentRef,
        setPinnedSegment
      );
    } catch (err) {
      console.error('Failed to attach event listeners:', err);
      console.error('DOM diagnostics at failure:', {
        barGroups: plot.querySelectorAll('g[aria-label="bar"]').length,
        allGroups: plot.querySelectorAll('g').length,
        svgChildren: plot.children.length,
        plotPreview: plot.innerHTML.substring(0, 300),
      });
      console.warn('Chart rendered in static mode - no tooltip interactivity');

      // Add user-visible warning banner with recovery option
      const warningDiv = document.createElement('div');
      warningDiv.className =
        'text-xs text-warning bg-warning-muted p-2 rounded mt-2 flex items-center gap-2';

      const messageSpan = document.createElement('span');
      messageSpan.textContent = '⚠️ Chart loaded in static mode. Hover tooltips are unavailable.';

      const refreshButton = document.createElement('button');
      refreshButton.className = 'btn btn-sm btn-ghost underline';
      refreshButton.textContent = 'Refresh Page';
      refreshButton.onclick = () => window.location.reload();

      warningDiv.appendChild(messageSpan);
      warningDiv.appendChild(refreshButton);
      containerRef.current?.appendChild(warningDiv);

      // Don't call setError() here - the chart has already rendered successfully
      // Tooltip failures are non-fatal and should not trigger error UI
    }

    setLoading(false);
  }, [transactions, hiddenCategories, showVacation, granularity, selectedWeek, budgetPlan]);

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
    // Log technical details to console for debugging
    console.error('BudgetChart error:', error);

    return (
      <div className="p-8 bg-error-muted rounded-lg border border-error">
        <div className="flex items-start gap-3">
          <span className="text-error text-2xl">⚠️</span>
          <div>
            <h3 className="text-error font-semibold mb-1">Chart Error</h3>
            <p className="text-error text-sm mb-2">{error}</p>
            <details className="text-xs text-error opacity-75">
              <summary className="cursor-pointer">Technical details</summary>
              <pre className="mt-2 p-2 bg-bg-base rounded overflow-x-auto">{error}</pre>
            </details>
          </div>
        </div>
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
