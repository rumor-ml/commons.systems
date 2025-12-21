import { createRoot } from 'react-dom/client';
import React from 'react';

// Component registry
import { BudgetChart } from './BudgetChart';
import { Legend } from './Legend';

const COMPONENTS: Record<string, React.ComponentType<any>> = {
  BudgetChart,
  Legend,
};

// Store React roots for re-rendering
const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();

export function hydrateIsland(element: HTMLElement, componentName: string) {
  // TODO: See issue #384 - Add error handling for JSON.parse, createRoot, and React.createElement failures
  const props = JSON.parse(element.dataset.islandProps || '{}');
  const Component = COMPONENTS[componentName];

  if (!Component) {
    console.warn(`Island "${componentName}" not found`);
    return;
  }

  // Get or create root
  let root = roots.get(element);
  if (!root) {
    root = createRoot(element);
    roots.set(element, root);
  }

  // Render (or re-render) with new props
  root.render(React.createElement(Component, props));
  element.dataset.islandHydrated = 'true';
}

export function hydrateIslands(container: Element = document.body) {
  const islands = container.querySelectorAll('[data-island-component]');

  islands.forEach((el) => {
    const element = el as HTMLElement;
    const name = element.dataset.islandComponent!;
    hydrateIsland(element, name);
  });
}
