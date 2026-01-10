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
 * @returns Formatted string showing absolute value without sign (e.g., "1,234.56").
 *   Sign context must be provided by surrounding UI (e.g., "Expenses: $X" or "Income: $X").
 */
export function formatCurrency(amount: number): string {
  // Validate numeric input - handle NaN and Infinity
  if (!Number.isFinite(amount)) {
    console.error(`Invalid currency amount: ${amount}`);
    return '0.00'; // Safe fallback
  }

  return currencyFormatter.format(Math.abs(amount));
}
