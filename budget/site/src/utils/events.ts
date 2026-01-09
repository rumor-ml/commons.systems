/**
 * Dispatch a custom budget event with optional detail payload.
 * All events bubble up to document level where main.ts has centralized listeners.
 * This allows decoupling event sources (islands) from state management.
 * Setting bubbles: false would break the event architecture since listeners are on document.
 */
export function dispatchBudgetEvent<T>(eventName: string, detail?: T): void {
  document.dispatchEvent(
    new CustomEvent(eventName, {
      detail,
      bubbles: true,
    })
  );
}
