import { TimeGranularity, WeekId } from './types';
import {
  getWeekBoundaries,
  getCurrentWeek,
  getNextWeek,
  getPreviousWeek,
} from '../scripts/weeklyAggregation';
import { dispatchBudgetEvent } from '../utils/events';

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

  const handlePrevious = () => {
    if (!canGoPrevious) return;

    try {
      const prevWeek = getPreviousWeek(activeWeek);
      dispatchBudgetEvent('budget:week-change', { week: prevWeek });
    } catch (error) {
      console.error('Failed to navigate to previous week:', error);
      // Reset to current week and notify user
      dispatchBudgetEvent('budget:week-change', { week: null });
      alert('Navigation failed due to invalid week data. Resetting to current week.');
    }
  };

  const handleNext = () => {
    if (!canGoNext) return;

    try {
      const nextWeek = getNextWeek(activeWeek);
      dispatchBudgetEvent('budget:week-change', { week: nextWeek });
    } catch (error) {
      console.error('Failed to navigate to next week:', error);
      // Reset to current week and notify user
      dispatchBudgetEvent('budget:week-change', { week: null });
      alert('Navigation failed due to invalid week data. Resetting to current week.');
    }
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

      // Check if it's a format validation error
      if (!week.match(/^\d{4}-W\d{2}$/)) {
        return `Invalid format: ${week} (expected YYYY-WNN)`;
      }

      // Otherwise show the week ID with hint to check console
      return `Cannot display week ${week} (see console for details)`;
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
