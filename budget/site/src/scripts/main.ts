import '../styles/main.css';
import { StateManager } from './state';
import { renderSummaryCards } from './renderer';
import { hydrateIsland } from '../islands/index';
import { Transaction, BudgetPlan, WeekId, Category } from '../islands/types';
import transactionsData from '../data/transactions.json';
import { aggregateTransactionsByWeek, getAvailableWeeks } from './weeklyAggregation';

function loadTransactions(): Transaction[] {
  return transactionsData.transactions as Transaction[];
}

/**
 * Updates a React island with new props and re-hydrates it.
 * @param elementId - The DOM element ID of the island container
 * @param componentName - The React component name to hydrate
 * @param props - The props object to pass to the component
 */
function updateIsland(elementId: string, componentName: string, props: object): void {
  const el = document.getElementById(elementId) as HTMLElement;
  if (el) {
    el.setAttribute('data-island-props', JSON.stringify(props));
    hydrateIsland(el, componentName);
  }
}

function updateIslands(): void {
  const state = StateManager.load();
  const transactions = loadTransactions();

  // Update chart island
  updateIsland('chart-island', 'BudgetChart', {
    transactions,
    hiddenCategories: state.hiddenCategories,
    showVacation: state.showVacation,
    granularity: state.viewGranularity,
    selectedWeek: state.selectedWeek,
    budgetPlan: state.budgetPlan,
  });

  // Update legend island
  updateIsland('legend-island', 'Legend', {
    transactions,
    hiddenCategories: state.hiddenCategories,
    showVacation: state.showVacation,
    budgetPlan: state.budgetPlan,
    granularity: state.viewGranularity,
    selectedWeek: state.selectedWeek,
  });

  // Update time selector island (only in weekly mode)
  const timeSelectorEl = document.getElementById('time-selector-island') as HTMLElement;
  if (timeSelectorEl) {
    if (state.viewGranularity === 'week') {
      timeSelectorEl.style.display = 'block';
      const availableWeeks = getAvailableWeeks(transactions);
      updateIsland('time-selector-island', 'TimeSelector', {
        granularity: state.viewGranularity,
        selectedWeek: state.selectedWeek,
        availableWeeks,
      });
    } else {
      timeSelectorEl.style.display = 'none';
    }
  }

  // Update budget plan editor island (only in planning mode)
  const planEditorEl = document.getElementById('plan-editor-island') as HTMLElement;
  if (planEditorEl) {
    if (state.planningMode) {
      planEditorEl.style.display = 'block';
      const hiddenSet = new Set(state.hiddenCategories);
      const weeklyData = aggregateTransactionsByWeek(transactions, {
        hiddenCategories: hiddenSet,
        showVacation: state.showVacation,
      });
      updateIsland('plan-editor-island', 'BudgetPlanEditor', {
        budgetPlan: state.budgetPlan || {
          categoryBudgets: {},
          lastModified: new Date().toISOString(),
        },
        historicData: weeklyData,
        onSave: () => {},
        onCancel: () => {},
      });
    } else {
      planEditorEl.style.display = 'none';
    }
  }

  // Update summary cards (vanilla JS)
  renderSummaryCards(transactions, state);
}

/**
 * Wraps an event handler with error handling, validation, and user-friendly error messages.
 * @param handler - The core event logic to execute
 * @param config - Configuration for error handling
 */
function wrapEventHandler<T>(
  handler: (detail: T) => void,
  config: {
    eventName: string;
    validate?: (detail: T) => { valid: boolean; error?: string };
    errorContext?: (detail: T) => Record<string, any>;
  }
): (e: CustomEvent<T>) => void {
  return (e: CustomEvent<T>) => {
    const detail = e.detail;

    // Validate event data if validator provided
    if (config.validate) {
      const validation = config.validate(detail);
      if (!validation.valid) {
        console.error(`Invalid ${config.eventName} event:`, {
          error: validation.error,
          receivedDetail: detail,
        });
        StateManager.showErrorBanner(
          validation.error || `Unable to ${config.eventName}: invalid event data`
        );
        return;
      }
    }

    try {
      handler(detail);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const context = config.errorContext ? config.errorContext(detail) : {};

      console.error(`Failed to ${config.eventName}:`, {
        error,
        errorMessage,
        ...context,
      });

      StateManager.showErrorBanner(
        `Failed to ${config.eventName}. ${errorMessage.includes('storage') || errorMessage.includes('quota') ? 'Your browser storage may be full. Try closing other tabs.' : 'Please try again.'}`
      );
    }
  };
}

