import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetPlan, WeeklyData } from './types';
import * as weeklyAggregation from '../scripts/weeklyAggregation';
import { StateManager } from '../scripts/state';
import * as currencyUtils from '../utils/currency';

// Mock dependencies
vi.mock('../scripts/weeklyAggregation', () => ({
  predictCashFlow: vi.fn(),
}));

vi.mock('../scripts/state', () => ({
  StateManager: {
    showErrorBanner: vi.fn(),
  },
}));

vi.mock('../utils/currency', () => ({
  formatCurrency: vi.fn((val: number) => val.toFixed(2)),
}));

vi.mock('../utils/events', () => ({
  dispatchBudgetEvent: vi.fn(),
}));

describe('BudgetPlanEditor', () => {
  const mockOnSave = vi.fn();
  const mockOnCancel = vi.fn();

  const defaultBudgetPlan: BudgetPlan = {
    categoryBudgets: {
      income: { weeklyTarget: 2000, rolloverEnabled: true },
      groceries: { weeklyTarget: -500, rolloverEnabled: true },
    },
    lastModified: '2024-01-01T00:00:00.000Z',
  };

  const defaultHistoricData: WeeklyData[] = [
    {
      weekId: '2024-W01',
      income: 2000,
      groceries: -450,
      dining: -200,
      shopping: -100,
      entertainment: -50,
      utilities: -150,
      transportation: -100,
      healthcare: -50,
      other: -50,
      vacation: 0,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Error Handling', () => {
    it('shows error banner and displays "Prediction Unavailable" when predictCashFlow throws', () => {
      // Mock predictCashFlow to throw an error
      const mockError = new Error('Invalid cash flow calculation: NaN detected');
      vi.mocked(weeklyAggregation.predictCashFlow).mockImplementation(() => {
        throw mockError;
      });

      // Render component
      render(
        <BudgetPlanEditor
          budgetPlan={defaultBudgetPlan}
          historicData={defaultHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Verify StateManager.showErrorBanner was called with correct error message
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Cash flow prediction unavailable')
      );
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Invalid cash flow calculation: NaN detected')
      );

      // Verify UI shows "Prediction Unavailable"
      expect(screen.getByText('Prediction Unavailable')).toBeInTheDocument();
      expect(
        screen.getByText('Cash flow prediction failed. Please check the error banner for details.')
      ).toBeInTheDocument();

      // Verify component doesn't crash (still renders the form)
      expect(screen.getByText('Budget Planning')).toBeInTheDocument();
      expect(screen.getByText('Predicted Net Income (per week)')).toBeInTheDocument();
    });

    it('handles non-Error thrown objects gracefully', () => {
      // Mock predictCashFlow to throw a non-Error object
      vi.mocked(weeklyAggregation.predictCashFlow).mockImplementation(() => {
        throw 'String error message';
      });

      // Render component
      render(
        <BudgetPlanEditor
          budgetPlan={defaultBudgetPlan}
          historicData={defaultHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Verify error handling still works
      expect(StateManager.showErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('String error message')
      );
      expect(screen.getByText('Prediction Unavailable')).toBeInTheDocument();
    });
  });

  describe('Normal Rendering', () => {
    it('displays prediction values correctly when predictCashFlow succeeds', () => {
      // Mock predictCashFlow to return valid prediction
      const mockPrediction = {
        predictedNetIncome: 850,
        totalIncomeTarget: 2000,
        totalExpenseTarget: -1150,
        historicAvgIncome: 2000,
        historicAvgExpense: -1100,
        variance: 50,
      };
      vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue(mockPrediction);

      // Render component
      render(
        <BudgetPlanEditor
          budgetPlan={defaultBudgetPlan}
          historicData={defaultHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Verify prediction values are displayed
      expect(screen.getByText('Budget Planning')).toBeInTheDocument();
      expect(screen.getByText('Predicted Net Income (per week)')).toBeInTheDocument();

      // Verify formatCurrency was called with prediction values
      expect(currencyUtils.formatCurrency).toHaveBeenCalledWith(850);
      expect(currencyUtils.formatCurrency).toHaveBeenCalledWith(2000);
      expect(currencyUtils.formatCurrency).toHaveBeenCalledWith(-1150);

      // Verify no error message is shown
      expect(screen.queryByText('Prediction Unavailable')).not.toBeInTheDocument();
    });

    it('renders category budget inputs correctly', () => {
      // Mock predictCashFlow to return valid prediction
      const mockPrediction = {
        predictedNetIncome: 850,
        totalIncomeTarget: 2000,
        totalExpenseTarget: -1150,
        historicAvgIncome: 2000,
        historicAvgExpense: -1100,
        variance: 50,
      };
      vi.mocked(weeklyAggregation.predictCashFlow).mockReturnValue(mockPrediction);

      // Render component
      render(
        <BudgetPlanEditor
          budgetPlan={defaultBudgetPlan}
          historicData={defaultHistoricData}
          onSave={mockOnSave}
          onCancel={mockOnCancel}
        />
      );

      // Verify category labels are rendered
      expect(screen.getByText('Income')).toBeInTheDocument();
      expect(screen.getByText('Groceries')).toBeInTheDocument();
      expect(screen.getByText('Dining')).toBeInTheDocument();

      // Verify action buttons are rendered
      expect(screen.getByText('Cancel')).toBeInTheDocument();
      expect(screen.getByText('Save Budget Plan')).toBeInTheDocument();
    });
  });
});
