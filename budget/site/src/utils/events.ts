/**
 * Dispatch a custom budget event with optional detail payload.
 * All events bubble up to document level where main.ts has centralized listeners.
 * This allows decoupling event sources (islands) from state management.
 * Setting bubbles: false would prevent events from reaching document-level listeners in main.ts, causing UI state updates to silently fail.
 */
// TODO(#1379): Add test coverage for dispatchBudgetEvent function
export function dispatchBudgetEvent<T>(eventName: string, detail?: T): void {
  document.dispatchEvent(
    new CustomEvent(eventName, {
      detail,
      bubbles: true,
    })
  );
}
