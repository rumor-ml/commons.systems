import { useEffect, useRef, useState } from 'react';
import * as Plot from '@observablehq/plot';
import * as d3 from 'd3';
import {
  Transaction,
  MonthlyData,
  Category,
  TooltipData,
  QualifierBreakdown,
  BudgetPlan,
  createQualifierBreakdown,
} from './types';
import { CATEGORY_COLORS } from './constants';
import { SegmentTooltip } from './SegmentTooltip';
import {
  updateQualifierBreakdown,
  filterTransactions,
  getDisplayAmount,
  partitionByIncome,
} from './qualifierUtils';
import { dispatchBudgetEvent } from '../utils/events';

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
 * Filters out transfers and applies category/vacation/date range filters.
 * @returns Object containing monthlyData, netIncomeData, and trailingAvgData
 */
function transformToMonthlyData(
  transactions: Transaction[],
  hiddenSet: Set<Category>,
  showVacation: boolean,
  dateRangeStart: string | null = null,
  dateRangeEnd: string | null = null
): {
  monthlyData: MonthlyData[];
  netIncomeData: { month: Date; netIncome: number }[];
  trailingAvgData: { month: Date; trailingAvg: number }[];
} {
  // Filter out transfers and apply filters
  let filteredTransactions = filterTransactions(transactions, {
    hiddenCategories: hiddenSet,
    showVacation,
  });

  // Apply date range filter
  if (dateRangeStart || dateRangeEnd) {
    filteredTransactions = filteredTransactions.filter((txn) => {
      if (dateRangeStart && txn.date < dateRangeStart) return false;
      if (dateRangeEnd && txn.date > dateRangeEnd) return false;
      return true;
    });
  }

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
 * Transform monthly data to weekly bars for aggregation.
 * Groups transactions by ISO week and category.
 */
function transformToWeeklyBars(monthlyData: MonthlyData[]): MonthlyData[] {
  // Group by ISO week (YYYY-Www format)
  const weeklyMap = new Map<string, Map<Category, { amount: number; qualifiers: QualifierBreakdown }>>();

  monthlyData.forEach((item) => {
    const date = new Date(item.month + '-01');
    const year = date.getFullYear();
    const week = d3.utcWeek.count(d3.utcYear(date), date);
    const weekKey = `${year}-W${String(week).padStart(2, '0')}`;

    if (!weeklyMap.has(weekKey)) {
      weeklyMap.set(weekKey, new Map());
    }

    const categoryMap = weeklyMap.get(weekKey)!;
    const current = categoryMap.get(item.category) || {
      amount: 0,
      qualifiers: createQualifierBreakdown(),
    };

    current.amount += item.amount;
    // Merge qualifiers
    Object.keys(item.qualifiers).forEach((key) => {
      const qualKey = key as keyof QualifierBreakdown;
      if (typeof item.qualifiers[qualKey] === 'number') {
        (current.qualifiers[qualKey] as number) += item.qualifiers[qualKey] as number;
      }
    });

    categoryMap.set(item.category, current);
  });

  // Convert back to array format
  const weeklyData: MonthlyData[] = [];
  weeklyMap.forEach((categoryMap, weekKey) => {
    categoryMap.forEach((data, category) => {
      weeklyData.push({
        month: weekKey,
        category,
        amount: data.amount,
        isIncome: data.amount > 0,
        qualifiers: data.qualifiers,
      });
    });
  });

  return weeklyData.sort((a, b) => a.month.localeCompare(b.month));
}

/**
 * Calculate indicator lines for each category's budget performance.
 * Returns data for actual spending, trailing average, and budget target lines.
 */
function calculateIndicatorLines(
  transactions: Transaction[],
  budgetPlan: BudgetPlan,
  visibleIndicators: readonly Category[],
  hiddenCategories: Set<Category>,
  showVacation: boolean
): {
  actualLines: { month: string; category: Category; amount: number }[];
  trailingLines: { month: string; category: Category; amount: number }[];
  targetLines: { month: string; category: Category; amount: number }[];
} {
  const actualLines: { month: string; category: Category; amount: number }[] = [];
  const trailingLines: { month: string; category: Category; amount: number }[] = [];
  const targetLines: { month: string; category: Category; amount: number }[] = [];

  // Only process visible indicators
  visibleIndicators.forEach((category) => {
    if (hiddenCategories.has(category)) return;

    const budget = budgetPlan.categoryBudgets[category];
    if (!budget) return;

    // Filter transactions for this category
    const categoryTransactions = transactions.filter(
      (t) =>
        t.category === category &&
        !t.transfer &&
        (showVacation || !t.vacation)
    );

    // Group by month and calculate actual spending
    const monthlyAmounts = new Map<string, number>();
    categoryTransactions.forEach((t) => {
      const month = t.date.substring(0, 7);
      const current = monthlyAmounts.get(month) || 0;
      monthlyAmounts.set(month, current + getDisplayAmount(t));
    });

    // Sort months
    const sortedMonths = Array.from(monthlyAmounts.keys()).sort();

    // Calculate lines for each month
    sortedMonths.forEach((month, idx) => {
      const amount = monthlyAmounts.get(month) || 0;

      // Actual spending line
      actualLines.push({ month, category, amount });

      // Budget target line (weekly target * ~4.33 weeks per month)
      const monthlyTarget = budget.weeklyTarget * 4.33;
      targetLines.push({ month, category, amount: monthlyTarget });

      // 3-period trailing average
      const start = Math.max(0, idx - 2);
      const slice = sortedMonths.slice(start, idx + 1);
      const values = slice.map((m) => monthlyAmounts.get(m) || 0);
      const avg = d3.mean(values) || 0;
      trailingLines.push({ month, category, amount: avg });
    });
  });

  return { actualLines, trailingLines, targetLines };
}

/**
 * Render monthly stacked bar chart with trend lines.
 * @returns Object containing plot element and partitioned data
 */
function renderMonthlyChart(
  container: HTMLElement,
  monthlyData: MonthlyData[],
  netIncomeData: { month: Date; netIncome: number }[],
  trailingAvgData: { month: Date; trailingAvg: number }[],
  indicatorLines: {
    actualLines: { month: string; category: Category; amount: number }[];
    trailingLines: { month: string; category: Category; amount: number }[];
    targetLines: { month: string; category: Category; amount: number }[];
  },
  showNetIncomeIndicator: boolean
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

      // Net income line (conditionally rendered)
      ...(showNetIncomeIndicator
        ? [
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
          ]
        : []),

      // Budget indicator lines for each visible category
      // Actual spending line (solid)
      ...(indicatorLines.actualLines.length > 0
        ? [
            Plot.line(indicatorLines.actualLines, {
              x: 'month',
              y: 'amount',
              z: 'category',
              stroke: (d) => CATEGORY_COLORS[d.category],
              strokeWidth: 2,
            }),
          ]
        : []),

      // Trailing average line (dashed)
      ...(indicatorLines.trailingLines.length > 0
        ? [
            Plot.line(indicatorLines.trailingLines, {
              x: 'month',
              y: 'amount',
              z: 'category',
              stroke: (d) => CATEGORY_COLORS[d.category],
              strokeWidth: 2,
              strokeDasharray: '5,5',
              strokeOpacity: 0.7,
            }),
          ]
        : []),

      // Budget target line (dotted)
      ...(indicatorLines.targetLines.length > 0
        ? [
            Plot.line(indicatorLines.targetLines, {
              x: 'month',
              y: 'amount',
              z: 'category',
              stroke: (d) => CATEGORY_COLORS[d.category],
              strokeWidth: 1.5,
              strokeDasharray: '2,3',
              strokeOpacity: 0.5,
            }),
          ]
        : []),
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
  // This can fail if:
  // - Observable Plot renders no data (empty chart)
  // - Plot version changes aria-label structure (see comment above)
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
  budgetPlan?: BudgetPlan | null;
  dateRangeStart?: string | null;
  dateRangeEnd?: string | null;
  barAggregation?: 'monthly' | 'weekly';
  visibleIndicators?: readonly Category[];
  showNetIncomeIndicator?: boolean;
}

export function BudgetChart({
  transactions,
  hiddenCategories,
  showVacation,
  budgetPlan = null,
  dateRangeStart = null,
  dateRangeEnd = null,
  barAggregation = 'monthly',
  visibleIndicators = [],
  showNetIncomeIndicator = true,
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

    // MONTHLY MODE
    // Data transformation
    let monthlyData: MonthlyData[];
    let netIncomeData: { month: Date; netIncome: number }[];
    let trailingAvgData: { month: Date; trailingAvg: number }[];

    try {
      ({ monthlyData, netIncomeData, trailingAvgData } = transformToMonthlyData(
        transactions,
        hiddenSet,
        showVacation,
        dateRangeStart,
        dateRangeEnd
      ));
    } catch (err) {
      console.error('Failed to transform monthly data:', err);
      setError('Failed to process transaction data for monthly view.');
      setLoading(false);
      return;
    }

    // Store monthlyData in ref for tooltip access
    monthlyDataRef.current = monthlyData;

    // Apply bar aggregation if weekly mode selected
    const displayData = barAggregation === 'weekly' ? transformToWeeklyBars(monthlyData) : monthlyData;

    // Calculate indicator lines if budget plan exists
    const indicatorLines = budgetPlan
      ? calculateIndicatorLines(transactions, budgetPlan, visibleIndicators, hiddenSet, showVacation)
      : { actualLines: [], trailingLines: [], targetLines: [] };

    // Chart rendering
    let plot: Element;
    let expenseData: MonthlyData[];
    let incomeData: MonthlyData[];
    try {
      containerRef.current.replaceChildren();
      const result = renderMonthlyChart(
        containerRef.current,
        displayData,
        netIncomeData,
        trailingAvgData,
        indicatorLines,
        showNetIncomeIndicator
      );
      plot = result.plot;
      expenseData = result.expenseData;
      incomeData = result.incomeData;
      containerRef.current.appendChild(plot);
    } catch (err) {
      console.error('Failed to render monthly chart:', err);
      setError('Failed to render chart visualization.');
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
  }, [transactions, hiddenCategories, showVacation, budgetPlan, dateRangeStart, dateRangeEnd, barAggregation, visibleIndicators, showNetIncomeIndicator]);

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

  const handleAggregationToggle = (aggregation: 'monthly' | 'weekly') => {
    dispatchBudgetEvent('budget:aggregation-toggle', { barAggregation: aggregation });
  };

  return (
    <div className="p-6 bg-bg-elevated rounded-lg shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-semibold text-text-primary">Budget Overview</h2>

        {/* Bar Aggregation Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => handleAggregationToggle('monthly')}
            className={`btn btn-sm ${barAggregation === 'monthly' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Monthly Bars
          </button>
          <button
            onClick={() => handleAggregationToggle('weekly')}
            className={`btn btn-sm ${barAggregation === 'weekly' ? 'btn-primary' : 'btn-ghost'}`}
          >
            Weekly Bars
          </button>
        </div>
      </div>

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
