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
 * @param amount - The amount to format (will use absolute value)
 * @returns Formatted string (e.g., "1,234.56")
 */
export function formatCurrency(amount: number): string {
  return currencyFormatter.format(Math.abs(amount));
}
