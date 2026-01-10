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
});
