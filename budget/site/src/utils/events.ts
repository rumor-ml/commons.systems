/**
 * Dispatch a custom budget event with optional detail payload.
 * All events bubble up to document level where main.ts has centralized listeners.
 * This allows decoupling event sources (islands) from state management.
 * Uses bubbles: true to allow events from React islands to reach document-level listeners in main.ts.
 * This enables centralized state management where islands dispatch events without coupling to StateManager.
 * Setting bubbles: false would break this pattern and cause silent UI update failures.
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