function initCategoryToggle(): void {
  document.addEventListener(
    'budget:category-toggle',
    wrapEventHandler<{ category: Category }>(
      (detail) => {
        const category = detail.category;
        const state = StateManager.load();
        const hiddenSet = new Set(state.hiddenCategories);

        // Toggle category visibility
        if (hiddenSet.has(category)) {
          hiddenSet.delete(category);
        } else {
          hiddenSet.add(category);
        }

        StateManager.save({ hiddenCategories: Array.from(hiddenSet) });
        updateIslands();
      },
      {
        eventName: 'toggle category visibility',
        validate: (detail) => {
          if (!detail?.category) {
            return { valid: false, error: 'Unable to toggle category: missing category name' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ category: detail.category }),
      }
    ) as EventListener
  );
}

function initVacationToggle(): void {
  // Vacation toggle is in the Legend island - listen for its custom events
  document.addEventListener(
    'budget:vacation-toggle',
    wrapEventHandler<{ showVacation: boolean }>(
      (detail) => {
        const showVacation = detail.showVacation;
        StateManager.save({ showVacation });
        updateIslands();
      },
      {
        eventName: 'toggle vacation visibility',
        validate: (detail) => {
          if (detail?.showVacation === undefined) {
            return { valid: false, error: 'Unable to toggle vacation: missing showVacation value' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ showVacation: detail.showVacation }),
      }
    ) as EventListener
  );
}

/**
 * Deep equality comparison that normalizes property order.
 * @param obj1 - First object
 * @param obj2 - Second object
 * @returns true if objects are deeply equal
 */
function deepEqual(obj1: any, obj2: any): boolean {
  return (
    JSON.stringify(obj1, Object.keys(obj1 || {}).sort()) ===
    JSON.stringify(obj2, Object.keys(obj2 || {}).sort())
  );
}

/**
 * Diagnoses storage errors and provides recovery suggestions.
 * @returns Object with reason and recovery action
 */
function diagnoseStorageError(): { reason: string; recoveryAction: string } {
  try {
    const testKey = '__storage_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    // Storage works, so this is a data mismatch
    return {
      reason: 'Data verification failed after save',
      recoveryAction: 'Your browser storage may be corrupted. Try clearing cache.',
    };
  } catch (e) {
    if (e instanceof Error) {
      if (e.name === 'QuotaExceededError') {
        return {
          reason: 'Storage quota exceeded',
          recoveryAction:
            'Clear browser cache or reduce data size. Copy your budget values before refreshing.',
        };
      } else {
        return {
          reason: `Storage unavailable: ${e.message}`,
          recoveryAction:
            'You may be in private browsing mode. Copy your budget values before refreshing.',
        };
      }
    }
    return {
      reason: 'Storage error occurred',
      recoveryAction: 'Copy your budget values before refreshing.',
    };
  }
}

function initBudgetPlanEvents(): void {
  // Budget plan save event
  document.addEventListener(
    'budget:plan-save',
    wrapEventHandler<{ budgetPlan: BudgetPlan }>(
      (detail) => {
        const budgetPlan = detail.budgetPlan;
        const saved = StateManager.save({
          budgetPlan,
          planningMode: false,
          viewGranularity: 'week', // Switch to weekly view after saving budget
        });

        // If save failed, keep planning mode editor open to preserve user's unsaved budget edits.
        // Prevents data loss by maintaining form state until user can retry or copy values.
        // WARNING: Changes will be lost on page refresh - users should copy values manually.
        if (!saved.budgetPlan || !deepEqual(saved.budgetPlan, budgetPlan)) {
          console.error('Budget plan save verification failed:', {
            attemptedSave: budgetPlan,
            actualSaved: saved.budgetPlan,
          });

          const { reason, recoveryAction } = diagnoseStorageError();

          StateManager.save({ planningMode: true });
          StateManager.showErrorBanner(
            `Failed to save budget plan: ${reason}. ${recoveryAction} WARNING: Your changes will be lost on page refresh.`
          );

          console.error(
            'CRITICAL: Budget save failed - user should copy values manually:',
            budgetPlan
          );
          return;
        }

        updateIslands();
      },
      {
        eventName: 'save budget plan',
        validate: (detail) => {
          if (!detail?.budgetPlan || typeof detail.budgetPlan !== 'object') {
            return { valid: false, error: 'Unable to save budget: invalid plan data' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({
          budgetCategoryCount: Object.keys(detail.budgetPlan?.categoryBudgets || {}).length,
        }),
      }
    ) as EventListener
  );

  // Budget plan cancel event
  document.addEventListener(
    'budget:plan-cancel',
    wrapEventHandler(
      () => {
        StateManager.save({ planningMode: false });
        updateIslands();
      },
      {
        eventName: 'cancel budget planning',
      }
    ) as EventListener
  );
}

function initTimeNavigationEvents(): void {
  // Week change event
  document.addEventListener(
    'budget:week-change',
    wrapEventHandler<{ week: WeekId }>(
      (detail) => {
        const week = detail.week;
        StateManager.save({ selectedWeek: week });
        updateIslands();
      },
      {
        eventName: 'change week',
        validate: (detail) => {
          // null is valid - means reset to current week
          if (detail === undefined || detail === null) {
            return { valid: false, error: 'Unable to change week: missing event data' };
          }
          // detail.week can be null (reset to current) or a valid WeekId
          return { valid: true };
        },
        errorContext: (detail) => ({ week: detail.week }),
      }
    ) as EventListener
  );

  // Granularity toggle event
  document.addEventListener(
    'budget:granularity-toggle',
    wrapEventHandler<{ granularity: 'week' | 'month' }>(
      (detail) => {
        const granularity = detail.granularity;
        StateManager.save({ viewGranularity: granularity });
        updateIslands();
      },
      {
        eventName: 'change view mode',
        validate: (detail) => {
          if (!detail?.granularity) {
            return { valid: false, error: 'Unable to change view: missing granularity value' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ granularity: detail.granularity }),
      }
    ) as EventListener
  );
}

function initPlanButton(): void {
  const planButton = document.getElementById('plan-budget-btn');
  if (planButton) {
    planButton.addEventListener('click', () => {
      try {
        StateManager.save({ planningMode: true });
        updateIslands();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Failed to enter planning mode:', {
          error,
          errorMessage,
        });
        StateManager.showErrorBanner(
          `Failed to open budget planner. ${errorMessage.includes('storage') || errorMessage.includes('quota') ? 'Your browser storage may be full.' : 'Please try again.'}`
        );
      }
    });
  }
}

function init(): void {
  console.log('[Budget] Initializing application');

  // Initialize state from localStorage or defaults
  const state = StateManager.load();
  // Ensure state is persisted to localStorage
  StateManager.save(state);
  console.log('[Budget] Loaded state:', state);

  // Render initial UI
  const transactions = loadTransactions();
  renderSummaryCards(transactions, state);

  // Initialize event listeners
  initCategoryToggle();
  initVacationToggle();
  initBudgetPlanEvents();
  initTimeNavigationEvents();
  initPlanButton();

  // HTMX event handlers (future-proofing)
  document.body.addEventListener('htmx:afterSwap', ((event: CustomEvent) => {
    console.log('[HTMX] afterSwap event fired');

    const target = event.detail?.target;
    if (target) {
      // Re-hydrate any islands in swapped content
      const islands = target.querySelectorAll('[data-island-component]');
      islands.forEach((island: Element) => {
        const component = (island as HTMLElement).dataset.islandComponent;
        if (component) {
          hydrateIsland(island as HTMLElement, component);
        }
      });
    }
  }) as EventListener);

  document.body.addEventListener('htmx:beforeRequest', () => {
    console.log('[HTMX] Request starting');
  });

  document.body.addEventListener('htmx:afterRequest', () => {
    console.log('[HTMX] Request completed');
  });

  // Hydrate islands after initial render
  updateIslands();

  // Remove loading class to reveal content (prevent FOUC)
  requestAnimationFrame(() => {
    document.querySelector('.app-container')?.classList.remove('app-loading');
  });

  console.log('[Budget] Initialization complete');
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
