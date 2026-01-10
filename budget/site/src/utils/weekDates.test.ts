import { describe, it, expect } from 'vitest';
import {
  getWeekBoundaries,
  getISOWeek,
  getCurrentWeek,
  getNextWeek,
  getPreviousWeek,
} from './weekDates';
import { weekId, WeekId } from '../islands/types';

describe('weekDates', () => {
  describe('getWeekBoundaries', () => {
    describe('standard weeks', () => {
      it('should return correct boundaries for a mid-year week', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        expect(boundaries.start).toBe('2025-03-03'); // Monday
        expect(boundaries.end).toBe('2025-03-09'); // Sunday
      });

      it('should return correct boundaries for week 1', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W01'));
        expect(boundaries.start).toBe('2024-12-30'); // Monday (crosses year boundary)
        expect(boundaries.end).toBe('2025-01-05'); // Sunday
      });

      it('should return correct boundaries for week 2', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W02'));
        expect(boundaries.start).toBe('2025-01-06'); // Monday
        expect(boundaries.end).toBe('2025-01-12'); // Sunday
      });
    });

    describe('year boundary weeks', () => {
      it('should handle week 52 at year end', () => {
        const boundaries = getWeekBoundaries(weekId('2024-W52'));
        expect(boundaries.start).toBe('2024-12-23'); // Monday
        expect(boundaries.end).toBe('2024-12-29'); // Sunday
      });

      it('should handle week 1 that starts in previous year', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W01'));
        expect(boundaries.start).toBe('2024-12-30'); // Monday in 2024
        expect(boundaries.end).toBe('2025-01-05'); // Sunday in 2025
      });

      it('should handle week 1 that is entirely in the new year', () => {
        const boundaries = getWeekBoundaries(weekId('2024-W01'));
        expect(boundaries.start).toBe('2024-01-01'); // Monday
        expect(boundaries.end).toBe('2024-01-07'); // Sunday
      });
    });

    describe('week 53 support', () => {
      it('should handle week 53 correctly (2020)', () => {
        const boundaries = getWeekBoundaries(weekId('2020-W53'));
        expect(boundaries.start).toBe('2020-12-28'); // Monday
        expect(boundaries.end).toBe('2021-01-03'); // Sunday (crosses year boundary)
      });

      it('should handle transition from week 53 to week 1', () => {
        const w53Boundaries = getWeekBoundaries(weekId('2020-W53'));
        const w01Boundaries = getWeekBoundaries(weekId('2021-W01'));

        // Week 53 ends on Sunday
        expect(w53Boundaries.end).toBe('2021-01-03');
        // Week 1 starts on Monday (next day)
        expect(w01Boundaries.start).toBe('2021-01-04');
      });
    });

    describe('ISO 8601 compliance', () => {
      it('should start weeks on Monday (ISO 8601)', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        const startDate = new Date(boundaries.start);
        // getUTCDay() returns 0 for Sunday, 1 for Monday, etc.
        expect(startDate.getUTCDay()).toBe(1); // Monday
      });

      it('should end weeks on Sunday (ISO 8601)', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        const endDate = new Date(boundaries.end);
        expect(endDate.getUTCDay()).toBe(0); // Sunday
      });

      it('should span exactly 7 days', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        const startDate = new Date(boundaries.start);
        const endDate = new Date(boundaries.end);
        const daysDiff = (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysDiff).toBe(6); // 7 days inclusive (Monday to Sunday)
      });
    });

    describe('error handling', () => {
      it('should throw error for invalid week ID format', () => {
        expect(() => getWeekBoundaries('invalid' as WeekId)).toThrow('Invalid week ID');
        expect(() => getWeekBoundaries('2025' as WeekId)).toThrow('Invalid week ID');
        expect(() => getWeekBoundaries('W10' as WeekId)).toThrow('Invalid week ID');
        expect(() => getWeekBoundaries('2025-10' as WeekId)).toThrow('Invalid week ID');
      });

      it('should throw error for missing week number', () => {
        expect(() => getWeekBoundaries('2025-W' as WeekId)).toThrow('Invalid week ID');
      });

      it('should throw error for single-digit week without leading zero', () => {
        expect(() => getWeekBoundaries('2025-W5' as WeekId)).toThrow('Invalid week ID');
      });
    });

    describe('output format', () => {
      it('should return dates in ISO format (YYYY-MM-DD)', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        expect(boundaries.start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(boundaries.end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      });

      it('should return object with start and end properties', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        expect(boundaries).toHaveProperty('start');
        expect(boundaries).toHaveProperty('end');
        expect(Object.keys(boundaries)).toEqual(['start', 'end']);
      });
    });
  });

  describe('getISOWeek', () => {
    describe('basic week calculation', () => {
      it('should calculate week for a mid-year date', () => {
        expect(getISOWeek('2025-06-15')).toBe(weekId('2025-W24'));
      });

      it('should calculate week 1 correctly', () => {
        expect(getISOWeek('2025-01-01')).toBe(weekId('2025-W01'));
        expect(getISOWeek('2024-12-30')).toBe(weekId('2025-W01')); // Monday of week 1
      });

      it('should calculate week 2 correctly', () => {
        expect(getISOWeek('2025-01-06')).toBe(weekId('2025-W02'));
        expect(getISOWeek('2025-01-12')).toBe(weekId('2025-W02')); // Sunday of week 2
      });
    });

    describe('year boundary transitions', () => {
      it('should handle dates at year end that belong to next year week 1', () => {
        expect(getISOWeek('2024-12-30')).toBe(weekId('2025-W01')); // Monday
        expect(getISOWeek('2024-12-31')).toBe(weekId('2025-W01')); // Tuesday
      });

      it('should handle week 52 at year end', () => {
        expect(getISOWeek('2024-12-23')).toBe(weekId('2024-W52')); // Monday
        expect(getISOWeek('2024-12-29')).toBe(weekId('2024-W52')); // Sunday
      });

      it('should handle January dates that belong to previous year week 52/53', () => {
        // 2021-01-01 is Friday of 2020-W53
        expect(getISOWeek('2021-01-01')).toBe(weekId('2020-W53'));
        expect(getISOWeek('2021-01-03')).toBe(weekId('2020-W53')); // Sunday
      });
    });

    describe('week 53 support', () => {
      it('should calculate week 53 for years with 53 weeks (2020)', () => {
        expect(getISOWeek('2020-12-28')).toBe(weekId('2020-W53')); // Monday
        expect(getISOWeek('2020-12-31')).toBe(weekId('2020-W53')); // Thursday
      });

      it('should transition from week 53 to week 1', () => {
        expect(getISOWeek('2021-01-03')).toBe(weekId('2020-W53')); // Sunday
        expect(getISOWeek('2021-01-04')).toBe(weekId('2021-W01')); // Monday
      });
    });

    describe('ISO 8601 Thursday rule', () => {
      it('should assign week 1 to week containing first Thursday', () => {
        // 2025: Jan 2 is Thursday, so week starting Dec 30 is W01
        expect(getISOWeek('2025-01-02')).toBe(weekId('2025-W01')); // Thursday

        // 2024: Jan 4 is Thursday, so week starting Jan 1 is W01
        expect(getISOWeek('2024-01-04')).toBe(weekId('2024-W01')); // Thursday
      });
    });

    describe('input validation', () => {
      it('should reject invalid date format', () => {
        expect(() => getISOWeek('2025/01/01')).toThrow('Invalid date format');
        expect(() => getISOWeek('01-01-2025')).toThrow('Invalid date format');
        expect(() => getISOWeek('2025-1-1')).toThrow('Invalid date format');
      });

      it('should reject dates with invalid month', () => {
        expect(() => getISOWeek('2025-13-01')).toThrow('Invalid date');
        expect(() => getISOWeek('2025-00-01')).toThrow('Invalid date');
      });

      it('should reject dates with invalid day', () => {
        expect(() => getISOWeek('2025-01-32')).toThrow('Invalid date');
        expect(() => getISOWeek('2025-01-00')).toThrow('Invalid date');
      });

      it('should reject dates that get normalized (Feb 31st)', () => {
        expect(() => getISOWeek('2025-02-31')).toThrow(
          'Invalid date: 2025-02-31 was normalized to 2025-03-03'
        );
      });

      it('should reject dates that get normalized (Apr 31st)', () => {
        expect(() => getISOWeek('2025-04-31')).toThrow(
          'Invalid date: 2025-04-31 was normalized to 2025-05-01'
        );
      });

      it('should reject Feb 29 on non-leap years', () => {
        expect(() => getISOWeek('2025-02-29')).toThrow(
          'Invalid date: 2025-02-29 was normalized to 2025-03-01'
        );
      });

      it('should accept Feb 29 on leap years', () => {
        expect(getISOWeek('2024-02-29')).toBe(weekId('2024-W09')); // 2024 is leap year
      });

      it('should reject malformed strings', () => {
        expect(() => getISOWeek('not-a-date')).toThrow('Invalid date format');
        expect(() => getISOWeek('')).toThrow('Invalid date format');
      });
    });

    describe('output format', () => {
      it('should return WeekId type in YYYY-WNN format', () => {
        const week = getISOWeek('2025-06-15');
        expect(week).toMatch(/^\d{4}-W\d{2}$/);
      });

      it('should pad week number with leading zero', () => {
        expect(getISOWeek('2025-01-06')).toBe(weekId('2025-W02')); // Not W2
        expect(getISOWeek('2025-03-03')).toBe(weekId('2025-W10')); // Not W10 (already 2 digits)
      });
    });

    describe('roundtrip compatibility', () => {
      it('should work correctly with getWeekBoundaries', () => {
        const testDate = '2025-06-15';
        const week = getISOWeek(testDate);
        const boundaries = getWeekBoundaries(week);

        // The date should fall within the boundaries
        expect(testDate >= boundaries.start).toBe(true);
        expect(testDate <= boundaries.end).toBe(true);
      });

      it('should produce same week for all days in the week', () => {
        const boundaries = getWeekBoundaries(weekId('2025-W10'));
        const startWeek = getISOWeek(boundaries.start);
        const endWeek = getISOWeek(boundaries.end);

        expect(startWeek).toBe(weekId('2025-W10'));
        expect(endWeek).toBe(weekId('2025-W10'));
      });
    });
  });

  describe('getCurrentWeek', () => {
    it('should return a valid ISO week identifier', () => {
      const week = getCurrentWeek();
      expect(week).toMatch(/^\d{4}-W\d{2}$/);
    });

    it("should return current week based on today's date", () => {
      const today = new Date().toISOString().substring(0, 10);
      const expectedWeek = getISOWeek(today);
      const currentWeek = getCurrentWeek();

      expect(currentWeek).toBe(expectedWeek);
    });

    it('should return WeekId type', () => {
      const week = getCurrentWeek();
      // Should be usable anywhere WeekId is expected
      const boundaries = getWeekBoundaries(week);
      expect(boundaries).toHaveProperty('start');
      expect(boundaries).toHaveProperty('end');
    });
  });

  describe('getNextWeek', () => {
    describe('standard week navigation', () => {
      it('should navigate to next week within same year', () => {
        expect(getNextWeek(weekId('2025-W02'))).toBe(weekId('2025-W03'));
        expect(getNextWeek(weekId('2025-W10'))).toBe(weekId('2025-W11'));
        expect(getNextWeek(weekId('2025-W51'))).toBe(weekId('2025-W52'));
      });

      it('should navigate sequentially through multiple weeks', () => {
        let week = weekId('2025-W01');
        week = getNextWeek(week);
        expect(week).toBe(weekId('2025-W02'));
        week = getNextWeek(week);
        expect(week).toBe(weekId('2025-W03'));
        week = getNextWeek(week);
        expect(week).toBe(weekId('2025-W04'));
      });
    });

    describe('year boundary navigation', () => {
      it('should navigate from week 52 to week 1 of next year', () => {
        expect(getNextWeek(weekId('2024-W52'))).toBe(weekId('2025-W01'));
      });

      it('should handle leap years correctly', () => {
        // 2024 is a leap year
        expect(getNextWeek(weekId('2024-W52'))).toBe(weekId('2025-W01'));
      });

      it('should handle non-leap years correctly', () => {
        // 2025 is not a leap year
        expect(getNextWeek(weekId('2025-W52'))).toBe(weekId('2026-W01'));
      });
    });

    describe('week 53 navigation', () => {
      it('should navigate from week 53 to week 1 of next year', () => {
        expect(getNextWeek(weekId('2020-W53'))).toBe(weekId('2021-W01'));
      });

      it('should navigate to week 53 when applicable', () => {
        expect(getNextWeek(weekId('2020-W52'))).toBe(weekId('2020-W53'));
      });
    });

    describe('error handling', () => {
      it('should throw error for invalid week ID format', () => {
        expect(() => getNextWeek('invalid' as WeekId)).toThrow('Invalid week ID');
        expect(() => getNextWeek('2025-W' as WeekId)).toThrow('Invalid week ID');
        expect(() => getNextWeek('2025-54' as WeekId)).toThrow('Invalid week ID');
      });

      it('should provide helpful error message with context', () => {
        try {
          getNextWeek('invalid' as WeekId);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain('Invalid week ID');
          expect((error as Error).message).toContain('cannot calculate next week');
          expect((error as Error).message).toContain('YYYY-WNN');
        }
      });
    });

    describe('output format', () => {
      it('should return WeekId in YYYY-WNN format', () => {
        const nextWeek = getNextWeek(weekId('2025-W10'));
        expect(nextWeek).toMatch(/^\d{4}-W\d{2}$/);
      });
    });

    describe('roundtrip compatibility', () => {
      it('should work correctly with getWeekBoundaries', () => {
        const currentWeek = weekId('2025-W10');
        const nextWeek = getNextWeek(currentWeek);

        const currentBoundaries = getWeekBoundaries(currentWeek);
        const nextBoundaries = getWeekBoundaries(nextWeek);

        // Next week should start the day after current week ends
        const currentEnd = new Date(currentBoundaries.end);
        const nextStart = new Date(nextBoundaries.start);
        const dayDiff = (nextStart.getTime() - currentEnd.getTime()) / (1000 * 60 * 60 * 24);

        expect(dayDiff).toBe(1); // Exactly 1 day apart
      });

      it('should be inverse of getPreviousWeek', () => {
        const originalWeek = weekId('2025-W10');
        const nextWeek = getNextWeek(originalWeek);
        const backToOriginal = getPreviousWeek(nextWeek);

        expect(backToOriginal).toBe(originalWeek);
      });
    });
  });

  describe('getPreviousWeek', () => {
    describe('standard week navigation', () => {
      it('should navigate to previous week within same year', () => {
        expect(getPreviousWeek(weekId('2025-W03'))).toBe(weekId('2025-W02'));
        expect(getPreviousWeek(weekId('2025-W11'))).toBe(weekId('2025-W10'));
        expect(getPreviousWeek(weekId('2025-W52'))).toBe(weekId('2025-W51'));
      });

      it('should navigate sequentially backward through multiple weeks', () => {
        let week = weekId('2025-W04');
        week = getPreviousWeek(week);
        expect(week).toBe(weekId('2025-W03'));
        week = getPreviousWeek(week);
        expect(week).toBe(weekId('2025-W02'));
        week = getPreviousWeek(week);
        expect(week).toBe(weekId('2025-W01'));
      });
    });

    describe('year boundary navigation', () => {
      it('should navigate from week 1 to week 52 of previous year', () => {
        expect(getPreviousWeek(weekId('2025-W01'))).toBe(weekId('2024-W52'));
      });

      it('should handle leap years correctly', () => {
        // 2024 is a leap year
        expect(getPreviousWeek(weekId('2025-W01'))).toBe(weekId('2024-W52'));
      });

      it('should handle non-leap years correctly', () => {
        // 2025 is not a leap year
        expect(getPreviousWeek(weekId('2026-W01'))).toBe(weekId('2025-W52'));
      });
    });

    describe('week 53 navigation', () => {
      it('should navigate from week 1 to week 53 of previous year', () => {
        expect(getPreviousWeek(weekId('2021-W01'))).toBe(weekId('2020-W53'));
      });

      it('should navigate backward from week 53', () => {
        expect(getPreviousWeek(weekId('2020-W53'))).toBe(weekId('2020-W52'));
      });
    });

    describe('error handling', () => {
      it('should throw error for invalid week ID format', () => {
        expect(() => getPreviousWeek('invalid' as WeekId)).toThrow('Invalid week ID');
        expect(() => getPreviousWeek('2025-W' as WeekId)).toThrow('Invalid week ID');
        expect(() => getPreviousWeek('2025-54' as WeekId)).toThrow('Invalid week ID');
      });

      it('should provide helpful error message with context', () => {
        try {
          getPreviousWeek('invalid' as WeekId);
          expect.fail('Should have thrown error');
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain('Invalid week ID');
          expect((error as Error).message).toContain('cannot calculate previous week');
          expect((error as Error).message).toContain('YYYY-WNN');
        }
      });
    });

    describe('output format', () => {
      it('should return WeekId in YYYY-WNN format', () => {
        const prevWeek = getPreviousWeek(weekId('2025-W10'));
        expect(prevWeek).toMatch(/^\d{4}-W\d{2}$/);
      });
    });

    describe('roundtrip compatibility', () => {
      it('should work correctly with getWeekBoundaries', () => {
        const currentWeek = weekId('2025-W10');
        const prevWeek = getPreviousWeek(currentWeek);

        const currentBoundaries = getWeekBoundaries(currentWeek);
        const prevBoundaries = getWeekBoundaries(prevWeek);

        // Previous week should end the day before current week starts
        const prevEnd = new Date(prevBoundaries.end);
        const currentStart = new Date(currentBoundaries.start);
        const dayDiff = (currentStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60 * 24);

        expect(dayDiff).toBe(1); // Exactly 1 day apart
      });

      it('should be inverse of getNextWeek', () => {
        const originalWeek = weekId('2025-W10');
        const prevWeek = getPreviousWeek(originalWeek);
        const backToOriginal = getNextWeek(prevWeek);

        expect(backToOriginal).toBe(originalWeek);
      });
    });
  });

  describe('navigation roundtrips', () => {
    it('should support next -> previous roundtrip', () => {
      const week = weekId('2025-W15');
      expect(getPreviousWeek(getNextWeek(week))).toBe(week);
    });

    it('should support previous -> next roundtrip', () => {
      const week = weekId('2025-W15');
      expect(getNextWeek(getPreviousWeek(week))).toBe(week);
    });

    it('should support roundtrip across year boundary (forward)', () => {
      const week = weekId('2024-W52');
      const next = getNextWeek(week);
      expect(next).toBe(weekId('2025-W01'));
      expect(getPreviousWeek(next)).toBe(week);
    });

    it('should support roundtrip across year boundary (backward)', () => {
      const week = weekId('2025-W01');
      const prev = getPreviousWeek(week);
      expect(prev).toBe(weekId('2024-W52'));
      expect(getNextWeek(prev)).toBe(week);
    });

    it('should support roundtrip across week 53 boundary', () => {
      const week = weekId('2020-W53');
      const next = getNextWeek(week);
      expect(next).toBe(weekId('2021-W01'));
      expect(getPreviousWeek(next)).toBe(week);
    });
  });
});
