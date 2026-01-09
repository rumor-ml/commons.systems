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

function updateIslands(): void {
  const state = StateManager.load();
  const transactions = loadTransactions();

  // Update chart island
  const chartEl = document.getElementById('chart-island') as HTMLElement;
  if (chartEl) {
    chartEl.setAttribute(
      'data-island-props',
      JSON.stringify({
        transactions,
        hiddenCategories: state.hiddenCategories,
        showVacation: state.showVacation,
        granularity: state.viewGranularity,
        selectedWeek: state.selectedWeek,
        budgetPlan: state.budgetPlan,
      })
    );
    hydrateIsland(chartEl, 'BudgetChart');
  }

  // Update legend island
  const legendEl = document.getElementById('legend-island') as HTMLElement;
  if (legendEl) {
    legendEl.setAttribute(
      'data-island-props',
      JSON.stringify({
        transactions,
        hiddenCategories: state.hiddenCategories,
        showVacation: state.showVacation,
        budgetPlan: state.budgetPlan,
        granularity: state.viewGranularity,
        selectedWeek: state.selectedWeek,
      })
    );
    hydrateIsland(legendEl, 'Legend');
  }

  // Update time selector island (only in weekly mode)
  const timeSelectorEl = document.getElementById('time-selector-island') as HTMLElement;
  if (timeSelectorEl) {
    if (state.viewGranularity === 'week') {
      timeSelectorEl.style.display = 'block';
      const availableWeeks = getAvailableWeeks(transactions);
      timeSelectorEl.setAttribute(
        'data-island-props',
        JSON.stringify({
          granularity: state.viewGranularity,
          selectedWeek: state.selectedWeek,
          availableWeeks,
        })
      );
      hydrateIsland(timeSelectorEl, 'TimeSelector');
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
      planEditorEl.setAttribute(
        'data-island-props',
        JSON.stringify({
          budgetPlan: state.budgetPlan || {
            categoryBudgets: {},
            lastModified: new Date().toISOString(),
          },
          historicData: weeklyData,
          onSave: () => {},
          onCancel: () => {},
        })
      );
      hydrateIsland(planEditorEl, 'BudgetPlanEditor');
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

// TODO(#1365): Missing integration tests for main.ts event handling
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

        // If save failed for budgetPlan, stay in planning mode to prevent data loss
        if (!saved.budgetPlan || JSON.stringify(saved.budgetPlan) !== JSON.stringify(budgetPlan)) {
          console.error('Budget plan save verification failed:', {
            attemptedSave: budgetPlan,
            actualSaved: saved.budgetPlan,
          });
          StateManager.save({ planningMode: true });
          StateManager.showErrorBanner(
            'Failed to save budget plan. Keeping editor open to prevent data loss. Your browser storage may be full.'
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
          if (!detail?.week) {
            return { valid: false, error: 'Unable to change week: missing week identifier' };
          }
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
