// TODO(#1367): Consider adding tests for completeness
/**
 * Currency formatter singleton for consistent number formatting across the app.
 * Always shows 2 decimal places for currency values.
 */
const currencyFormatter = new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Format a number as currency with 2 decimal places.
 * @param amount - The amount to format (positive or negative)
 * @returns Formatted string with absolute value (e.g., "1,234.56" - no sign).
 *   Sign context is provided by surrounding UI labels ("Income: $X" vs "Expenses: $X").
 */
export function formatCurrency(amount: number): string {
  return currencyFormatter.format(Math.abs(amount));
}
