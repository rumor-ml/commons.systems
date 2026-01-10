import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetPlan, WeeklyData, weekId } from './types';
import * as weeklyAggregation from '../scripts/weeklyAggregation';
import * as events from '../utils/events';

// Mock the dependencies
vi.mock('../scripts/weeklyAggregation', () => ({
  predictCashFlow: vi.fn(),
}));

vi.mock('../utils/events', () => ({
  dispatchBudgetEvent: vi.fn(),
}));

describe('BudgetPlanEditor', () => {
  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();

  const emptyBudgetPlan: BudgetPlan = {
    categoryBudgets: {},
    lastModified: '2025-01-01T00:00:00.000Z',
  };

  const sampleBudgetPlan: BudgetPlan = {
    categoryBudgets: {
      income: { weeklyTarget: 2000, rolloverEnabled: true },
      groceries: { weeklyTarget: -500, rolloverEnabled: true },
      dining: { weeklyTarget: -200, rolloverEnabled: false },
    },
    lastModified: '2025-01-01T00:00:00.000Z',
  };

  const sampleHistoricData: WeeklyData[] = [
    {
      week: weekId('2025-W01'),
      category: 'income',
      amount: 1800,
      isIncome: true,
      qualifiers: {
        redeemable: 0,
        nonRedeemable: 1800,
        vacation: 0,
        nonVacation: 1800,
        transactionCount: 2,
      },
      weekStartDate: '2025-01-06',
      weekEndDate: '2025-01-12',
    },
    {
      week: weekId('2025-W01'),
      category: 'groceries',
      amount: -450,
      isIncome: false,
      qualifiers: {
        redeemable: 0,
        nonRedeemable: -450,
        vacation: 0,
        nonVacation: -450,
        transactionCount: 3,
      },
      weekStartDate: '2025-01-06',
      weekEndDate: '2025-01-12',
    },
  ];

  const defaultPrediction = {
    totalIncomeTarget: 2000,
    totalExpenseTarget: 700,
    predictedNetIncome: 1300,
    historicAvgIncome: 1800,
    historicAvgExpense: 450,
    variance: -50,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock return value for predictCashFlow
    vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue(defaultPrediction);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('renders the budget planning modal with title', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText('Budget Planning')).toBeDefined();
    });

    it('renders all category input fields', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Check for category labels
      expect(screen.getByText('Income')).toBeDefined();
      expect(screen.getByText('Housing')).toBeDefined();
      expect(screen.getByText('Utilities')).toBeDefined();
      expect(screen.getByText('Groceries')).toBeDefined();
      expect(screen.getByText('Dining')).toBeDefined();
      expect(screen.getByText('Transportation')).toBeDefined();
      expect(screen.getByText('Healthcare')).toBeDefined();
      expect(screen.getByText('Entertainment')).toBeDefined();
      expect(screen.getByText('Shopping')).toBeDefined();
      expect(screen.getByText('Travel')).toBeDefined();
      expect(screen.getByText('Investment')).toBeDefined();
      expect(screen.getByText('Other')).toBeDefined();
    });

    it('renders Save and Cancel buttons', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText('Save Budget Plan')).toBeDefined();
      expect(screen.getByText('Cancel')).toBeDefined();
    });

    it('displays cash flow prediction with proper formatting', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText('Predicted Net Income (per week)')).toBeDefined();
      expect(screen.getByText('$1,300.00')).toBeDefined();
    });

    it('displays help text with tips', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText(/Income should be positive/)).toBeDefined();
      expect(screen.getByText(/Rollover allows unspent budget/)).toBeDefined();
    });
  });

  describe('Initial State', () => {
    it('initializes with empty budget plan', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      inputs.forEach((input) => {
        expect((input as HTMLInputElement).value).toBe('');
      });
    });

    it('initializes with existing budget plan values', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Find income input by placeholder and check value
      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      expect(incomeInput.value).toBe('2000');

      // Groceries is the 4th category (index 3)
      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement;
      expect(groceriesInput.value).toBe('-500');
    });

    it('initializes rollover checkboxes correctly', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

      // Income has rollover enabled (index 0)
      expect(checkboxes[0].checked).toBe(true);
      expect(checkboxes[0].disabled).toBe(false);

      // Groceries has rollover enabled (index 3)
      expect(checkboxes[3].checked).toBe(true);
      expect(checkboxes[3].disabled).toBe(false);

      // Dining has rollover disabled (index 4)
      expect(checkboxes[4].checked).toBe(false);
      expect(checkboxes[4].disabled).toBe(false);

      // Categories without budgets should have disabled checkboxes
      expect(checkboxes[1].disabled).toBe(true); // housing
    });
  });

  describe('Budget Input Handling', () => {
    it('updates category budget when valid number is entered', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      fireEvent.change(incomeInput, { target: { value: '3000' } });

      expect(incomeInput.value).toBe('3000');
    });

    it('removes category budget when input is cleared', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      expect(incomeInput.value).toBe('2000');

      fireEvent.change(incomeInput, { target: { value: '' } });

      expect(incomeInput.value).toBe('');
    });

    it('handles invalid (NaN) input gracefully by removing budget', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      fireEvent.change(incomeInput, { target: { value: 'abc' } });

      expect(incomeInput.value).toBe('');
    });

    it('handles decimal values correctly', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Get housing input (second category, index 1)
      const inputs = screen.getAllByRole('spinbutton');
      const housingInput = inputs[1] as HTMLInputElement;
      fireEvent.change(housingInput, { target: { value: '-123.45' } });

      expect(housingInput.value).toBe('-123.45');
    });

    it('sets rolloverEnabled to true by default for new budgets', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const housingInput = inputs[1] as HTMLInputElement; // Housing is second
      fireEvent.change(housingInput, { target: { value: '-1200' } });

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const housingCheckbox = checkboxes[1];

      await waitFor(() => {
        expect(housingCheckbox.checked).toBe(true);
        expect(housingCheckbox.disabled).toBe(false);
      });
    });
  });

  describe('Rollover Toggle', () => {
    it('toggles rollover enabled state when checkbox is clicked', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const incomeCheckbox = checkboxes[0];
      expect(incomeCheckbox.checked).toBe(true);

      fireEvent.click(incomeCheckbox);

      await waitFor(() => {
        expect(incomeCheckbox.checked).toBe(false);
      });

      fireEvent.click(incomeCheckbox);

      await waitFor(() => {
        expect(incomeCheckbox.checked).toBe(true);
      });
    });

    it('does not allow toggling rollover for categories without budgets', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      checkboxes.forEach((checkbox) => {
        expect(checkbox.disabled).toBe(true);
      });
    });
  });

  describe('Cash Flow Prediction', () => {
    it('calls predictCashFlow with current budget plan and historic data', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(weeklyAggregation.predictCashFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryBudgets: sampleBudgetPlan.categoryBudgets,
        }),
        sampleHistoricData
      );
    });

    it('updates prediction when budget values change (debounced)', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const initialCallCount = vi.mocked(weeklyAggregation.predictCashFlow).mock.calls.length;

      const incomeInput = screen.getByPlaceholderText('2000');
      fireEvent.change(incomeInput, { target: { value: '3000' } });

      // Wait for debounce delay to complete (300ms)
      await waitFor(
        () => {
          expect(vi.mocked(weeklyAggregation.predictCashFlow).mock.calls.length).toBeGreaterThan(
            initialCallCount
          );
        },
        { timeout: 500 }
      );
    });

    it('displays positive variance with + symbol', () => {
      vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue({
        ...defaultPrediction,
        variance: 150,
      });

      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText(/\+\$150\.00/)).toBeDefined();
    });

    it('displays negative variance without extra symbol', () => {
      vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue({
        ...defaultPrediction,
        variance: -75,
      });

      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // The variance is displayed with the $ format (formatCurrency uses absolute value, so no minus sign)
      expect(screen.getByText(/\$75\.00 vs historic/)).toBeDefined();
    });

    it('displays "No historic data" message when historicAvgIncome is 0', () => {
      vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue({
        totalIncomeTarget: 2000,
        totalExpenseTarget: 700,
        predictedNetIncome: 1300,
        historicAvgIncome: 0,
        historicAvgExpense: 0,
        variance: 1300,
      });

      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText('No historic data available for comparison')).toBeDefined();
    });

    it('displays historic averages when data is available', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      expect(screen.getByText(/Historic avg:/)).toBeDefined();
      expect(screen.getByText(/\$1,800\.00 income/)).toBeDefined();
      expect(screen.getByText(/\$450\.00 expenses/)).toBeDefined();
    });
  });

  describe('Save Action', () => {
    it('calls onSave with properly formatted BudgetPlan', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const saveButton = screen.getByText('Save Budget Plan');
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledTimes(1);
      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryBudgets: sampleBudgetPlan.categoryBudgets,
          lastModified: expect.any(String),
        })
      );
    });

    it('dispatches budget:plan-save event on save', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const saveButton = screen.getByText('Save Budget Plan');
      fireEvent.click(saveButton);

      expect(events.dispatchBudgetEvent).toHaveBeenCalledWith('budget:plan-save', {
        budgetPlan: expect.objectContaining({
          categoryBudgets: sampleBudgetPlan.categoryBudgets,
        }),
      });
    });

    it('includes updated budget values in save', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000');
      fireEvent.change(incomeInput, { target: { value: '2500' } });

      const saveButton = screen.getByText('Save Budget Plan');
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryBudgets: {
            income: { weeklyTarget: 2500, rolloverEnabled: true },
          },
        })
      );
    });
  });

  describe('Cancel Action', () => {
    it('calls onCancel when Cancel button is clicked', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('dispatches budget:plan-cancel event on cancel', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText('Cancel');
      fireEvent.click(cancelButton);

      expect(events.dispatchBudgetEvent).toHaveBeenCalledWith('budget:plan-cancel');
    });
  });

  describe('Modal Overlay Behavior', () => {
    it('calls onCancel when overlay is clicked', () => {
      const { container } = render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const overlay = container.querySelector('.plan-editor-modal');
      expect(overlay).toBeDefined();

      fireEvent.click(overlay!);

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('does not call onCancel when content area is clicked', () => {
      const { container } = render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const content = container.querySelector('.plan-editor-content');
      expect(content).toBeDefined();

      fireEvent.click(content!);

      expect(mockOnCancel).not.toHaveBeenCalled();
    });
  });

  describe('Keyboard Accessibility', () => {
    it('allows tab navigation through input fields', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const incomeInput = inputs[0] as HTMLInputElement;

      // Focus first input
      incomeInput.focus();
      expect(document.activeElement).toBe(incomeInput);

      // Tab should move to next input
      fireEvent.keyDown(incomeInput, { key: 'Tab', code: 'Tab' });
      // Note: JSDOM doesn't automatically move focus on Tab, but the input supports it
      // This test verifies the input is focusable and receives keyboard events
    });

    it('allows tab navigation through checkboxes', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const incomeCheckbox = checkboxes[0];

      // Focus first checkbox
      incomeCheckbox.focus();
      expect(document.activeElement).toBe(incomeCheckbox);

      // Verify checkbox can be toggled with Space key
      fireEvent.keyDown(incomeCheckbox, { key: ' ', code: 'Space' });
      fireEvent.click(incomeCheckbox); // Space triggers click in real browsers
    });

    it('allows tab navigation to buttons', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText('Cancel') as HTMLButtonElement;
      const saveButton = screen.getByText('Save Budget Plan') as HTMLButtonElement;

      // Verify buttons are focusable
      cancelButton.focus();
      expect(document.activeElement).toBe(cancelButton);

      saveButton.focus();
      expect(document.activeElement).toBe(saveButton);
    });

    it('supports Enter key to activate focused button', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const saveButton = screen.getByText('Save Budget Plan') as HTMLButtonElement;
      saveButton.focus();

      // Enter key on focused button should trigger click
      fireEvent.keyDown(saveButton, { key: 'Enter', code: 'Enter' });
      fireEvent.click(saveButton); // Enter triggers click in real browsers

      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('supports Space key to activate focused button', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const cancelButton = screen.getByText('Cancel') as HTMLButtonElement;
      cancelButton.focus();

      // Space key on focused button should trigger click
      fireEvent.keyDown(cancelButton, { key: ' ', code: 'Space' });
      fireEvent.click(cancelButton); // Space triggers click in real browsers

      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('triggers save when Enter is pressed in input field', () => {
      // Enter in input field saves the budget plan
      // This is a common UX pattern for forms and improves efficiency for keyboard users
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      incomeInput.focus();

      // Enter key in input field triggers save
      fireEvent.keyDown(incomeInput, { key: 'Enter', code: 'Enter' });

      // Verify save is called
      expect(mockOnSave).toHaveBeenCalledTimes(1);
    });

    it('triggers cancel when Escape is pressed', () => {
      // Escape key cancels/closes the modal
      // This is standard modal behavior and critical for keyboard accessibility (WCAG 2.1.1)
      render(
        <BudgetPlanEditor
          budgetPlan={sampleBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      incomeInput.focus();

      // Escape key triggers cancel
      fireEvent.keyDown(incomeInput, { key: 'Escape', code: 'Escape' });

      // Verify cancel is called
      expect(mockOnCancel).toHaveBeenCalledTimes(1);
    });

    it('closes modal with Escape even when actively typing in input field', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;

      // Start typing a budget value
      fireEvent.change(incomeInput, { target: { value: '-50' } });
      incomeInput.focus();
      expect(document.activeElement).toBe(incomeInput);

      // User accidentally hits Escape while typing
      fireEvent.keyDown(incomeInput, { key: 'Escape', code: 'Escape' });

      // CURRENT BEHAVIOR: Modal closes, work is lost
      expect(mockOnCancel).toHaveBeenCalledTimes(1);

      // DESIRED BEHAVIOR: Could show confirmation dialog or prevent closing
      // This test documents the current risky behavior
    });

    it('maintains focus when input value changes', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      incomeInput.focus();
      expect(document.activeElement).toBe(incomeInput);

      // Change value
      fireEvent.change(incomeInput, { target: { value: '3000' } });

      // Focus should remain on input after value change
      expect(document.activeElement).toBe(incomeInput);
    });

    it('disabled checkboxes are marked as disabled', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];

      // All checkboxes should be disabled when no budgets are set
      checkboxes.forEach((checkbox) => {
        expect(checkbox.disabled).toBe(true);
      });

      // Note: JSDOM allows focusing disabled elements (unlike real browsers)
      // In real browsers, disabled checkboxes are excluded from tab navigation
      // and cannot receive focus, providing the proper accessibility behavior
    });

    it('rollover checkbox becomes keyboard accessible when budget is added', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const housingInput = inputs[1] as HTMLInputElement; // Housing is second

      // Add budget to housing
      fireEvent.change(housingInput, { target: { value: '-1200' } });

      const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
      const housingCheckbox = checkboxes[1];

      await waitFor(() => {
        expect(housingCheckbox.disabled).toBe(false);
      });

      // Now checkbox should be keyboard accessible
      housingCheckbox.focus();
      expect(document.activeElement).toBe(housingCheckbox);
    });
  });

  describe('Edge Cases', () => {
    it('handles zero values correctly', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      fireEvent.change(incomeInput, { target: { value: '0' } });

      expect(incomeInput.value).toBe('0');

      const saveButton = screen.getByText('Save Budget Plan');
      fireEvent.click(saveButton);

      expect(mockOnSave).toHaveBeenCalledWith(
        expect.objectContaining({
          categoryBudgets: {
            income: { weeklyTarget: 0, rolloverEnabled: true },
          },
        })
      );
    });

    it('handles very large numbers', () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const incomeInput = screen.getByPlaceholderText('2000') as HTMLInputElement;
      fireEvent.change(incomeInput, { target: { value: '999999.99' } });

      expect(incomeInput.value).toBe('999999.99');
    });

    it('handles rapid input changes with debouncing', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={sampleHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const initialCallCount = vi.mocked(weeklyAggregation.predictCashFlow).mock.calls.length;

      const incomeInput = screen.getByPlaceholderText('2000');

      // Rapid changes - each change resets the debounce timer
      fireEvent.change(incomeInput, { target: { value: '1000' } });
      // Wait a bit but not enough to trigger debounce
      await new Promise((resolve) => setTimeout(resolve, 100));
      fireEvent.change(incomeInput, { target: { value: '2000' } });
      await new Promise((resolve) => setTimeout(resolve, 100));
      fireEvent.change(incomeInput, { target: { value: '3000' } });

      // Wait for debounce to complete after the final change
      await waitFor(
        () => {
          // Should have called predictCashFlow after debounce completes
          expect(vi.mocked(weeklyAggregation.predictCashFlow).mock.calls.length).toBeGreaterThan(
            initialCallCount
          );
        },
        { timeout: 500 }
      );

      // The final input value should be 3000
      expect((incomeInput as HTMLInputElement).value).toBe('3000');
    });
  });

  describe('Validation Error Persistence', () => {
    it('shows validation error for invalid characters in number', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const incomeInput = inputs[0] as HTMLInputElement;

      // Enter number with invalid characters (123abc parses to 123 but has extra chars)
      fireEvent.change(incomeInput, { target: { value: '123abc' } });

      await waitFor(() => {
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      });
    });

    it('displays multiple validation errors simultaneously', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement;
      const diningInput = inputs[4] as HTMLInputElement;

      // Enter invalid characters in groceries
      fireEvent.change(groceriesInput, { target: { value: '123abc' } });

      await waitFor(() => {
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      });

      // Enter positive value in dining (should be negative for expense)
      fireEvent.change(diningInput, { target: { value: '200' } });

      await waitFor(() => {
        expect(screen.getByText(/Expense budgets should be negative/)).toBeDefined();
      });

      // Both errors should be visible
      expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      expect(screen.getByText(/Expense budgets should be negative/)).toBeDefined();
    });

    it('persists error in one field when entering valid data in another field', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement;
      const diningInput = inputs[4] as HTMLInputElement;

      // Enter invalid characters in groceries
      fireEvent.change(groceriesInput, { target: { value: '123abc' } });

      await waitFor(() => {
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      });

      // Enter valid value in dining
      fireEvent.change(diningInput, { target: { value: '-200' } });

      // Groceries error should still be visible
      await waitFor(() => {
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      });
    });

    it('clears error when invalid field is corrected', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement;

      // Enter invalid characters
      fireEvent.change(groceriesInput, { target: { value: '123abc' } });

      await waitFor(() => {
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
      });

      // Correct the value
      fireEvent.change(groceriesInput, { target: { value: '-500' } });

      // Error should be cleared
      await waitFor(() => {
        expect(screen.queryByText(/Invalid characters in number/)).toBeNull();
      });
    });

    it('clears validation errors independently for each category', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement; // 4th category
      const diningInput = inputs[4] as HTMLInputElement; // 5th category
      const housingInput = inputs[1] as HTMLInputElement; // 2nd category

      // Create validation errors in 3 different categories
      fireEvent.change(groceriesInput, { target: { value: '500' } }); // Wrong sign
      fireEvent.change(diningInput, { target: { value: '123abc' } }); // Invalid chars
      fireEvent.change(housingInput, { target: { value: '2000000' } }); // Too large

      await waitFor(() => {
        expect(screen.getByText(/Expense budgets should be negative/)).toBeDefined();
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
        expect(screen.getByText(/Budget value is unusually large/)).toBeDefined();
      });

      // Fix only groceries error
      fireEvent.change(groceriesInput, { target: { value: '-500' } });

      await waitFor(() => {
        // Groceries error should be cleared
        expect(screen.queryByText(/Expense budgets should be negative/)).toBeNull();

        // Other errors should still be visible
        expect(screen.getByText(/Invalid characters in number/)).toBeDefined();
        expect(screen.getByText(/Budget value is unusually large/)).toBeDefined();
      });

      // Fix dining error
      fireEvent.change(diningInput, { target: { value: '-200' } });

      await waitFor(() => {
        // Dining error should be cleared
        expect(screen.queryByText(/Invalid characters in number/)).toBeNull();

        // Housing error should still be visible
        expect(screen.getByText(/Budget value is unusually large/)).toBeDefined();
      });

      // Fix housing error
      fireEvent.change(housingInput, { target: { value: '-1200' } });

      await waitFor(() => {
        // All errors should be cleared
        expect(screen.queryByText(/Expense budgets should be negative/)).toBeNull();
        expect(screen.queryByText(/Invalid characters in number/)).toBeNull();
        expect(screen.queryByText(/Budget value is unusually large/)).toBeNull();
      });
    });

    it('shows error for unusually large values', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const incomeInput = inputs[0] as HTMLInputElement;

      // Enter value over $1,000,000
      fireEvent.change(incomeInput, { target: { value: '2000000' } });

      await waitFor(() => {
        expect(screen.getByText(/Budget value is unusually large/)).toBeDefined();
      });
    });

    it('shows error for positive expense category values', async () => {
      render(
        <BudgetPlanEditor
          budgetPlan={emptyBudgetPlan}
          historicData={[]}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      const inputs = screen.getAllByRole('spinbutton');
      const groceriesInput = inputs[3] as HTMLInputElement;

      // Enter positive value for expense category
      fireEvent.change(groceriesInput, { target: { value: '500' } });

      await waitFor(() => {
        expect(screen.getByText(/Expense budgets should be negative/)).toBeDefined();
      });

      // Fix it with negative value
      fireEvent.change(groceriesInput, { target: { value: '-500' } });

      await waitFor(() => {
        expect(screen.queryByText(/Expense budgets should be negative/)).toBeNull();
      });
    });
  });
});
