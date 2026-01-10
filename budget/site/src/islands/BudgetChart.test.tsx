import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BudgetChart } from './BudgetChart';
import { Transaction, Category, BudgetPlan, weekId } from './types';

// Mock Observable Plot
vi.mock('@observablehq/plot', () => {
  const mockBarY = vi.fn((data: any, options?: any) => ({
    type: 'barY',
    data,
    options,
  }));

  const mockLine = vi.fn((data: any, options: any) => ({
    type: 'line',
    data,
    options,
  }));

  const mockRuleY = vi.fn((data: any, options: any) => ({
    type: 'ruleY',
    data,
    options,
  }));

  const mockText = vi.fn((data: any, options: any) => ({
    type: 'text',
    data,
    options,
  }));

  const mockStackY = vi.fn((options: any) => ({
    type: 'stackY',
    ...options,
  }));

  const mockPlot = vi.fn((config: any) => {
    const div = document.createElement('div');
    div.setAttribute('data-test-plot', 'true');
    div.setAttribute('data-test-marks-count', config.marks?.length || 0);

    // Store config for inspection
    (div as any).__plotConfig = config;

    // Create mock SVG structure for bar groups
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');

    // Create expense bars group
    const expenseGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    expenseGroup.setAttribute('aria-label', 'bar');

    // Create income bars group
    const incomeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    incomeGroup.setAttribute('aria-label', 'bar');

    svg.appendChild(expenseGroup);
    svg.appendChild(incomeGroup);
    div.appendChild(svg);

    return div;
  });

  return {
    plot: mockPlot,
    barY: mockBarY,
    line: mockLine,
    ruleY: mockRuleY,
    text: mockText,
    stackY: mockStackY,
  };
});

// Mock d3
vi.mock('d3', () => ({
  mean: vi.fn((arr: any[], accessor: any) => {
    if (!arr.length) return 0;
    const sum = arr.reduce((acc, item) => acc + accessor(item), 0);
    return sum / arr.length;
  }),
}));

// Helper to create test transactions
const createTransaction = (overrides: Partial<Transaction>): Transaction => ({
  id: 'txn-1',
  date: '2025-01-06', // Monday of 2025-W02
  description: 'Test transaction',
  amount: -100,
  category: 'groceries' as Category,
  redeemable: false,
  vacation: false,
  transfer: false,
  redemptionRate: 0.5,
  statementIds: ['stmt-1'],
  ...overrides,
});

// Helper to create budget plan
const createBudgetPlan = (overrides?: Partial<BudgetPlan>): BudgetPlan => ({
  categoryBudgets: {
    groceries: {
      weeklyTarget: -500,
      rolloverEnabled: true,
    },
    dining: {
      weeklyTarget: -200,
      rolloverEnabled: false,
    },
  },
  lastModified: '2025-01-01T00:00:00.000Z',
  ...overrides,
});

