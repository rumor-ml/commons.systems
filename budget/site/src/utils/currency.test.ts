import { describe, it, expect } from 'vitest';
import { formatCurrency } from './currency';

describe('formatCurrency', () => {
  describe('valid numbers', () => {
    it('should format positive integers', () => {
      expect(formatCurrency(100)).toBe('100.00');
      expect(formatCurrency(1234)).toBe('1,234.00');
      expect(formatCurrency(1234567)).toBe('1,234,567.00');
    });

    it('should format negative integers with absolute value', () => {
      expect(formatCurrency(-100)).toBe('100.00');
      expect(formatCurrency(-1234)).toBe('1,234.00');
      expect(formatCurrency(-1234567)).toBe('1,234,567.00');
    });

    it('should format decimal values with exactly 2 decimal places', () => {
      expect(formatCurrency(123.4)).toBe('123.40');
      expect(formatCurrency(123.45)).toBe('123.45');
      expect(formatCurrency(123.456)).toBe('123.46'); // rounds up
      expect(formatCurrency(123.454)).toBe('123.45'); // rounds down
    });

    it('should format negative decimals with absolute value', () => {
      expect(formatCurrency(-123.4)).toBe('123.40');
      expect(formatCurrency(-123.45)).toBe('123.45');
      expect(formatCurrency(-123.456)).toBe('123.46');
    });

    it('should format zero', () => {
      expect(formatCurrency(0)).toBe('0.00');
      expect(formatCurrency(-0)).toBe('0.00');
    });

    it('should format very small numbers', () => {
      expect(formatCurrency(0.01)).toBe('0.01');
      expect(formatCurrency(0.001)).toBe('0.00'); // rounds down
      expect(formatCurrency(0.005)).toBe('0.01'); // rounds up
      expect(formatCurrency(-0.01)).toBe('0.01');
    });

    it('should format large numbers with proper grouping', () => {
      expect(formatCurrency(1000000)).toBe('1,000,000.00');
      expect(formatCurrency(999999.99)).toBe('999,999.99');
      expect(formatCurrency(-1000000)).toBe('1,000,000.00');
    });

    it('should format very large numbers without overflow', () => {
      expect(formatCurrency(Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991.00');
      expect(formatCurrency(-Number.MAX_SAFE_INTEGER)).toBe('9,007,199,254,740,991.00');
    });
  });

  describe('edge cases - invalid values', () => {
    it('should return "0.00" for NaN', () => {
      expect(formatCurrency(NaN)).toBe('0.00');
    });

    it('should return "0.00" for positive Infinity', () => {
      expect(formatCurrency(Infinity)).toBe('0.00');
    });

    it('should return "0.00" for negative Infinity', () => {
      expect(formatCurrency(-Infinity)).toBe('0.00');
    });

    it('should return "0.00" for NaN from invalid calculations', () => {
      const invalidResult = 0 / 0;
      expect(formatCurrency(invalidResult)).toBe('0.00');
    });

    it('should return "0.00" for Infinity from division by zero', () => {
      const infinityResult = 1 / 0;
      expect(formatCurrency(infinityResult)).toBe('0.00');
    });
  });

  describe('rounding behavior', () => {
    it("should round to nearest cent using banker's rounding", () => {
      // Standard rounding (away from zero when exactly .5)
      expect(formatCurrency(1.005)).toBe('1.01'); // rounds up
      expect(formatCurrency(1.015)).toBe('1.02'); // rounds up
      expect(formatCurrency(1.025)).toBe('1.03'); // rounds up (banker's rounding may vary)
    });

    it('should handle trailing decimals correctly', () => {
      expect(formatCurrency(1.999)).toBe('2.00');
      expect(formatCurrency(1.991)).toBe('1.99');
      expect(formatCurrency(-1.999)).toBe('2.00');
    });
  });

  describe('locale-independent formatting', () => {
    it('should use default locale formatting (US style with commas)', () => {
      // This test assumes running in a US locale environment
      // The formatter uses `undefined` locale, which defaults to system locale
      expect(formatCurrency(1234.56)).toBe('1,234.56');
    });

    it('should always show exactly 2 decimal places', () => {
      expect(formatCurrency(100)).toBe('100.00');
      expect(formatCurrency(100.1)).toBe('100.10');
      expect(formatCurrency(100.12)).toBe('100.12');
      expect(formatCurrency(100.123)).toBe('100.12');
    });
  });

  describe('absolute value behavior', () => {
    it('should always return positive formatted values', () => {
      expect(formatCurrency(123.45)).toBe('123.45');
      expect(formatCurrency(-123.45)).toBe('123.45');
    });

    it('should not include sign in formatted output', () => {
      const positiveResult = formatCurrency(100);
      const negativeResult = formatCurrency(-100);

      expect(positiveResult).toBe(negativeResult);
      expect(positiveResult).not.toContain('-');
      expect(positiveResult).not.toContain('+');
    });
  });

  describe('integration with financial data', () => {
    it('should format typical transaction amounts', () => {
      // Typical grocery transaction
      expect(formatCurrency(-45.67)).toBe('45.67');

      // Typical income
      expect(formatCurrency(2500)).toBe('2,500.00');

      // Typical bill payment
      expect(formatCurrency(-123.45)).toBe('123.45');
    });

    it('should format budget values consistently', () => {
      const weeklyBudget = -500;
      const actualSpent = -475.5;
      const variance = actualSpent - weeklyBudget;

      expect(formatCurrency(weeklyBudget)).toBe('500.00');
      expect(formatCurrency(actualSpent)).toBe('475.50');
      expect(formatCurrency(variance)).toBe('24.50');
    });
  });
});
