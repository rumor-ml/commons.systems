/**
 * Dispatch a custom budget event with optional detail payload.
 * All events bubble up the DOM tree for centralized handling.
 */
export function dispatchBudgetEvent<T>(eventName: string, detail?: T): void {
  document.dispatchEvent(
    new CustomEvent(eventName, {
      detail,
      bubbles: true,
    })
  );
}
