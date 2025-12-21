import '../styles/main.css';
import { StateManager } from './state';
import { renderSummaryCards } from './renderer';
import { hydrateIsland, hydrateIslands } from '../islands/index';
import { Transaction } from '../islands/types';
import transactionsData from '../data/transactions.json';

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
      })
    );
    hydrateIsland(legendEl, 'Legend');
  }

  // Update summary cards (vanilla JS)
  renderSummaryCards(transactions, state);
}

function initCategoryToggle(): void {
  document.addEventListener('budget:category-toggle', ((e: CustomEvent) => {
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
  }) as EventListener);
}

function initVacationToggle(): void {
  // The vacation toggle will be in the Legend island
  // We need to listen for custom events from the island
  document.addEventListener('budget:vacation-toggle', ((e: CustomEvent) => {
    const showVacation = e.detail.showVacation;
    StateManager.save({ showVacation });
    updateIslands();
  }) as EventListener);
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
