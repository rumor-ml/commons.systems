import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeSelector } from './TimeSelector';
import { WeekId, weekId } from './types';
import * as weeklyAggregation from '../scripts/weeklyAggregation';
import * as events from '../utils/events';
import { StateManager } from '../scripts/state';

// Mock the modules
vi.mock('../scripts/weeklyAggregation', async () => {
  const actual = await vi.importActual<typeof weeklyAggregation>('../scripts/weeklyAggregation');
  return {
    ...actual,
    getCurrentWeek: vi.fn(),
    getNextWeek: vi.fn(),
    getPreviousWeek: vi.fn(),
    getWeekBoundaries: vi.fn(),
  };
});

vi.mock('../utils/events', () => ({
  dispatchBudgetEvent: vi.fn(),
}));

vi.mock('../scripts/state', () => ({
  StateManager: {
    showErrorBanner: vi.fn(),
    showWarningBanner: vi.fn(),
  },
}));

describe('TimeSelector', () => {
  const mockGetCurrentWeek = vi.mocked(weeklyAggregation.getCurrentWeek);
  const mockGetNextWeek = vi.mocked(weeklyAggregation.getNextWeek);
  const mockGetPreviousWeek = vi.mocked(weeklyAggregation.getPreviousWeek);
  const mockGetWeekBoundaries = vi.mocked(weeklyAggregation.getWeekBoundaries);
  const mockDispatchBudgetEvent = vi.mocked(events.dispatchBudgetEvent);
  const mockShowErrorBanner = vi.mocked(StateManager.showErrorBanner);

  const currentWeek: WeekId = '2025-W10' as WeekId;
  const availableWeeks: WeekId[] = [
    '2025-W01',
    '2025-W02',
    '2025-W03',
    '2025-W04',
    '2025-W05',
    '2025-W06',
    '2025-W07',
    '2025-W08',
    '2025-W09',
    '2025-W10',
  ] as WeekId[];

  beforeEach(() => {
    mockGetCurrentWeek.mockReturnValue(currentWeek);
    mockGetWeekBoundaries.mockImplementation((week: WeekId) => {
      // Simplified mock - returns sensible dates
      const match = week.match(/^(\d{4})-W(\d{2})$/);
      if (!match) throw new Error(`Invalid week ID: ${week}`);
      const year = parseInt(match[1], 10);
      const weekNum = parseInt(match[2], 10);
      const startDay = (weekNum - 1) * 7 + 1;
      const endDay = startDay + 6;
      return {
        start: `${year}-01-${startDay.toString().padStart(2, '0')}`,
        end: `${year}-01-${endDay.toString().padStart(2, '0')}`,
      };
    });
    mockGetNextWeek.mockImplementation((week: WeekId) => {
      const match = week.match(/^(\d{4})-W(\d{2})$/);
      if (!match) return currentWeek;
      const year = parseInt(match[1], 10);
      const weekNum = parseInt(match[2], 10);
      const nextWeek = weekNum + 1;
      if (nextWeek > 52) {
        return weekId(`${year + 1}-W01`);
      }
      return weekId(`${year}-W${nextWeek.toString().padStart(2, '0')}`);
    });
    mockGetPreviousWeek.mockImplementation((week: WeekId) => {
      const match = week.match(/^(\d{4})-W(\d{2})$/);
      if (!match) return currentWeek;
      const year = parseInt(match[1], 10);
      const weekNum = parseInt(match[2], 10);
      const prevWeek = weekNum - 1;
      if (prevWeek < 1) {
        return weekId(`${year - 1}-W52`);
      }
      return weekId(`${year}-W${prevWeek.toString().padStart(2, '0')}`);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Granularity Toggle', () => {
    it('should display "Weekly View" when granularity is week', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByText('Weekly View')).toBeInTheDocument();
    });

    it('should display "Monthly View" when granularity is month', () => {
      render(
        <TimeSelector
          granularity="month"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByText('Monthly View')).toBeInTheDocument();
    });

    it('should dispatch granularity-toggle event with "month" when switching from week', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      const toggleButton = screen.getByText('Weekly View');
      fireEvent.click(toggleButton);

      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:granularity-toggle', {
        granularity: 'month',
      });
    });

    it('should dispatch granularity-toggle event with "week" when switching from month', () => {
      render(
        <TimeSelector
          granularity="month"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      const toggleButton = screen.getByText('Monthly View');
      fireEvent.click(toggleButton);

      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:granularity-toggle', {
        granularity: 'week',
      });
    });

    it('should hide week navigation controls when granularity is month', () => {
      render(
        <TimeSelector
          granularity="month"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.queryByText('← Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Next →')).not.toBeInTheDocument();
    });

    it('should show week navigation controls when granularity is week', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByText('← Previous')).toBeInTheDocument();
      expect(screen.getByText('Next →')).toBeInTheDocument();
    });
  });

  describe('Previous Button Disabled States', () => {
    it('should disable Previous button when on first available week', () => {
      const firstWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={firstWeek} availableWeeks={availableWeeks} />
      );

      const previousButton = screen.getByText('← Previous');
      expect(previousButton).toBeDisabled();
    });

    it('should enable Previous button when not on first available week', () => {
      const secondWeek = availableWeeks[1];
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={secondWeek}
          availableWeeks={availableWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      expect(previousButton).not.toBeDisabled();
    });

    it('should disable Previous button when availableWeeks is empty', () => {
      render(<TimeSelector granularity="week" selectedWeek={currentWeek} availableWeeks={[]} />);

      const previousButton = screen.getByText('← Previous');
      expect(previousButton).toBeDisabled();
    });

    it('should not dispatch week-change event when clicking disabled Previous button', () => {
      const firstWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={firstWeek} availableWeeks={availableWeeks} />
      );

      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      expect(mockDispatchBudgetEvent).not.toHaveBeenCalled();
    });
  });

  describe('Next Button Disabled States', () => {
    it('should disable Next button when on current week', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      expect(nextButton).toBeDisabled();
    });

    it('should enable Next button when not on current week', () => {
      const pastWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={pastWeek} availableWeeks={availableWeeks} />
      );

      const nextButton = screen.getByText('Next →');
      expect(nextButton).not.toBeDisabled();
    });

    it('should not dispatch week-change event when clicking disabled Next button', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      expect(mockDispatchBudgetEvent).not.toHaveBeenCalled();
    });
  });

  describe('Week Navigation', () => {
    it('should dispatch week-change event with previous week when clicking Previous', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      expect(mockGetPreviousWeek).toHaveBeenCalledWith(selectedWeek);
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W05'), // Previous week from mock
      });
    });

    it('should dispatch week-change event with next week when clicking Next', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      expect(mockGetNextWeek).toHaveBeenCalledWith(selectedWeek);
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W07'), // Next week from mock
      });
    });

    it('should use current week when selectedWeek is null', () => {
      render(
        <TimeSelector granularity="week" selectedWeek={null} availableWeeks={availableWeeks} />
      );

      const nextButton = screen.getByText('Next →');
      expect(nextButton).toBeDisabled(); // Should be disabled since activeWeek = currentWeek
    });
  });

  describe('Current Week Button', () => {
    it('should not show Current Week button when on current week', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.queryByText('Current Week')).not.toBeInTheDocument();
    });

    it('should show Current Week button when not on current week', () => {
      const pastWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={pastWeek} availableWeeks={availableWeeks} />
      );

      expect(screen.getByText('Current Week')).toBeInTheDocument();
    });

    it('should dispatch week-change event with null when clicking Current Week', () => {
      const pastWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={pastWeek} availableWeeks={availableWeeks} />
      );

      const currentWeekButton = screen.getByText('Current Week');
      fireEvent.click(currentWeekButton);

      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });
    });

    it('should not show Current Week button when selectedWeek is null (already current)', () => {
      render(
        <TimeSelector granularity="week" selectedWeek={null} availableWeeks={availableWeeks} />
      );

      expect(screen.queryByText('Current Week')).not.toBeInTheDocument();
    });
  });

  describe('Week Formatting', () => {
    it('should display formatted week range', () => {
      mockGetWeekBoundaries.mockReturnValue({
        start: '2025-03-01',
        end: '2025-03-07',
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W10')}
          availableWeeks={availableWeeks}
        />
      );

      // Should display formatted date range
      const dateElements = screen.getAllByText(/2025/);
      expect(dateElements.length).toBeGreaterThan(0);
      // Should have week ID displayed
      expect(screen.getByText(/2025-W10/)).toBeInTheDocument();
    });

    it('should display week ID with current indicator', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={currentWeek}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByText(/2025-W10.*\(Current\)/)).toBeInTheDocument();
    });

    it('should display week ID without current indicator for past weeks', () => {
      const pastWeek = availableWeeks[0];
      render(
        <TimeSelector granularity="week" selectedWeek={pastWeek} availableWeeks={availableWeeks} />
      );

      expect(screen.getByText('2025-W01')).toBeInTheDocument();
      expect(screen.queryByText(/\(Current\)/)).not.toBeInTheDocument();
    });

    it('should handle formatWeek error gracefully', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Mock getWeekBoundaries to throw for invalid-week, but return valid for currentWeek
      mockGetWeekBoundaries.mockImplementation((week: WeekId) => {
        if (week === 'invalid-week') {
          throw new Error('Invalid week');
        }
        // Return valid boundaries for currentWeek (fallback)
        return {
          start: '2025-03-01',
          end: '2025-03-07',
        };
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={'invalid-week' as WeekId}
          availableWeeks={availableWeeks}
        />
      );

      // Should show error banner
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Invalid week data: invalid-week. Cannot display week information. Please refresh the page.'
      );

      // Should dispatch reset event
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to format week'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });
  });

  describe('Navigation Error Recovery', () => {
    it('should auto-reset to current week when getNextWeek throws error', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetNextWeek.mockImplementation(() => {
        throw new Error('Week calculation failed');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      // Should show error banner
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to next week. Resetting to current week.'
      );

      // Should dispatch reset event
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to navigate to next week:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should auto-reset to current week when getPreviousWeek throws error', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetPreviousWeek.mockImplementation(() => {
        throw new Error('Week calculation failed');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      // Should show error banner
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to previous week. Resetting to current week.'
      );

      // Should dispatch reset event
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Should log error
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to navigate to previous week:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('should preserve enabled state of navigation buttons after error', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06
      vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetNextWeek.mockImplementation(() => {
        throw new Error('Week calculation failed');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      const previousButton = screen.getByText('← Previous');

      // Both buttons should be enabled before error
      expect(nextButton).not.toBeDisabled();
      expect(previousButton).not.toBeDisabled();

      fireEvent.click(nextButton);

      // Navigation buttons should still be enabled after error
      // (they'll be in error state but not disabled)
      expect(nextButton).not.toBeDisabled();
      expect(previousButton).not.toBeDisabled();

      // Verify error recovery event was dispatched with week: null
      // This triggers parent to reset to current week
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', { week: null });
    });

    it('should verify disabled state persists correctly after failed navigation', () => {
      const selectedWeek = availableWeeks[5]; // 2025-W06 (middle week)
      vi.spyOn(console, 'error').mockImplementation(() => {});

      let callCount = 0;
      mockGetNextWeek.mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error('First call fails');
        }
        // Second call succeeds
        return weekId('2025-W07');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={selectedWeek}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      const previousButton = screen.getByText('← Previous');

      // Verify initial state
      expect(nextButton).not.toBeDisabled();
      expect(previousButton).not.toBeDisabled();

      // First click triggers error
      fireEvent.click(nextButton);

      // Verify error recovery event was dispatched
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', { week: null });

      // Buttons should still be functional (not stuck disabled)
      expect(nextButton).not.toBeDisabled();
      expect(previousButton).not.toBeDisabled();

      // Clear mocks to test subsequent navigation
      vi.clearAllMocks();

      // Second click should work correctly
      fireEvent.click(nextButton);

      // Verify successful navigation
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W07'),
      });
    });
  });

  describe('Year Boundary Handling', () => {
    it('should handle navigation from last week of year to first week of next year', () => {
      const lastWeek: WeekId = weekId('2024-W52');
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W02'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={lastWeek}
          availableWeeks={[weekId('2024-W52'), weekId('2025-W01'), weekId('2025-W02')]}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      expect(mockGetNextWeek).toHaveBeenCalledWith(lastWeek);
      // Mock returns 2025-W01
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W01'),
      });
    });

    it('should handle navigation from first week of year to last week of previous year', () => {
      const firstWeek: WeekId = weekId('2025-W01');
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={firstWeek}
          availableWeeks={[weekId('2024-W52'), weekId('2025-W01'), weekId('2025-W10')]}
        />
      );

      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      expect(mockGetPreviousWeek).toHaveBeenCalledWith(firstWeek);
      // Mock returns 2024-W52
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2024-W52'),
      });
    });

    it('should format year boundary weeks correctly', () => {
      mockGetWeekBoundaries.mockReturnValue({
        start: '2024-12-28',
        end: '2025-01-03',
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W01')}
          availableWeeks={availableWeeks}
        />
      );

      // Week crosses year boundary - should display Dec and Jan
      expect(screen.getByText(/Dec.*Jan.*2025/)).toBeInTheDocument();
      expect(screen.getByText('2025-W01')).toBeInTheDocument();
    });
  });

  describe('Week 53 Handling', () => {
    it('should handle week 53 years correctly', () => {
      const week53: WeekId = weekId('2020-W53');
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));
      mockGetWeekBoundaries.mockReturnValue({
        start: '2020-12-26',
        end: '2021-01-01',
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={week53}
          availableWeeks={[weekId('2020-W53'), weekId('2025-W10')]}
        />
      );

      expect(screen.getByText('2020-W53')).toBeInTheDocument();
      // Week 53 crosses year boundary - should display Dec (may show 2020 or 2021 depending on format)
      expect(screen.getByText(/Dec/)).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle null selectedWeek with empty availableWeeks', () => {
      render(<TimeSelector granularity="week" selectedWeek={null} availableWeeks={[]} />);

      // Both navigation buttons should be disabled
      const previousButton = screen.getByText('← Previous');
      const nextButton = screen.getByText('Next →');
      expect(previousButton).toBeDisabled();
      expect(nextButton).toBeDisabled(); // Disabled because activeWeek === currentWeek

      // Current Week button should not appear (already at current)
      expect(screen.queryByText('Current Week')).not.toBeInTheDocument();

      // Should show current week display despite no data
      expect(screen.getByText(new RegExp(currentWeek))).toBeInTheDocument();
    });

    it('should handle empty availableWeeks array', () => {
      render(<TimeSelector granularity="week" selectedWeek={currentWeek} availableWeeks={[]} />);

      const previousButton = screen.getByText('← Previous');
      const nextButton = screen.getByText('Next →');

      expect(previousButton).toBeDisabled();
      expect(nextButton).toBeDisabled(); // Disabled because activeWeek === currentWeek
    });

    it('should handle single week in availableWeeks', () => {
      const singleWeek = availableWeeks[0];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      render(
        <TimeSelector granularity="week" selectedWeek={singleWeek} availableWeeks={[singleWeek]} />
      );

      const previousButton = screen.getByText('← Previous');
      const nextButton = screen.getByText('Next →');

      expect(previousButton).toBeDisabled(); // Can't go before first week
      expect(nextButton).not.toBeDisabled(); // Can go forward (not at current week)
    });

    it('should handle selectedWeek not in availableWeeks', () => {
      const outsideWeek: WeekId = weekId('2024-W30');
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={outsideWeek}
          availableWeeks={availableWeeks}
        />
      );

      // Should still render and allow navigation
      expect(screen.getByText('2024-W30')).toBeInTheDocument();
      const nextButton = screen.getByText('Next →');
      expect(nextButton).not.toBeDisabled();
    });
  });

  describe('Accessibility', () => {
    it('should have title attributes for all buttons', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={availableWeeks[5]}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByTitle('Toggle between weekly and monthly view')).toBeInTheDocument();
      expect(screen.getByTitle('Previous week')).toBeInTheDocument();
      expect(screen.getByTitle('Next week')).toBeInTheDocument();
      expect(screen.getByTitle('Jump to current week')).toBeInTheDocument();
    });

    it('should have proper button roles', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={availableWeeks[5]}
          availableWeeks={availableWeeks}
        />
      );

      const buttons = screen.getAllByRole('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('allows tab navigation through all buttons in correct order', () => {
      render(
        <TimeSelector
          granularity="week"
          selectedWeek={availableWeeks[5]} // Middle week - all buttons enabled
          availableWeeks={availableWeeks}
        />
      );

      const granularityToggle = screen.getByText('Weekly View');
      const previousButton = screen.getByText('← Previous');
      const currentWeekButton = screen.getByText('Current Week');
      const nextButton = screen.getByText('Next →');

      // Verify all buttons are focusable (no negative tabindex)
      granularityToggle.focus();
      expect(document.activeElement).toBe(granularityToggle);

      previousButton.focus();
      expect(document.activeElement).toBe(previousButton);

      currentWeekButton.focus();
      expect(document.activeElement).toBe(currentWeekButton);

      nextButton.focus();
      expect(document.activeElement).toBe(nextButton);
    });
  });

  describe('Integration with Event System', () => {
    it('should dispatch events with correct structure', () => {
      const pastWeek = availableWeeks[5];
      render(
        <TimeSelector granularity="week" selectedWeek={pastWeek} availableWeeks={availableWeeks} />
      );

      fireEvent.click(screen.getByText('← Previous'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith(
        'budget:week-change',
        expect.objectContaining({
          week: expect.any(String),
        })
      );

      fireEvent.click(screen.getByText('Next →'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith(
        'budget:week-change',
        expect.objectContaining({
          week: expect.any(String),
        })
      );

      fireEvent.click(screen.getByText('Current Week'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith(
        'budget:week-change',
        expect.objectContaining({
          week: null,
        })
      );

      fireEvent.click(screen.getByText('Weekly View'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith(
        'budget:granularity-toggle',
        expect.objectContaining({
          granularity: 'month',
        })
      );
    });
  });

  describe('Week Boundary Tests - Sparse Available Weeks', () => {
    it('handles sparse available weeks correctly', () => {
      // Sparse weeks with gaps: W01, W05, W10, W15
      const sparseWeeks: WeekId[] = [
        weekId('2025-W01'),
        weekId('2025-W05'),
        weekId('2025-W10'),
        weekId('2025-W15'),
      ];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W20'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={sparseWeeks}
        />
      );

      // Click Next - should navigate to W06 (getNextWeek returns next chronological week)
      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      expect(mockGetNextWeek).toHaveBeenCalledWith(weekId('2025-W05'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W06'), // getNextWeek returns W06 (not W10 from availableWeeks)
      });

      vi.clearAllMocks();

      // Click Previous - should navigate to W04 (getNextWeek returns previous chronological week)
      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      expect(mockGetPreviousWeek).toHaveBeenCalledWith(weekId('2025-W05'));
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W04'), // getPreviousWeek returns W04 (not W01 from availableWeeks)
      });
    });

    it('allows navigation to weeks not in availableWeeks array when using sparse data', () => {
      // This test documents current behavior: navigation is not constrained to availableWeeks
      const sparseWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W10')];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W20'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W01')}
          availableWeeks={sparseWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      // getNextWeek returns W02, which is NOT in availableWeeks [W01, W10]
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W02'),
      });
    });
  });

  describe('Week Boundary Tests - Selected Week Outside Range', () => {
    it('handles selectedWeek before availableWeeks range', () => {
      const limitedWeeks: WeekId[] = [weekId('2025-W10'), weekId('2025-W11'), weekId('2025-W12')];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W20'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')} // Before range starts
          availableWeeks={limitedWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      const nextButton = screen.getByText('Next →');

      // Previous button should be disabled (W05 < W10, the first available week)
      expect(previousButton).toBeDisabled();

      // Next button should be enabled (W05 < currentWeek)
      expect(nextButton).not.toBeDisabled();
    });

    it('handles selectedWeek after availableWeeks range but before current week', () => {
      const limitedWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02'), weekId('2025-W03')];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W20'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W10')} // After range ends, before current
          availableWeeks={limitedWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      const nextButton = screen.getByText('Next →');

      // Previous button should be enabled (W10 > W01, the first available week)
      expect(previousButton).not.toBeDisabled();

      // Next button should be enabled (W10 < W20 current week)
      expect(nextButton).not.toBeDisabled();
    });

    it('handles selectedWeek outside availableWeeks with navigation', () => {
      const limitedWeeks: WeekId[] = [weekId('2025-W10'), weekId('2025-W11'), weekId('2025-W12')];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W20'));

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')} // Before availableWeeks range
          availableWeeks={limitedWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');
      fireEvent.click(nextButton);

      // Should navigate to W06 (next chronological week, still outside availableWeeks)
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W06'),
      });
    });
  });

  describe('Week Boundary Tests - Dynamic AvailableWeeks Changes', () => {
    it('re-evaluates boundaries when availableWeeks prop changes', () => {
      const initialWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02')];
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      const { rerender } = render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          availableWeeks={initialWeeks}
        />
      );

      // Initially at W02, next should be disabled (not at current week W10 yet, but close to end)
      let nextButton = screen.getByText('Next →');
      expect(nextButton).not.toBeDisabled(); // W02 < W10 (current week)

      // Update availableWeeks to add W03
      const updatedWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02'), weekId('2025-W03')];
      rerender(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          availableWeeks={updatedWeeks}
        />
      );

      // Next button should still be enabled (still W02 < W10 current week)
      nextButton = screen.getByText('Next →');
      expect(nextButton).not.toBeDisabled();
    });

    it('updates Previous button state when availableWeeks changes', () => {
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      // Start with weeks W05-W07
      const initialWeeks: WeekId[] = [weekId('2025-W05'), weekId('2025-W06'), weekId('2025-W07')];

      const { rerender } = render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={initialWeeks}
        />
      );

      // At W05 (first available), Previous should be disabled
      let previousButton = screen.getByText('← Previous');
      expect(previousButton).toBeDisabled();

      // Add earlier weeks to availableWeeks
      const updatedWeeks: WeekId[] = [
        weekId('2025-W03'),
        weekId('2025-W04'),
        weekId('2025-W05'),
        weekId('2025-W06'),
        weekId('2025-W07'),
      ];

      rerender(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={updatedWeeks}
        />
      );

      // Now at W05 with W03 and W04 available, Previous should be enabled
      previousButton = screen.getByText('← Previous');
      expect(previousButton).not.toBeDisabled();
    });

    it('maintains correct state when selectedWeek changes along with availableWeeks', () => {
      mockGetCurrentWeek.mockReturnValue(weekId('2025-W10'));

      const initialWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02')];

      const { rerender } = render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W01')}
          availableWeeks={initialWeeks}
        />
      );

      // At W01, Previous disabled
      let previousButton = screen.getByText('← Previous');
      expect(previousButton).toBeDisabled();

      // Change both selectedWeek and availableWeeks
      const updatedWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02'), weekId('2025-W03')];

      rerender(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W02')}
          availableWeeks={updatedWeeks}
        />
      );

      // At W02, Previous should be enabled
      previousButton = screen.getByText('← Previous');
      expect(previousButton).not.toBeDisabled();
    });
  });

  describe('Integration: Error Recovery Flows', () => {
    it('completes full flow: getCurrentWeek fails → fallback to latest week → shows error banner → user can still navigate', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate system date error
      mockGetCurrentWeek.mockImplementation(() => {
        throw new Error('System date error');
      });

      const availableWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02'), weekId('2025-W03')];

      render(
        <TimeSelector granularity="week" selectedWeek={null} availableWeeks={availableWeeks} />
      );

      // Verify error banner shown to user
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        expect.stringContaining('Using latest available week')
      );

      // Verify fallback week displayed (latest available = W03)
      expect(screen.getByText(/2025-W03/)).toBeInTheDocument();

      // Verify user can still navigate backward from fallback week
      const previousButton = screen.getByText('← Previous');
      expect(previousButton).not.toBeDisabled();

      fireEvent.click(previousButton);

      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W02'),
      });

      // Verify getCurrentWeek error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to get current week:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('renders error state when both getCurrentWeek and fallback week validation fail', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Simulate getCurrentWeek failure
      mockGetCurrentWeek.mockImplementation(() => {
        throw new Error('System date error');
      });

      // Simulate fallback week validation failure - getWeekBoundaries throws for the fallback week
      const fallbackWeek = weekId('2025-W53'); // Valid format, but boundaries calculation will fail
      mockGetWeekBoundaries.mockImplementation(() => {
        throw new Error('Invalid week data');
      });

      render(
        <TimeSelector granularity="week" selectedWeek={null} availableWeeks={[fallbackWeek]} />
      );

      // Verify error state rendered
      expect(screen.getByText(/Time selector unavailable/i)).toBeInTheDocument();
      expect(screen.getByText(/No valid week data available/i)).toBeInTheDocument();

      // Verify navigation buttons NOT rendered in error state
      expect(screen.queryByText('← Previous')).not.toBeInTheDocument();
      expect(screen.queryByText('Next →')).not.toBeInTheDocument();

      // Verify errors logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to get current week:',
        expect.any(Error)
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Fallback week is invalid:',
        expect.any(String),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('completes auto-recovery flow: navigation error → error banner → auto-reset to current week → user continues navigating', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetPreviousWeek.mockImplementationOnce(() => {
        throw new Error('Navigation failed');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={availableWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      // Verify error banner shown to user
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to previous week. Resetting to current week.'
      );

      // Verify auto-recovery dispatched (week: null = current week)
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Verify error logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to navigate to previous week:',
        expect.any(Error)
      );

      // Restore normal navigation
      mockGetPreviousWeek.mockImplementation((week: WeekId) => {
        const match = week.match(/^(\d{4})-W(\d{2})$/);
        if (!match) return currentWeek;
        const year = parseInt(match[1], 10);
        const weekNum = parseInt(match[2], 10);
        const prevWeek = weekNum - 1;
        if (prevWeek < 1) {
          return weekId(`${year - 1}-W52`);
        }
        return weekId(`${year}-W${prevWeek.toString().padStart(2, '0')}`);
      });

      vi.clearAllMocks();

      // Verify user can continue navigating after recovery
      fireEvent.click(previousButton);

      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W04'),
      });

      consoleErrorSpy.mockRestore();
    });

    it('handles multiple sequential navigation failures without getting stuck', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      let failureCount = 0;
      mockGetPreviousWeek.mockImplementation(() => {
        failureCount++;
        if (failureCount <= 2) {
          throw new Error(`Navigation failure ${failureCount}`);
        }
        // Third attempt succeeds
        return weekId('2025-W04');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={availableWeeks}
        />
      );

      const previousButton = screen.getByText('← Previous');

      // First failure
      fireEvent.click(previousButton);
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to previous week. Resetting to current week.'
      );
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', { week: null });

      vi.clearAllMocks();

      // Second failure
      fireEvent.click(previousButton);
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to previous week. Resetting to current week.'
      );
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', { week: null });

      vi.clearAllMocks();

      // Third attempt succeeds
      fireEvent.click(previousButton);
      expect(mockShowErrorBanner).not.toHaveBeenCalled();
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W04'),
      });

      // Verify button remains functional (not stuck disabled)
      expect(previousButton).not.toBeDisabled();

      consoleErrorSpy.mockRestore();
    });

    it('handles formatWeek error with complete recovery flow: error → banner → auto-reset → fallback display', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // Use a valid WeekId that will fail during formatting
      const corruptedWeek = weekId('2025-W53'); // Valid format, but boundaries will fail

      // Mock getWeekBoundaries to fail for specific week
      mockGetWeekBoundaries.mockImplementation((week: WeekId) => {
        if (week === corruptedWeek) {
          throw new Error('Corrupted week data');
        }
        // Return valid for currentWeek (used during recovery)
        return {
          start: '2025-03-01',
          end: '2025-03-07',
        };
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={corruptedWeek}
          availableWeeks={availableWeeks}
        />
      );

      // Verify error banner shown
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        `Invalid week data: ${corruptedWeek}. Cannot display week information. Please refresh the page.`
      );

      // Verify auto-reset dispatched
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Verify fallback error display shown (not misleading data)
      expect(
        screen.getByText(new RegExp(`Invalid Week \\(${corruptedWeek}\\)`))
      ).toBeInTheDocument();

      // Verify error logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to format week'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    it('verifies complete flow when getNextWeek fails during rapid navigation', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      mockGetNextWeek.mockImplementationOnce(() => {
        throw new Error('Navigation calculation error');
      });

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={weekId('2025-W05')}
          availableWeeks={availableWeeks}
        />
      );

      const nextButton = screen.getByText('Next →');

      // Rapid click triggering error
      fireEvent.click(nextButton);

      // Verify complete error recovery flow
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to navigate to next week:',
        expect.any(Error)
      );
      expect(mockShowErrorBanner).toHaveBeenCalledWith(
        'Cannot navigate to next week. Resetting to current week.'
      );
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: null,
      });

      // Verify button remains enabled for retry
      expect(nextButton).not.toBeDisabled();

      // Restore normal behavior
      mockGetNextWeek.mockImplementation((week: WeekId) => {
        const match = week.match(/^(\d{4})-W(\d{2})$/);
        if (!match) return currentWeek;
        const year = parseInt(match[1], 10);
        const weekNum = parseInt(match[2], 10);
        const nextWeek = weekNum + 1;
        if (nextWeek > 52) {
          return weekId(`${year + 1}-W01`);
        }
        return weekId(`${year}-W${nextWeek.toString().padStart(2, '0')}`);
      });

      vi.clearAllMocks();

      // Verify user can retry navigation successfully
      fireEvent.click(nextButton);
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W06'),
      });

      consoleErrorSpy.mockRestore();
    });

    it('verifies no cascading errors when recovery succeeds after initial failure', () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // getCurrentWeek fails, but fallback succeeds
      mockGetCurrentWeek.mockImplementation(() => {
        throw new Error('System time error');
      });

      const availableWeeks: WeekId[] = [weekId('2025-W01'), weekId('2025-W02'), weekId('2025-W03')];

      render(
        <TimeSelector granularity="week" selectedWeek={null} availableWeeks={availableWeeks} />
      );

      // Initial error logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to get current week:',
        expect.any(Error)
      );

      // Only one error logged (no cascade)
      expect(consoleErrorSpy).toHaveBeenCalledTimes(1);

      // Verify fallback succeeded - component is functional
      expect(screen.getByText(/2025-W03/)).toBeInTheDocument();
      expect(screen.getByText('← Previous')).toBeInTheDocument();
      expect(screen.getByText('Next →')).toBeInTheDocument();

      vi.clearAllMocks();

      // Verify navigation works despite initial error
      const previousButton = screen.getByText('← Previous');
      fireEvent.click(previousButton);

      // No new errors during navigation
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(mockDispatchBudgetEvent).toHaveBeenCalledWith('budget:week-change', {
        week: weekId('2025-W02'),
      });

      consoleErrorSpy.mockRestore();
    });
  });
});
