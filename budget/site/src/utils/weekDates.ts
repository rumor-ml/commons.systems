import { WeekId, weekId } from '../islands/types';

/**
 * Get week boundaries (Monday-Sunday) for an ISO week identifier.
 * Implements ISO 8601 week date system where weeks start on Monday.
 * @param weekId - ISO week identifier (format: "YYYY-WNN", e.g., "2025-W01")
 * @returns Object with start and end dates in ISO format (YYYY-MM-DD)
 *   - start: Monday of the week
 *   - end: Sunday of the week
 * @throws Error if weekId format is invalid or week number is out of range
 */
export function getWeekBoundaries(weekIdValue: WeekId): { start: string; end: string } {
  const match = weekIdValue.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid week ID: ${weekIdValue}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // ISO 8601: Week 1 is the week with the first Thursday of the year
  // Calculate the first day of week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const firstMonday = new Date(jan4);
  firstMonday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));

  // Calculate the Monday of the target week
  const weekStart = new Date(firstMonday);
  weekStart.setUTCDate(firstMonday.getUTCDate() + (week - 1) * 7);

  // Calculate the Sunday of the target week
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekStart.getUTCDate() + 6);

  return {
    start: weekStart.toISOString().substring(0, 10),
    end: weekEnd.toISOString().substring(0, 10),
  };
}

/**
 * Determine the ISO week identifier for a given date.
 * Uses ISO 8601 week date system (Monday = week start).
 * @param date - ISO date string (YYYY-MM-DD)
 * @returns ISO week identifier in format YYYY-WNN (e.g., "2025-W01")
 * @throws Error if date format is invalid or date is not parseable
 */
export function getISOWeek(date: string): WeekId {
  // Validate input format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid date format: ${date}. Expected YYYY-MM-DD.`);
  }

  const d = new Date(date);

  // Check for Invalid Date
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid date value: ${date}. Date is not parseable.`);
  }

  // CRITICAL: Check that the date wasn't normalized by the Date constructor
  // E.g., "2025-02-31" becomes "2025-03-03" silently
  const reconstructed = d.toISOString().substring(0, 10);
  if (reconstructed !== date) {
    throw new Error(
      `Invalid date: ${date} was normalized to ${reconstructed}. ` +
        `This indicates an invalid day-of-month (e.g., Feb 31st, Apr 31st) or other calendar error.`
    );
  }

  // Set to nearest Thursday (ISO week date system)
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  // Create week string and validate using weekId constructor
  const weekStr = `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`;
  return weekId(weekStr);
}

/**
 * Get the current week ID based on today's date.
 * Uses ISO 8601 week date system (weeks start Monday).
 * @returns Current ISO week identifier in format "YYYY-WNN" (e.g., "2025-W01")
 */
export function getCurrentWeek(): WeekId {
  return getISOWeek(new Date().toISOString().substring(0, 10));
}

/**
 * Create week navigation error with enhanced context.
 */
function createWeekNavigationError(
  currentWeek: WeekId,
  direction: 'next' | 'previous',
  originalError: unknown
): Error {
  const errorMessage =
    originalError instanceof Error ? originalError.message : String(originalError);
  return new Error(
    `Invalid week ID "${currentWeek}": cannot calculate ${direction} week. ${errorMessage}. Expected format: YYYY-WNN (e.g., "2025-W01")`,
    { cause: originalError }
  );
}

/**
 * Navigate to the next week (ISO 8601 week system).
 * Correctly handles year boundaries and weeks with 53 weeks.
 * @param currentWeek - Current ISO week identifier (e.g., "2024-W52")
 * @returns Next week identifier (e.g., "2025-W01")
 */
export function getNextWeek(currentWeek: WeekId): WeekId {
  try {
    const boundaries = getWeekBoundaries(currentWeek);
    const nextMonday = new Date(boundaries.start);
    nextMonday.setUTCDate(nextMonday.getUTCDate() + 7);
    return getISOWeek(nextMonday.toISOString().substring(0, 10));
  } catch (error) {
    console.error(`Failed to calculate next week from ${currentWeek}:`, error);
    throw createWeekNavigationError(currentWeek, 'next', error);
  }
}

/**
 * Navigate to the previous week (ISO 8601 week system).
 * Correctly handles year boundaries and weeks with 53 weeks.
 * @param currentWeek - Current ISO week identifier (e.g., "2025-W01")
 * @returns Previous week identifier (e.g., "2024-W52")
 */
export function getPreviousWeek(currentWeek: WeekId): WeekId {
  try {
    const boundaries = getWeekBoundaries(currentWeek);
    const prevMonday = new Date(boundaries.start);
    prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
    return getISOWeek(prevMonday.toISOString().substring(0, 10));
  } catch (error) {
    console.error(`Failed to calculate previous week from ${currentWeek}:`, error);
    throw createWeekNavigationError(currentWeek, 'previous', error);
  }
}
