import { TimeGranularity, WeekId } from './types';
import {
  getWeekBoundaries,
  getCurrentWeek,
  getNextWeek,
  getPreviousWeek,
} from '../scripts/weeklyAggregation';

interface TimeSelectorProps {
  granularity: TimeGranularity;
  selectedWeek: WeekId | null;
  availableWeeks: WeekId[];
}

export function TimeSelector({ granularity, selectedWeek, availableWeeks }: TimeSelectorProps) {
  const currentWeek = getCurrentWeek();
  const activeWeek = selectedWeek || currentWeek;

  // Determine if we can navigate
  const canGoPrevious = availableWeeks.length > 0 && activeWeek > availableWeeks[0];
  const canGoNext = activeWeek < currentWeek;

  const handlePrevious = () => {
    if (!canGoPrevious) return;

    const prevWeek = getPreviousWeek(activeWeek);
    const event = new CustomEvent('budget:week-change', {
      detail: { week: prevWeek },
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const handleNext = () => {
    if (!canGoNext) return;

    const nextWeek = getNextWeek(activeWeek);
    const event = new CustomEvent('budget:week-change', {
      detail: { week: nextWeek },
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const handleCurrentWeek = () => {
    const event = new CustomEvent('budget:week-change', {
      detail: { week: null }, // null = current week
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  const handleGranularityToggle = () => {
    const newGranularity: TimeGranularity = granularity === 'week' ? 'month' : 'week';
    const event = new CustomEvent('budget:granularity-toggle', {
      detail: { granularity: newGranularity },
      bubbles: true,
    });
    document.dispatchEvent(event);
  };

  // Format week for display
  const formatWeek = (week: WeekId): string => {
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
  };

  const isCurrentWeek = activeWeek === currentWeek;

  return (
    <div className="time-selector">
      <div className="flex items-center gap-3">
        {/* Granularity Toggle */}
        <button
          onClick={handleGranularityToggle}
          className="btn btn-secondary btn-sm"
          title="Toggle between weekly and monthly view"
        >
          {granularity === 'week' ? 'Weekly View' : 'Monthly View'}
        </button>

        {/* Week Navigation (only in weekly mode) */}
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

      {/* Help text for weekly mode */}
      {granularity === 'week' && (
        <div className="text-xs text-text-tertiary mt-2">
          Navigate through weeks to see budget vs actual spending
        </div>
      )}
    </div>
  );
}
