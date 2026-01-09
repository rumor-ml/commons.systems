import '../styles/main.css';
import { StateManager } from './state';
import { renderSummaryCards } from './renderer';
import { hydrateIsland } from '../islands/index';
import { Transaction } from '../islands/types';
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

// TODO(#1365): Missing integration tests for main.ts event handling
function initCategoryToggle(): void {
  document.addEventListener('budget:category-toggle', ((e: CustomEvent) => {
    try {
      const category = e.detail.category;
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
    } catch (error) {
      console.error('Failed to toggle category:', error);
      StateManager.showErrorBanner('Failed to toggle category filter. Please try again.');
    }
  }) as EventListener);
}

function initVacationToggle(): void {
  // The vacation toggle will be in the Legend island
  // We need to listen for custom events from the island
  document.addEventListener('budget:vacation-toggle', ((e: CustomEvent) => {
    try {
      const showVacation = e.detail.showVacation;
      StateManager.save({ showVacation });
      updateIslands();
    } catch (error) {
      console.error('Failed to toggle vacation:', error);
      StateManager.showErrorBanner('Failed to toggle vacation filter. Please try again.');
    }
  }) as EventListener);
}

function initBudgetPlanEvents(): void {
  // Budget plan save event
  document.addEventListener('budget:plan-save', ((e: CustomEvent) => {
    try {
      const budgetPlan = e.detail.budgetPlan;
      const saved = StateManager.save({
        budgetPlan,
        planningMode: false,
        viewGranularity: 'week', // Switch to weekly view after saving budget
      });

      // If save failed for budgetPlan, stay in planning mode to prevent data loss
      if (!saved.budgetPlan || JSON.stringify(saved.budgetPlan) !== JSON.stringify(budgetPlan)) {
        console.error('Budget plan save failed - staying in planning mode');
        StateManager.save({ planningMode: true });
        // User already saw error banner from StateManager.save()
        return;
      }

      updateIslands();
    } catch (error) {
      console.error('Failed to save budget plan:', error);
      StateManager.showErrorBanner('Failed to save budget plan. Please try again.');
    }
  }) as EventListener);

  // Budget plan cancel event
  document.addEventListener('budget:plan-cancel', (() => {
    try {
      StateManager.save({ planningMode: false });
      updateIslands();
    } catch (error) {
      console.error('Failed to cancel budget plan:', error);
      StateManager.showErrorBanner('Failed to close budget planner. Please try again.');
    }
  }) as EventListener);
}

function initTimeNavigationEvents(): void {
  // Week change event
  document.addEventListener('budget:week-change', ((e: CustomEvent) => {
    try {
      const week = e.detail.week;
      StateManager.save({ selectedWeek: week });
      updateIslands();
    } catch (error) {
      console.error('Failed to change week:', error);
      StateManager.showErrorBanner('Failed to change week. Please try again.');
    }
  }) as EventListener);

  // Granularity toggle event
  document.addEventListener('budget:granularity-toggle', ((e: CustomEvent) => {
    try {
      const granularity = e.detail.granularity;
      StateManager.save({ viewGranularity: granularity });
      updateIslands();
    } catch (error) {
      console.error('Failed to change view granularity:', error);
      StateManager.showErrorBanner('Failed to change view mode. Please try again.');
    }
  }) as EventListener);
}

function initPlanButton(): void {
  const planButton = document.getElementById('plan-budget-btn');
  if (planButton) {
    planButton.addEventListener('click', () => {
      try {
        StateManager.save({ planningMode: true });
        updateIslands();
      } catch (error) {
        console.error('Failed to enter planning mode:', error);
        StateManager.showErrorBanner('Failed to open budget planner. Please try again.');
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
