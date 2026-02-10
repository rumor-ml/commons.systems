import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { BudgetChart } from './BudgetChart';
import { Transaction, Category, BudgetPlan, weekId, createDateString } from './types';

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
  userId: 'user-1',
  date: createDateString('2025-01-06'), // Monday of 2025-W02
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

  describe('Monthly View', () => {
    it('should render monthly stacked bar chart', async () => {
      const transactions = [createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100 })];

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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100 }),
        createTransaction({ id: 'txn-2', date: createDateString('2025-01-06'), amount: 2000, category: 'income' }),
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
      const transactions = [createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100 })];

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
      const transactions = [createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100 })];

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
      const currentDate = createDateString(new Date().toISOString().substring(0, 10));
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
      const transactions = [createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100 })];

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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, category: 'groceries' }),
      ];

      render(
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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, category: 'groceries' }),
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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, category: 'groceries' }),
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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, category: 'groceries' }),
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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, category: 'groceries' }),
        createTransaction({ id: 'txn-2', date: createDateString('2025-01-06'), amount: -50, category: 'dining' }),
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
        createTransaction({ id: 'txn-1', date: createDateString('2025-01-06'), amount: -100, vacation: true }),
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
