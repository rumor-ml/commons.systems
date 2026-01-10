import { TimeGranularity, WeekId } from './types';
import {
  getWeekBoundaries,
  getCurrentWeek,
  getNextWeek,
  getPreviousWeek,
} from '../scripts/weeklyAggregation';
import { dispatchBudgetEvent } from '../utils/events';
import { StateManager } from '../scripts/state';

interface TimeSelectorProps {
  granularity: TimeGranularity;
  selectedWeek: WeekId | null;
  availableWeeks: WeekId[];
}

export function TimeSelector({ granularity, selectedWeek, availableWeeks }: TimeSelectorProps) {
  const currentWeek = getCurrentWeek();
  const activeWeek = selectedWeek || currentWeek;

  const canGoPrevious = availableWeeks.length > 0 && activeWeek > availableWeeks[0];
  const canGoNext = activeWeek < currentWeek;

  const navigateToWeek = (getWeek: () => WeekId, direction: string) => {
    try {
      const week = getWeek();
      dispatchBudgetEvent('budget:week-change', { week });
    } catch (error) {
      console.error(`Failed to navigate to ${direction} week:`, error);
      StateManager.showErrorBanner(
        `Cannot navigate to ${direction} week. Resetting to current week.`
      );
      // Auto-recover by resetting to current week
      dispatchBudgetEvent('budget:week-change', { week: null });
    }
  };

  const handlePrevious = () => {
    if (!canGoPrevious) return;
    navigateToWeek(() => getPreviousWeek(activeWeek), 'previous');
  };

  const handleNext = () => {
    if (!canGoNext) return;
    navigateToWeek(() => getNextWeek(activeWeek), 'next');
  };

  const handleCurrentWeek = () => {
    dispatchBudgetEvent('budget:week-change', { week: null });
  };

  const handleGranularityToggle = () => {
    const newGranularity: TimeGranularity = granularity === 'week' ? 'month' : 'week';
    dispatchBudgetEvent('budget:granularity-toggle', { granularity: newGranularity });
  };

  const formatWeek = (week: WeekId): string => {
    try {
      const boundaries = getWeekBoundaries(week);
      const start = new Date(boundaries.start);
      const end = new Date(boundaries.end);

      const startStr = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const endStr = end.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      return `${startStr} - ${endStr}`;
    } catch (error) {
      console.error(`Failed to format week ${week}:`, error);

      // Single user-facing error with recovery action
      StateManager.showErrorBanner(
        `Invalid week data: ${week}. Cannot display week information. Please refresh the page.`
      );

      // Trigger auto-recovery to current week
      dispatchBudgetEvent('budget:week-change', { week: null });

      // Return error indicator, not misleading fallback
      return `Invalid Week (${week})`;
    }
  };

  const isCurrentWeek = activeWeek === currentWeek;

  return (
    <div className="time-selector">
      <div className="flex items-center gap-3">
        <button
          onClick={handleGranularityToggle}
          className="btn btn-secondary btn-sm"
          title="Toggle between weekly and monthly view"
        >
          {granularity === 'week' ? 'Weekly View' : 'Monthly View'}
        </button>

        {granularity === 'week' && (
          <>
            <div className="h-6 w-px bg-bg-hover"></div>

            <button
              onClick={handlePrevious}
              disabled={!canGoPrevious}
              className="btn btn-ghost btn-sm"
              title="Previous week"
            >
              ← Previous
            </button>

            <div className="flex flex-col items-center min-w-[200px]">
              <div className="text-sm font-semibold text-text-primary">
                {formatWeek(activeWeek)}
              </div>
              <div className="text-xs text-text-tertiary">
                {activeWeek}
                {isCurrentWeek && ' (Current)'}
              </div>
            </div>

            <button
              onClick={handleNext}
              disabled={!canGoNext}
              className="btn btn-ghost btn-sm"
              title="Next week"
            >
              Next →
            </button>

            {!isCurrentWeek && (
              <>
                <div className="h-6 w-px bg-bg-hover"></div>
                <button
                  onClick={handleCurrentWeek}
                  className="btn btn-primary btn-sm"
                  title="Jump to current week"
                >
                  Current Week
                </button>
              </>
            )}
          </>
        )}
      </div>

      {granularity === 'week' && (
        <div className="text-xs text-text-tertiary mt-2">
          Navigate through weeks to see budget vs actual spending
        </div>
      )}
    </div>
  );
}
