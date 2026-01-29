import '../styles/main.css';
import { StateManager } from './state';
import { renderSummaryCards } from './renderer';
import { hydrateIsland } from '../islands/index';
import { Transaction, BudgetPlan, WeekId, Category } from '../islands/types';
import transactionsData from '../data/transactions.json';
import {
  aggregateTransactionsByWeek,
  calculateCategoryHistoricAverages,
} from './weeklyAggregation';
import { setupRouteListener, getCurrentRoute, navigateTo, Route } from './router';
import { loadDemoTransactions } from './firestore';

// Cache for loaded transactions
let cachedTransactions: Transaction[] | null = null;
let transactionsLoadPromise: Promise<Transaction[]> | null = null;

/**
 * Load transactions from Firestore emulator (async) or fallback to static JSON
 */
async function loadTransactions(): Promise<Transaction[]> {
  // Return cached transactions if available
  if (cachedTransactions) {
    return cachedTransactions;
  }

  // Return existing promise if load is in progress
  if (transactionsLoadPromise) {
    return transactionsLoadPromise;
  }

  // Check if Firebase emulator is configured
  const useEmulator = import.meta.env.VITE_USE_FIREBASE_EMULATOR === 'true';

  if (useEmulator) {
    // Load from Firestore emulator
    console.log('[Budget] Starting Firestore load...');
    transactionsLoadPromise = loadDemoTransactions()
      .then((transactions) => {
        console.log(`[Budget] Firestore load complete: ${transactions.length} transactions`);
        cachedTransactions = transactions;
        transactionsLoadPromise = null;
        return transactions;
      })
      .catch((error) => {
        console.error('[Budget] Failed to load from Firestore, falling back to static data:', error);
        transactionsLoadPromise = null;
        // Fallback to static JSON
        cachedTransactions = transactionsData.transactions as Transaction[];
        console.log(`[Budget] Using static data fallback: ${cachedTransactions.length} transactions`);
        return cachedTransactions;
      });
    return transactionsLoadPromise;
  } else {
    // Use static JSON data
    cachedTransactions = transactionsData.transactions as Transaction[];
    console.log(`[Budget] Using static data: ${cachedTransactions.length} transactions`);
    return cachedTransactions;
  }
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

/**
 * Show or hide a view based on the current route
 */
async function showView(route: Route): Promise<void> {
  const mainView = document.getElementById('main-view');
  const planningView = document.getElementById('planning-view');
  const reviewView = document.getElementById('review-view');

  if (!mainView || !planningView || !reviewView) {
    console.error('View containers not found in DOM');
    return;
  }

  // Hide all views
  mainView.style.display = 'none';
  planningView.style.display = 'none';
  reviewView.style.display = 'none';

  // Show the requested view
  switch (route) {
    case '/':
      mainView.style.display = 'block';
      await updateMainView();
      break;
    case '/plan':
      planningView.style.display = 'block';
      await updatePlanningView();
      break;
    case '/review':
      reviewView.style.display = 'block';
      updateReviewView();
      break;
  }
}

/**
 * Update all islands in the main view
 */
async function updateMainView(): Promise<void> {
  console.log('[Budget] updateMainView: loading transactions...');
  const state = StateManager.load();
  const transactions = await loadTransactions();
  console.log(`[Budget] updateMainView: loaded ${transactions.length} transactions, updating islands...`);

  // Update chart island
  updateIsland('chart-island', 'BudgetChart', {
    transactions,
    hiddenCategories: state.hiddenCategories,
    showVacation: state.showVacation,
    budgetPlan: state.budgetPlan,
    dateRangeStart: state.dateRangeStart,
    dateRangeEnd: state.dateRangeEnd,
    barAggregation: state.barAggregation,
    visibleIndicators: state.visibleIndicators,
    showNetIncomeIndicator: state.showNetIncomeIndicator,
  });

  // Update legend island
  updateIsland('legend-island', 'Legend', {
    transactions,
    hiddenCategories: state.hiddenCategories,
    showVacation: state.showVacation,
    budgetPlan: state.budgetPlan,
    visibleIndicators: state.visibleIndicators,
    showNetIncomeIndicator: state.showNetIncomeIndicator,
  });

  // Update date range selector island
  updateIsland('date-range-selector-island', 'DateRangeSelector', {
    dateRangeStart: state.dateRangeStart,
    dateRangeEnd: state.dateRangeEnd,
  });

  // Update summary cards (vanilla JS)
  renderSummaryCards(transactions, state);
}

/**
 * Update the planning view with current budget data
 */
async function updatePlanningView(): Promise<void> {
  const state = StateManager.load();
  const transactions = await loadTransactions();

  // Calculate weekly aggregated data for historic averages
  const hiddenSet = new Set(state.hiddenCategories);
  const weeklyData = aggregateTransactionsByWeek(transactions, {
    hiddenCategories: hiddenSet,
    showVacation: state.showVacation,
  });

  // Calculate per-category averages
  const categoryAverages = calculateCategoryHistoricAverages(weeklyData);

  // Update planning page island
  updateIsland('planning-page-island', 'BudgetPlanningPage', {
    budgetPlan: state.budgetPlan || {
      categoryBudgets: {},
      lastModified: new Date().toISOString(),
    },
    historicData: weeklyData,
    categoryAverages,
  });
}

/**
 * Update the review view with transaction list
 */
function updateReviewView(): void {
  // Update transaction list island
  // The TransactionList component handles its own data loading from Firestore
  updateIsland('transaction-list-island', 'TransactionList', {});
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
        updateMainView();
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
        updateMainView();
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
  // Handle primitives and null
  if (obj1 === obj2) return true;
  if (obj1 == null || obj2 == null) return false;
  if (typeof obj1 !== 'object' || typeof obj2 !== 'object') return false;

  // Handle arrays
  if (Array.isArray(obj1) && Array.isArray(obj2)) {
    if (obj1.length !== obj2.length) return false;
    return obj1.every((val, idx) => deepEqual(val, obj2[idx]));
  }

  // Handle objects - normalize by sorting keys at all levels
  const keys1 = Object.keys(obj1).sort();
  const keys2 = Object.keys(obj2).sort();

  if (keys1.length !== keys2.length) return false;
  if (!keys1.every((key, idx) => key === keys2[idx])) return false;

  // Recursively compare values
  return keys1.every((key) => deepEqual(obj1[key], obj2[key]));
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
        let saved;

        try {
          saved = StateManager.save({
            budgetPlan,
            currentView: 'main', // Navigate back to main view
          });
        } catch (error) {
          // save() threw an exception - show error and keep on planning page
          console.error('Budget plan save failed with exception:', error);

          const { reason, recoveryAction } = diagnoseStorageError();

          StateManager.showErrorBanner(
            `Failed to save budget plan: ${reason}. ${recoveryAction} WARNING: Your changes will be lost on page refresh.`
          );

          console.error(
            'CRITICAL: Budget save failed - user should copy values manually:',
            budgetPlan
          );
          return;
        }

        // If save succeeded but verification failed, stay on planning page to preserve user's unsaved budget edits.
        // Prevents data loss by maintaining form state until user can retry or copy values.
        // WARNING: Changes will be lost on page refresh - users should copy values manually.
        if (!saved.budgetPlan || !deepEqual(saved.budgetPlan, budgetPlan)) {
          console.error('Budget plan save verification failed:', {
            attemptedSave: budgetPlan,
            actualSaved: saved.budgetPlan,
          });

          const { reason, recoveryAction } = diagnoseStorageError();

          StateManager.showErrorBanner(
            `Failed to save budget plan: ${reason}. ${recoveryAction} WARNING: Your changes will be lost on page refresh.`
          );

          console.error(
            'CRITICAL: Budget save failed - user should copy values manually:',
            budgetPlan
          );
          return;
        }

        // Success - navigate back to main view
        navigateTo('/');
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

  // Budget plan cancel event - not needed anymore since we use routing
  // But keep for backwards compatibility with old code
  document.addEventListener(
    'budget:plan-cancel',
    wrapEventHandler(
      () => {
        navigateTo('/');
      },
      {
        eventName: 'cancel budget planning',
      }
    ) as EventListener
  );
}

function initNavigationButtons(): void {
  // Plan budget button
  const planButton = document.getElementById('plan-budget-btn');
  if (planButton) {
    planButton.addEventListener('click', () => {
      navigateTo('/plan');
    });
  }

  // Back to budget button
  const backButton = document.getElementById('back-to-budget-btn');
  if (backButton) {
    backButton.addEventListener('click', () => {
      navigateTo('/');
    });
  }
}

function initDateRangeEvents(): void {
  document.addEventListener(
    'budget:date-range-change',
    wrapEventHandler<{ startDate: string | null; endDate: string | null }>(
      async (detail) => {
        StateManager.save({
          dateRangeStart: detail.startDate,
          dateRangeEnd: detail.endDate,
        });
        await updateMainView();
      },
      {
        eventName: 'change date range',
        validate: (detail) => {
          if (detail?.startDate === undefined || detail?.endDate === undefined) {
            return { valid: false, error: 'Unable to change date range: missing date values' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ startDate: detail.startDate, endDate: detail.endDate }),
      }
    ) as EventListener
  );
}

function initAggregationToggle(): void {
  document.addEventListener(
    'budget:aggregation-toggle',
    wrapEventHandler<{ barAggregation: 'monthly' | 'weekly' }>(
      async (detail) => {
        StateManager.save({ barAggregation: detail.barAggregation });
        await updateMainView();
      },
      {
        eventName: 'toggle bar aggregation',
        validate: (detail) => {
          if (!detail?.barAggregation || !['monthly', 'weekly'].includes(detail.barAggregation)) {
            return {
              valid: false,
              error: 'Unable to toggle aggregation: invalid aggregation value',
            };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ barAggregation: detail.barAggregation }),
      }
    ) as EventListener
  );
}

function initIndicatorToggle(): void {
  document.addEventListener(
    'budget:indicator-toggle',
    wrapEventHandler<{ category: Category }>(
      async (detail) => {
        const state = StateManager.load();
        const visibleSet = new Set(state.visibleIndicators);

        // Toggle indicator visibility
        if (visibleSet.has(detail.category)) {
          visibleSet.delete(detail.category);
        } else {
          visibleSet.add(detail.category);
        }

        StateManager.save({ visibleIndicators: Array.from(visibleSet) });
        await updateMainView();
      },
      {
        eventName: 'toggle indicator visibility',
        validate: (detail) => {
          if (!detail?.category) {
            return { valid: false, error: 'Unable to toggle indicator: missing category name' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ category: detail.category }),
      }
    ) as EventListener
  );
}

function initNetIncomeToggle(): void {
  document.addEventListener(
    'budget:net-income-toggle',
    wrapEventHandler<{ showNetIncomeIndicator: boolean }>(
      async (detail) => {
        StateManager.save({ showNetIncomeIndicator: detail.showNetIncomeIndicator });
        await updateMainView();
      },
      {
        eventName: 'toggle net income indicator',
        validate: (detail) => {
          if (detail?.showNetIncomeIndicator === undefined) {
            return { valid: false, error: 'Unable to toggle net income: missing value' };
          }
          return { valid: true };
        },
        errorContext: (detail) => ({ showNetIncomeIndicator: detail.showNetIncomeIndicator }),
      }
    ) as EventListener
  );
}

function init(): void {
  console.log('[Budget] Initializing application');

  // Initialize state from localStorage or defaults
  const state = StateManager.load();
  // Ensure state is persisted to localStorage
  StateManager.save(state);
  console.log('[Budget] Loaded state:', state);

  // Initialize event listeners
  initCategoryToggle();
  initVacationToggle();
  initBudgetPlanEvents();
  initNavigationButtons();
  initDateRangeEvents();
  initAggregationToggle();
  initIndicatorToggle();
  initNetIncomeToggle();

  // Set up routing
  setupRouteListener(async (route) => {
    console.log('[Budget] Route changed to:', route);
    await showView(route);
  });

  // Initialize hash if empty (ensures URL always shows #/ or #/plan)
  // This happens after setup so the initial route is already rendered
  if (!window.location.hash) {
    const currentRoute = getCurrentRoute();
    navigateTo(currentRoute);
  }

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
