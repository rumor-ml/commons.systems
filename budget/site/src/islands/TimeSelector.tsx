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
  let currentWeek: WeekId | null = null;
  try {
    currentWeek = getCurrentWeek();
  } catch (error) {
    console.error('Failed to get current week:', error);
    StateManager.showErrorBanner(
      'System date error detected. Week navigation may be incorrect. Check your device clock settings.'
    );
  }

  // Determine active week with explicit fallback handling
  let activeWeek: WeekId | null;
  if (selectedWeek) {
    activeWeek = selectedWeek;
  } else if (currentWeek) {
    activeWeek = currentWeek;
  } else if (availableWeeks.length > 0) {
    // Use latest available week as last resort
    const fallbackWeek = availableWeeks[availableWeeks.length - 1];

    // Validate the fallback week can actually be used
    try {
      getWeekBoundaries(fallbackWeek); // Test that it's valid
      activeWeek = fallbackWeek;
      StateManager.showErrorBanner(
        `Using latest available week (${activeWeek}) as fallback. Week navigation may be incorrect.`
      );
    } catch (error) {
      console.error('Fallback week is invalid:', fallbackWeek, error);
      activeWeek = null; // Give up, show error state
    }
  } else {
    // No valid week available - render error state
    activeWeek = null;
  }

  // Early return if no valid week available
  if (!activeWeek) {
    return (
      <div className="time-selector">
        <div className="text-error p-4 bg-error bg-opacity-10 rounded">
          <p className="font-semibold">Time selector unavailable</p>
          <p className="text-sm">
            No valid week data available. Check your system date/time settings.
          </p>
        </div>
      </div>
    );
  }

  const canGoPrevious = availableWeeks.length > 0 && activeWeek > availableWeeks[0];
  const canGoNext = currentWeek !== null && activeWeek < currentWeek;

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

  const isCurrentWeek = currentWeek !== null && activeWeek === currentWeek;

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
