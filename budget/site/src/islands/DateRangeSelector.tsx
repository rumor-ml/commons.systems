import { useState, useEffect } from 'react';
import { dispatchBudgetEvent } from '../utils/events';

interface DateRangeSelectorProps {
  dateRangeStart: string | null;
  dateRangeEnd: string | null;
}

export function DateRangeSelector({ dateRangeStart, dateRangeEnd }: DateRangeSelectorProps) {
  const [startDate, setStartDate] = useState<string>(dateRangeStart || '');
  const [endDate, setEndDate] = useState<string>(dateRangeEnd || '');

  // Sync with props when they change
  useEffect(() => {
    setStartDate(dateRangeStart || '');
    setEndDate(dateRangeEnd || '');
  }, [dateRangeStart, dateRangeEnd]);

  const handleApply = () => {
    dispatchBudgetEvent('budget:date-range-change', {
      startDate: startDate || null,
      endDate: endDate || null,
    });
  };

  const handleReset = () => {
    setStartDate('');
    setEndDate('');
    dispatchBudgetEvent('budget:date-range-change', {
      startDate: null,
      endDate: null,
    });
  };

  const isFiltered = dateRangeStart !== null || dateRangeEnd !== null;

  return (
    <div className="p-4 bg-bg-elevated rounded-lg shadow-lg">
      <h3 className="text-lg font-semibold mb-3 text-text-primary">Date Range Filter</h3>

      <div className="flex items-end gap-3 flex-wrap">
        <div className="flex-1 min-w-[140px]">
          <label htmlFor="start-date" className="label">
            Start Date
          </label>
          <input
            id="start-date"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="flex-1 min-w-[140px]">
          <label htmlFor="end-date" className="label">
            End Date
          </label>
          <input
            id="end-date"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="flex gap-2">
          <button onClick={handleApply} className="btn btn-primary btn-sm">
            Apply
          </button>
          {isFiltered && (
            <button onClick={handleReset} className="btn btn-secondary btn-sm">
              Reset
            </button>
          )}
        </div>
      </div>

      {isFiltered && (
        <div className="mt-3 text-sm text-text-secondary">
          Showing data from{' '}
          {dateRangeStart ? new Date(dateRangeStart).toLocaleDateString() : 'beginning'} to{' '}
          {dateRangeEnd ? new Date(dateRangeEnd).toLocaleDateString() : 'end'}
        </div>
      )}
    </div>
  );
}
