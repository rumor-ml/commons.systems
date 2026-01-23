import { createRoot } from 'react-dom/client';
import React from 'react';

// Component registry
import { BudgetChart } from './BudgetChart';
import { Legend } from './Legend';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetPlanningPage } from './BudgetPlanningPage';
import { DateRangeSelector } from './DateRangeSelector';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { logger } from '../utils/logger';

const COMPONENTS: Record<string, React.ComponentType<any>> = {
  BudgetChart,
  Legend,
  BudgetPlanEditor,
  BudgetPlanningPage,
  DateRangeSelector,
};

// Store React roots for re-rendering
const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();

// TODO(#1539): Add error handling for DOM manipulation failures
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
    logger.error(`Failed to parse island props for "${componentName}"`, {
      error,
      invalidJSON: element.dataset.islandProps,
    });

    // Show user-facing error banner in the island container
    // Displays a styled error message in place of the failed component
    // (Alternative: ErrorBoundary for React-level errors, notifications for temporary alerts)
    showErrorInContainer(
      element,
      `Failed to load ${componentName}`,
      'There was an error loading this component. Try refreshing the page.'
    );
    return;
  }

  const Component = COMPONENTS[componentName];

  if (!Component) {
    logger.error(`Island component "${componentName}" not found in registry`, {
      availableComponents: Object.keys(COMPONENTS),
      element: element.outerHTML.substring(0, 200),
    });

    // Show user-facing error banner in the island container
    // Displays a styled error message in place of the failed component
    // (Alternative: ErrorBoundary for React-level errors, notifications for temporary alerts)
    showErrorInContainer(
      element,
      `Component "${componentName}" not found`,
      'This component failed to load. This is likely a bug. Check browser console for details.'
    );
    return;
  }

  try {
    // Get or create root
    let root = roots.get(element);
    if (!root) {
      try {
        root = createRoot(element);
        roots.set(element, root);
      } catch (rootError) {
        const errorMessage = rootError instanceof Error ? rootError.message : String(rootError);
        const errorStack = rootError instanceof Error ? rootError.stack : undefined;
        logger.error(`Failed to create React root for "${componentName}"`, {
          error: errorMessage,
          stack: errorStack,
          elementId: element.id,
          elementClasses: element.className,
        });
        throw new Error(`Failed to create React root: ${errorMessage}`);
      }
    }

    // Wrap component in ErrorBoundary to catch React render/lifecycle errors
    // (Island-level errors like props parsing are caught above by try-catch)
    const wrappedComponent = React.createElement(
      ErrorBoundary,
      { componentName },
      React.createElement(Component, props)
    );

    // Render (or re-render) with new props
    try {
      root.render(wrappedComponent);
      element.dataset.islandHydrated = 'true';
    } catch (renderError) {
      const errorMessage = renderError instanceof Error ? renderError.message : String(renderError);
      const errorStack = renderError instanceof Error ? renderError.stack : undefined;
      logger.error(`Failed to render component "${componentName}"`, {
        error: errorMessage,
        stack: errorStack,
        elementId: element.id,
        elementClasses: element.className,
      });
      throw new Error(`Failed to render component: ${errorMessage}`);
    }
  } catch (error) {
    logger.error(`Failed to hydrate island "${componentName}"`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      elementId: element.id,
      elementClasses: element.className,
    });

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
