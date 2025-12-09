import { createRoot } from 'react-dom/client';
import React from 'react';

// Component registry
import { BudgetChart } from './BudgetChart';
import { Legend } from './Legend';

const COMPONENTS: Record<string, React.ComponentType<any>> = {
  BudgetChart,
  Legend,
};

export function hydrateIslands(container: Element = document.body) {
  const islands = container.querySelectorAll('[data-island-component]');

  islands.forEach((el) => {
    const element = el as HTMLElement;
    if (element.dataset.islandHydrated === 'true') return;

    const name = element.dataset.islandComponent!;
    const props = JSON.parse(element.dataset.islandProps || '{}');
    const Component = COMPONENTS[name];

    if (!Component) {
      console.warn(`Island "${name}" not found`);
      return;
    }

    createRoot(element).render(React.createElement(Component, props));
    element.dataset.islandHydrated = 'true';
  });
}

// Initial hydration
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => hydrateIslands());
} else {
  hydrateIslands();
}

// Re-hydrate after HTMX swaps (if using HTMX in the future)
document.body.addEventListener('htmx:afterSwap', (e: Event) => {
  const target = (e as CustomEvent).detail?.target;
  if (target) hydrateIslands(target);
});