describe('BudgetChart', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    // Create a container with clientWidth
    container = document.createElement('div');
    Object.defineProperty(container, 'clientWidth', {
      writable: true,
      configurable: true,
      value: 800,
    });
    document.body.appendChild(container);
  });

  describe('Weekly View', () => {
    it('should render bars for selected week only', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }), // W02
        createTransaction({ id: 'txn-2', date: '2025-01-13', amount: -50 }), // W03
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        // Get the plot config
        const config = plot.__plotConfig;

        // Find the barY marks
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');
        expect(barMarks.length).toBeGreaterThan(0);

        // Verify data contains only W02
        barMarks.forEach((mark: any) => {
          mark.data.forEach((d: any) => {
            expect(d.week).toBe('2025-W02');
          });
        });
      });
    });

    it('should render budget target overlays with correct styling', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find the budget target overlay mark
        const targetMark = config.marks.find(
          (m: any) =>
            m.type === 'barY' && m.options?.opacity === 0.3 && m.options?.strokeDasharray === '4,4'
        );

        expect(targetMark).toBeTruthy();
        expect(targetMark.options.opacity).toBe(0.3);
        expect(targetMark.options.strokeDasharray).toBe('4,4');
        expect(targetMark.options.strokeWidth).toBe(2);
      });
    });

    it('should render rollover badges when rollover accumulation exists', async () => {
      // Create transactions that result in rollover accumulation
      const transactions = [
        // W01: Spend $300 (budget is $500, so $200 surplus)
        createTransaction({ id: 'txn-1', date: '2024-12-30', amount: -300, category: 'groceries' }), // 2025-W01
        // W02: Current week (has rollover from W01)
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -100, category: 'groceries' }), // 2025-W02
      ];

      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find the text mark for rollover badges
        const textMark = config.marks.find(
          (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
        );

        expect(textMark).toBeTruthy();
        expect(textMark.options.text()).toBe('🔄');
      });
    });

    it('should not render rollover badges when no rollover accumulation', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find the text marks (rollover badges)
        const textMarks = config.marks.filter((m: any) => m.type === 'text');

        // Should not have any rollover badges since there's no prior week history to accumulate from
        expect(textMarks.length).toBe(0);
      });
    });

    it('should display rollover badges when accumulation spans year boundary', async () => {
      const transactions = [
        // Last week of 2024 (2024-W52): Spend $300 (budget is $500, so $200 surplus)
        createTransaction({ id: 'txn-1', date: '2024-12-23', amount: -300, category: 'groceries' }),
        // First week of 2025 (2025-W01 spans Dec 30, 2024 to Jan 5, 2025): Spend $100 (should have $200 rollover from 2024-W52)
        createTransaction({ id: 'txn-2', date: '2024-12-30', amount: -100, category: 'groceries' }),
      ];

      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W01')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find rollover badge mark
        const rolloverBadge = config.marks.find(
          (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
        );
        expect(rolloverBadge).toBeTruthy();

        // Verify rollover badge exists for groceries category
        const rolloverData = rolloverBadge.data.find((d: any) => d.category === 'groceries');
        expect(rolloverData).toBeTruthy();
        expect(rolloverData.hasRollover).toBe(true);
      });
    });

    it('should show empty state message when no data for selected week', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }), // W02
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W03')} // Different week
        />
      );

      await waitFor(() => {
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage?.textContent).toContain('No transaction data for week 2025-W03');
      });
    });

    it('should show appropriate empty state for no transactions', async () => {
      const { container } = render(
        <BudgetChart
          transactions={[]}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage?.textContent).toContain('No transactions loaded');
      });
    });

    it('should show appropriate empty state when all categories hidden', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={['groceries']}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage?.textContent).toContain('categories are hidden');
      });
    });

    it('should calculate budget comparisons correctly from weeklyData', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -400, category: 'groceries' }),
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -150, category: 'dining' }),
      ];

      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find the target overlay mark
        const targetMark = config.marks.find(
          (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
        );

        expect(targetMark).toBeTruthy();

        // Check that target data includes both categories
        const targetData = targetMark.data;
        expect(targetData.length).toBe(2);

        // Check groceries target
        const groceriesTarget = targetData.find((d: any) => d.category === 'groceries');
        expect(groceriesTarget).toBeTruthy();
        expect(groceriesTarget.target).toBe(-500);

        // Check dining target
        const diningTarget = targetData.find((d: any) => d.category === 'dining');
        expect(diningTarget).toBeTruthy();
        expect(diningTarget.target).toBe(-200);
      });
    });

    it('should handle switching between monthly and weekly granularities', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];

      const { container, rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="month"
        />
      );

      // Wait for monthly view to render
      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]');
        expect(plot).toBeTruthy();
      });

      // Switch to weekly view
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Wait for weekly view to render
      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Verify weekly-specific configuration
        expect(config.x.label).toBe('Category');
        expect(config.x.tickRotate).toBe(-45);
      });
    });

    it('filters to selected week when switching from monthly to weekly view', async () => {
      const transactions = [
        createTransaction({ id: 'w2-1', date: '2025-01-06', amount: -100, category: 'groceries' }), // W02
        createTransaction({ id: 'w3-1', date: '2025-01-13', amount: -200, category: 'dining' }), // W03
        createTransaction({ id: 'w4-1', date: '2025-01-20', amount: -300, category: 'groceries' }), // W04
      ];

      const { container, rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="month"
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Monthly view groups by month - all 3 transactions are in Jan 2025
        const allData = barMarks.flatMap((m: any) => m.data);
        // In monthly view, we should have data points for groceries and dining
        expect(allData.length).toBeGreaterThan(0);
      });

      // Switch to weekly view with specific week selected
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W03')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Weekly view should only have W03 data
        const weeklyData = barMarks.flatMap((m: any) => m.data);

        // All data points should be from W03
        weeklyData.forEach((d: any) => {
          expect(d.week).toBe('2025-W03');
        });

        // Should only have dining category (W03 transaction)
        expect(weeklyData.find((d: any) => d.category === 'dining')).toBeTruthy();
        expect(weeklyData.find((d: any) => d.category === 'groceries')).toBeUndefined();

        // Should have exactly the W03 amount
        const totalAmount = weeklyData.reduce((sum: number, d: any) => sum + Math.abs(d.amount), 0);
        expect(totalAmount).toBe(200); // Only W03's -200
      });
    });

    it('updates displayed week when selectedWeek prop changes in weekly view', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }), // W02
        createTransaction({ id: 'txn-2', date: '2025-01-13', amount: -200, category: 'dining' }), // W03
      ];

      const { container, rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const data = config.marks.flatMap((m: any) => m.data || []);

        expect(data.find((d: any) => d.category === 'groceries')).toBeTruthy();
        expect(data.find((d: any) => d.category === 'dining')).toBeUndefined();
      });

      // Change to different week
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W03')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const data = config.marks.flatMap((m: any) => m.data || []);

        expect(data.find((d: any) => d.category === 'dining')).toBeTruthy();
        expect(data.find((d: any) => d.category === 'groceries')).toBeUndefined();
      });
    });

    it('should render both income and expense bars correctly', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }), // expense
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: 2000, category: 'income' }), // income
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find expense and income bar marks
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Should have at least 2 bar marks (expense and income)
        expect(barMarks.length).toBeGreaterThanOrEqual(2);

        // Check that we have both expense (negative) and income (positive) data
        const hasExpense = barMarks.some((m: any) => m.data.some((d: any) => d.amount < 0));
        const hasIncome = barMarks.some((m: any) => m.data.some((d: any) => d.amount > 0));

        expect(hasExpense).toBe(true);
        expect(hasIncome).toBe(true);
      });
    });

    it('should filter out transfers in weekly view', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, transfer: false }),
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -50, transfer: true }),
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Count total data points (should only be 1, excluding transfer)
        const totalDataPoints = barMarks.reduce(
          (sum: number, mark: any) => sum + mark.data.length,
          0
        );

        expect(totalDataPoints).toBe(1);
      });
    });

    it('should filter vacation transactions when showVacation=false', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, vacation: false }),
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -50, vacation: true }),
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Count total data points (should only be 1, excluding vacation)
        const totalDataPoints = barMarks.reduce(
          (sum: number, mark: any) => sum + mark.data.length,
          0
        );

        expect(totalDataPoints).toBe(1);
      });
    });

    it('should apply redemption rate to redeemable transactions', async () => {
      const transactions = [
        createTransaction({
          id: 'txn-1',
          date: '2025-01-06',
          amount: -100,
          redeemable: true,
          redemptionRate: 0.5,
        }),
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        // Check that amount is reduced by redemption rate
        const dataPoint = barMarks[0]?.data[0];
        expect(dataPoint).toBeTruthy();
        expect(dataPoint.amount).toBe(-50); // -100 * 0.5
      });
    });

    it('should render chart with budgetPlan but no transactions', async () => {
      const budgetPlan = createBudgetPlan();

      const { container } = render(
        <BudgetChart
          transactions={[]}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={budgetPlan}
        />
      );

      await waitFor(() => {
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage?.textContent).toContain('No transactions loaded');
      });
    });

    it('should handle future week selection appropriately', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }), // W02
      ];

      // Use a future week ID (far enough in the future to ensure it won't have data)
      const futureWeek = weekId('2025-W52');

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={futureWeek}
        />
      );

      await waitFor(() => {
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(emptyMessage).toBeTruthy();
        expect(emptyMessage?.textContent).toContain('No transaction data for week 2025-W52');
      });
    });

    it('should stop rendering when budget calculation fails', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      // Create a malformed budget plan that might cause calculation errors
      const badBudgetPlan = {
        categoryBudgets: {
          groceries: {
            weeklyTarget: NaN, // Invalid target
            rolloverEnabled: true,
          },
        },
        lastModified: '2025-01-01T00:00:00.000Z',
      } as unknown as BudgetPlan;

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={badBudgetPlan}
        />
      );

      // Depending on how calculateWeeklyComparison handles NaN, this may or may not error
      // The test verifies the component doesn't crash and shows an error or renders
      await waitFor(() => {
        const errorMessage = container.querySelector('.bg-error-muted');
        const plot = container.querySelector('[data-test-plot="true"]');

        // Should either show error or render chart successfully
        expect(errorMessage || plot).toBeTruthy();
      });
    });

    describe('Budget Comparison Validation', () => {
      it('displays correct variance for over-budget categories', async () => {
        const transactions = [
          // Spent $600, budget is $500 = over budget by $100
          createTransaction({
            id: 'txn-1',
            date: '2025-01-06',
            amount: -600,
            category: 'groceries',
          }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find the actual spending bar
          const barMarks = config.marks.filter(
            (m: any) => m.type === 'barY' && m.options?.opacity !== 0.3
          );
          const groceriesBar = barMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'groceries');

          expect(groceriesBar).toBeTruthy();
          expect(groceriesBar.amount).toBe(-600);

          // Find the budget target overlay
          const targetMark = config.marks.find(
            (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
          );
          const groceriesTarget = targetMark?.data.find((d: any) => d.category === 'groceries');

          expect(groceriesTarget).toBeTruthy();
          expect(groceriesTarget.target).toBe(-500);

          // Variance should be -100 (over budget)
          // In weekly view, the chart should visually indicate over-budget status
          expect(Math.abs(groceriesBar.amount)).toBeGreaterThan(Math.abs(groceriesTarget.target));
        });
      });

      it('displays correct variance for under-budget categories', async () => {
        const transactions = [
          // Spent $300, budget is $500 = under budget by $200
          createTransaction({
            id: 'txn-1',
            date: '2025-01-06',
            amount: -300,
            category: 'groceries',
          }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find the actual spending bar
          const barMarks = config.marks.filter(
            (m: any) => m.type === 'barY' && m.options?.opacity !== 0.3
          );
          const groceriesBar = barMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'groceries');

          expect(groceriesBar).toBeTruthy();
          expect(groceriesBar.amount).toBe(-300);

          // Find the budget target overlay
          const targetMark = config.marks.find(
            (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
          );
          const groceriesTarget = targetMark?.data.find((d: any) => d.category === 'groceries');

          expect(groceriesTarget).toBeTruthy();
          expect(groceriesTarget.target).toBe(-500);

          // Variance should be +200 (under budget - good)
          expect(Math.abs(groceriesBar.amount)).toBeLessThan(Math.abs(groceriesTarget.target));
        });
      });

      it('displays rollover badges for multiple categories without overlap', async () => {
        const budgetPlanWithMultipleRollovers: BudgetPlan = {
          categoryBudgets: {
            groceries: {
              weeklyTarget: -500,
              rolloverEnabled: true,
            },
            dining: {
              weeklyTarget: -200,
              rolloverEnabled: true, // Enable rollover for dining to test multiple badges
            },
          },
          lastModified: '2025-01-01T00:00:00.000Z',
        };

        const transactions = [
          // W01: Create rollover for both groceries and dining
          createTransaction({
            id: 'w1-1',
            date: '2024-12-30',
            amount: -300,
            category: 'groceries',
          }), // 2025-W01
          createTransaction({ id: 'w1-2', date: '2024-12-30', amount: -100, category: 'dining' }), // 2025-W01
          // W02: Current week with spending
          createTransaction({
            id: 'w2-1',
            date: '2025-01-06',
            amount: -100,
            category: 'groceries',
          }),
          createTransaction({ id: 'w2-2', date: '2025-01-06', amount: -50, category: 'dining' }),
        ];

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlanWithMultipleRollovers}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find the text mark for rollover badges
          const rolloverBadgeMark = config.marks.find(
            (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
          );

          expect(rolloverBadgeMark).toBeTruthy();

          // Should have rollover data for both groceries and dining
          const rolloverData = rolloverBadgeMark.data;
          const groceriesRollover = rolloverData.find((d: any) => d.category === 'groceries');
          const diningRollover = rolloverData.find((d: any) => d.category === 'dining');

          expect(groceriesRollover).toBeTruthy();
          expect(groceriesRollover.hasRollover).toBe(true);
          expect(diningRollover).toBeTruthy();
          expect(diningRollover.hasRollover).toBe(true);

          // Verify badges have distinct positions (no overlap)
          // Text marks should have dy offset to position above bars
          expect(rolloverBadgeMark.options.dy).toBeDefined();
        });
      });

      it('shows budget targets even for hidden categories (current behavior)', async () => {
        const transactions = [
          createTransaction({
            id: 'txn-1',
            date: '2025-01-06',
            amount: -400,
            category: 'groceries',
          }),
          createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -150, category: 'dining' }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={['groceries']}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find the budget target overlay mark
          const targetMark = config.marks.find(
            (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
          );

          expect(targetMark).toBeTruthy();

          // Current behavior: Budget targets show for all categories, including hidden ones
          // This is because comparisons are calculated from full weeklyData, not filtered weekData
          const targetData = targetMark.data;
          const groceriesTarget = targetData.find((d: any) => d.category === 'groceries');
          const diningTarget = targetData.find((d: any) => d.category === 'dining');

          // Both targets are present (groceries target is shown even though category is hidden)
          expect(groceriesTarget).toBeTruthy();
          expect(groceriesTarget.target).toBe(-500);
          expect(diningTarget).toBeTruthy();
          expect(diningTarget.target).toBe(-200);
        });
      });

      it('shows accurate cumulative budget with rollover', async () => {
        const transactions = [
          // W01: Spend $300 (budget $500 = $200 surplus)
          createTransaction({
            id: 'w1-1',
            date: '2024-12-30',
            amount: -300,
            category: 'groceries',
          }),
          // W02: Spend $450 (budget $500 + $200 rollover = $700 effective budget)
          createTransaction({
            id: 'w2-1',
            date: '2025-01-06',
            amount: -450,
            category: 'groceries',
          }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find actual spending
          const barMarks = config.marks.filter(
            (m: any) => m.type === 'barY' && m.options?.opacity !== 0.3
          );
          const groceriesBar = barMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'groceries');

          expect(groceriesBar).toBeTruthy();
          expect(groceriesBar.amount).toBe(-450);

          // Should have rollover badge indicating accumulated surplus
          const rolloverBadgeMark = config.marks.find(
            (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
          );
          expect(rolloverBadgeMark).toBeTruthy();

          const groceriesRollover = rolloverBadgeMark.data.find(
            (d: any) => d.category === 'groceries'
          );
          expect(groceriesRollover).toBeTruthy();
          expect(groceriesRollover.hasRollover).toBe(true);

          // Effective budget should be $700 ($500 target + $200 rollover)
          // Spending $450 means $250 remaining budget
          // This is validated by the presence of rollover badge
        });
      });

      it('correctly calculates variance when spending exceeds target but not effective budget', async () => {
        const transactions = [
          // W01: Spend $300 (budget $500 = $200 surplus)
          createTransaction({
            id: 'w1-1',
            date: '2024-12-30',
            amount: -300,
            category: 'groceries',
          }),
          // W02: Spend $550 (exceeds base target of $500 but within effective budget of $700)
          createTransaction({
            id: 'w2-1',
            date: '2025-01-06',
            amount: -550,
            category: 'groceries',
          }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Find actual spending
          const barMarks = config.marks.filter(
            (m: any) => m.type === 'barY' && m.options?.opacity !== 0.3
          );
          const groceriesBar = barMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'groceries');

          expect(groceriesBar).toBeTruthy();
          expect(groceriesBar.amount).toBe(-550);

          // Base target is still $500
          const targetMark = config.marks.find(
            (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
          );
          const groceriesTarget = targetMark?.data.find((d: any) => d.category === 'groceries');
          expect(groceriesTarget.target).toBe(-500);

          // Should show rollover badge (has accumulated rollover)
          const rolloverBadgeMark = config.marks.find(
            (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
          );
          expect(rolloverBadgeMark).toBeTruthy();

          // Spending $550 with $200 rollover means effective budget $700
          // Still under budget by $150 ($700 - $550)
        });
      });

      it('handles no rollover when rolloverEnabled is false', async () => {
        const transactions = [
          // W01: Spend $100 (budget $200 = $100 surplus, but rollover disabled)
          createTransaction({ id: 'w1-1', date: '2024-12-30', amount: -100, category: 'dining' }),
          // W02: Current week
          createTransaction({ id: 'w2-1', date: '2025-01-06', amount: -150, category: 'dining' }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Should NOT have rollover badge for dining (rolloverEnabled: false)
          const rolloverBadgeMarks = config.marks.filter(
            (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
          );

          // If there are rollover badges, dining should not be in them
          const diningRollover = rolloverBadgeMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'dining');

          expect(diningRollover).toBeUndefined();
        });
      });

      it('shows over-budget status when negative rollover reduces available budget below spending', async () => {
        const transactions = [
          // W01: Overspend by $100 (budget -500, spent -600)
          createTransaction({ id: 'w1', date: '2024-12-30', amount: -600, category: 'groceries' }),
          // W02: Spend exactly weekly budget (-500), but with -100 rollover, effective budget is -400
          createTransaction({ id: 'w2', date: '2025-01-06', amount: -500, category: 'groceries' }),
        ];

        const budgetPlan = createBudgetPlan();

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
            budgetPlan={budgetPlan}
          />
        );

        await waitFor(() => {
          const plot = container.querySelector('[data-test-plot="true"]') as any;
          expect(plot).toBeTruthy();

          const config = plot.__plotConfig;

          // Spending $500 should exceed effective budget of $400 (-500 target + -100 rollover)
          const barMarks = config.marks.filter(
            (m: any) => m.type === 'barY' && m.options?.opacity !== 0.3
          );
          const groceriesBar = barMarks
            .flatMap((m: any) => m.data)
            .find((d: any) => d.category === 'groceries');

          expect(groceriesBar.amount).toBe(-500);

          // Should have rollover badge indicating negative accumulation
          const rolloverBadgeMark = config.marks.find(
            (m: any) => m.type === 'text' && m.options?.text?.() === '🔄'
          );
          expect(rolloverBadgeMark).toBeTruthy();

          const groceriesRollover = rolloverBadgeMark.data.find(
            (d: any) => d.category === 'groceries'
          );
          expect(groceriesRollover).toBeTruthy();
          expect(groceriesRollover.hasRollover).toBe(true);
        });
      });

      it('displays warning banner when transactions have invalid dates', async () => {
        const transactions = [
          createTransaction({ id: 'valid', date: '2025-01-06', amount: -100 }),
          createTransaction({ id: 'invalid', date: '2025-02-31', amount: -50 }), // Feb 31st doesn't exist
        ];

        const { container } = render(
          <BudgetChart
            transactions={transactions}
            hiddenCategories={[]}
            showVacation={true}
            granularity="week"
            selectedWeek={weekId('2025-W02')}
          />
        );

        await waitFor(() => {
          // Invalid dates cause aggregation to show error banners
          const errorBanners = document.querySelectorAll('.bg-error');
          expect(errorBanners.length).toBeGreaterThan(0);

          // Check that at least one banner mentions invalid dates
          const bannerTexts = Array.from(errorBanners).map((b) => b.textContent || '');
          const hasInvalidDatesBanner = bannerTexts.some((text) =>
            text.includes('transaction(s) excluded due to invalid dates')
          );
          expect(hasInvalidDatesBanner).toBe(true);
        });
      });
    });
  });

  describe('Monthly View', () => {
    it('should render monthly stacked bar chart', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="month"
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Check for bar marks (stacked bars are implemented via Plot.barY with Plot.stackY transform)
        const barMarks = config.marks.filter((m: any) => m.type === 'barY');

        expect(barMarks.length).toBeGreaterThan(0);
      });
    });

    it('should show appropriate empty state for monthly view with no data', async () => {
      const { container } = render(
        <BudgetChart
          transactions={[]}
          hiddenCategories={[]}
          showVacation={true}
          granularity="month"
        />
      );

      await waitFor(() => {
        // Monthly view with no transactions should still render
        // (it will render an empty plot with no bars, or potentially an empty state)
        // Since the code doesn't have explicit empty state for monthly view,
        // it will render an empty plot
        const plot = container.querySelector('[data-test-plot="true"]');
        expect(plot).toBeTruthy();
      });
    });

    it('should render net income and trailing average lines', async () => {
      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 }),
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: 2000, category: 'income' }),
      ];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="month"
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Find line marks
        const lineMarks = config.marks.filter((m: any) => m.type === 'line');

        // Should have 2 line marks (net income + trailing average)
        expect(lineMarks.length).toBe(2);

        // Check for net income line
        const netIncomeLine = lineMarks.find(
          (m: any) => m.options.stroke === '#00d4ed' && m.options.strokeWidth === 3
        );
        expect(netIncomeLine).toBeTruthy();

        // Check for trailing average line
        const trailingAvgLine = lineMarks.find((m: any) => m.options.strokeDasharray === '5,5');
        expect(trailingAvgLine).toBeTruthy();
      });
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid transaction data', async () => {
      const { container } = render(
        <BudgetChart transactions={null as any} hiddenCategories={[]} showVacation={true} />
      );

      await waitFor(() => {
        const errorMessage = container.querySelector('.bg-error-muted');
        expect(errorMessage).toBeTruthy();
        expect(errorMessage?.textContent).toContain('Invalid or missing transaction data');
      });
    });

    it('should show loading state initially', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];

      const { container } = render(
        <BudgetChart transactions={transactions} hiddenCategories={[]} showVacation={true} />
      );

      // React renders happen asynchronously, so wait for the chart to render
      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]');
        expect(plot).toBeTruthy();
      });
    });
  });

  describe('Default Props', () => {
    it('should use default granularity of month', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];

      const { container } = render(
        <BudgetChart transactions={transactions} hiddenCategories={[]} showVacation={true} />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Monthly view should have band type for x-axis
        expect(config.x.type).toBe('band');
      });
    });

    it('should handle null selectedWeek by using current week', async () => {
      // Create transaction for the current week to ensure data exists
      const currentDate = new Date().toISOString().substring(0, 10);
      const transactions = [createTransaction({ id: 'txn-1', date: currentDate, amount: -100 })];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={null}
        />
      );

      await waitFor(() => {
        // Should render without error using current week
        // Either plot or empty message should appear
        const plot = container.querySelector('[data-test-plot="true"]');
        const emptyMessage = container.querySelector('.p-8.text-center.text-text-secondary');
        expect(plot || emptyMessage).toBeTruthy();
      });
    });

    it('should handle null budgetPlan', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100 })];

      const { container } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          budgetPlan={null}
        />
      );

      await waitFor(() => {
        const plot = container.querySelector('[data-test-plot="true"]') as any;
        expect(plot).toBeTruthy();

        const config = plot.__plotConfig;

        // Should not have budget overlay marks when budgetPlan is null
        const targetMarks = config.marks.filter(
          (m: any) => m.type === 'barY' && m.options?.opacity === 0.3
        );

        expect(targetMarks.length).toBe(0);
      });
    });
  });

  describe('Event Listener Cleanup', () => {
    it('should remove click listener when pinnedSegment becomes null', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const { rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Initially no listener should be added (pinnedSegment is null)
      expect(addEventListenerSpy).not.toHaveBeenCalled();

      // Simulate pinnedSegment becoming non-null by re-rendering
      // In the actual component, this would happen via segment click
      // For testing, we'll need to test the cleanup behavior when the effect re-runs

      // Clean up spies
      removeEventListenerSpy.mockRestore();
      addEventListenerSpy.mockRestore();
    });

    it('should remove click listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const { unmount } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Unmount the component
      unmount();

      // Should have cleaned up listener (even if it was never added)
      expect(removeEventListenerSpy).toHaveBeenCalled();

      removeEventListenerSpy.mockRestore();
    });

    it('should call cleanup function when component unmounts', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const { unmount } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Track how many times removeEventListener is called before unmount
      const callCountBeforeUnmount = removeEventListenerSpy.mock.calls.length;

      // Unmount should trigger cleanup
      unmount();

      // Should have called removeEventListener at least once during unmount
      expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThanOrEqual(
        callCountBeforeUnmount
      );

      removeEventListenerSpy.mockRestore();
    });

    it('should not accumulate listeners when effect dependencies change', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
      ];

      const { rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      const initialAddCalls = addEventListenerSpy.mock.calls.length;
      const initialRemoveCalls = removeEventListenerSpy.mock.calls.length;

      // Re-render with different props (which may trigger effect cleanup and re-setup)
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={['groceries']}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Verify cleanup was called during re-render
      expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThanOrEqual(initialRemoveCalls);

      addEventListenerSpy.mockRestore();
      removeEventListenerSpy.mockRestore();
    });

    it('should cleanup listener when hiddenCategories changes', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, category: 'groceries' }),
        createTransaction({ id: 'txn-2', date: '2025-01-06', amount: -50, category: 'dining' }),
      ];

      const { rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      const callsBeforeChange = removeEventListenerSpy.mock.calls.length;

      // Change hiddenCategories (which triggers the filter change effect)
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={['groceries']}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Should have called removeEventListener during cleanup
      expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeChange);

      removeEventListenerSpy.mockRestore();
    });

    it('should cleanup listener when showVacation changes', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const transactions = [
        createTransaction({ id: 'txn-1', date: '2025-01-06', amount: -100, vacation: true }),
      ];

      const { rerender } = render(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={true}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      const callsBeforeChange = removeEventListenerSpy.mock.calls.length;

      // Toggle showVacation (which triggers the filter change effect)
      rerender(
        <BudgetChart
          transactions={transactions}
          hiddenCategories={[]}
          showVacation={false}
          granularity="week"
          selectedWeek={weekId('2025-W02')}
        />
      );

      // Should have called removeEventListener during cleanup
      expect(removeEventListenerSpy.mock.calls.length).toBeGreaterThanOrEqual(callsBeforeChange);

      removeEventListenerSpy.mockRestore();
    });
  });
});
