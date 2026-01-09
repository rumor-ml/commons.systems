import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TimeSelector } from './TimeSelector';
import { WeekId, weekId } from './types';
import * as weeklyAggregation from '../scripts/weeklyAggregation';
import * as events from '../utils/events';

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

describe('TimeSelector', () => {
  const mockGetCurrentWeek = vi.mocked(weeklyAggregation.getCurrentWeek);
  const mockGetNextWeek = vi.mocked(weeklyAggregation.getNextWeek);
  const mockGetPreviousWeek = vi.mocked(weeklyAggregation.getPreviousWeek);
  const mockGetWeekBoundaries = vi.mocked(weeklyAggregation.getWeekBoundaries);
  const mockDispatchBudgetEvent = vi.mocked(events.dispatchBudgetEvent);

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
      mockGetWeekBoundaries.mockImplementation(() => {
        throw new Error('Invalid week');
      });

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      render(
        <TimeSelector
          granularity="week"
          selectedWeek={'invalid-week' as WeekId}
          availableWeeks={availableWeeks}
        />
      );

      expect(screen.getByText(/Invalid: invalid-week/)).toBeInTheDocument();
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to format week'),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
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
});
