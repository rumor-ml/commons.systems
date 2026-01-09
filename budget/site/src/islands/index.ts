import { createRoot } from 'react-dom/client';
import React from 'react';

// Component registry
import { BudgetChart } from './BudgetChart';
import { Legend } from './Legend';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { TimeSelector } from './TimeSelector';

const COMPONENTS: Record<string, React.ComponentType<any>> = {
  BudgetChart,
  Legend,
  BudgetPlanEditor,
  TimeSelector,
};

// Store React roots for re-rendering
const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();

function showErrorInContainer(element: HTMLElement, title: string, message: string): void {
  const errorContainer = document.createElement('div');
  errorContainer.className = 'p-4 bg-error text-white rounded';

  const errorTitle = document.createElement('p');
  errorTitle.className = 'font-semibold';
  errorTitle.textContent = title;

  const errorMessage = document.createElement('p');
  errorMessage.className = 'text-sm';
  errorMessage.textContent = message;

  errorContainer.appendChild(errorTitle);
  errorContainer.appendChild(errorMessage);
  element.innerHTML = '';
  element.appendChild(errorContainer);
}

export function hydrateIsland(element: HTMLElement, componentName: string) {
  // Parse props with error handling
  let props = {};

  try {
    props = JSON.parse(element.dataset.islandProps || '{}');
  } catch (error) {
    console.error(`Failed to parse island props for "${componentName}":`, error);
    console.error('Invalid JSON:', element.dataset.islandProps);

    // Show user-facing error in the island container
    showErrorInContainer(
      element,
      `Failed to load ${componentName}`,
      'There was an error loading this component. Try refreshing the page.'
    );
    return;
  }

  const Component = COMPONENTS[componentName];

  if (!Component) {
    console.warn(`Island "${componentName}" not found`);
    return;
  }

  try {
    // Get or create root
    let root = roots.get(element);
    if (!root) {
      root = createRoot(element);
      roots.set(element, root);
    }

    // Render (or re-render) with new props
    root.render(React.createElement(Component, props));
    element.dataset.islandHydrated = 'true';
  } catch (error) {
    console.error(`Failed to render island "${componentName}":`, error);

    showErrorInContainer(
      element,
      `Failed to render ${componentName}`,
      'There was an error rendering this component. Try refreshing the page.'
    );
  }
}

export function hydrateIslands(container: Element = document.body) {
  const islands = container.querySelectorAll('[data-island-component]');

  islands.forEach((el) => {
    const element = el as HTMLElement;
    const name = element.dataset.islandComponent!;
    hydrateIsland(element, name);
  });
}
