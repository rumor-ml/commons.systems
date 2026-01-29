import { createRoot } from 'react-dom/client';
import React from 'react';

// Component registry
import { BudgetChart } from './BudgetChart';
import { Legend } from './Legend';
import { BudgetPlanEditor } from './BudgetPlanEditor';
import { BudgetPlanningPage } from './BudgetPlanningPage';
import { DateRangeSelector } from './DateRangeSelector';
import { TransactionList } from './TransactionList';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { logger } from '../utils/logger';

/**
 * Extract error message and stack from unknown error type
 */
function extractErrorInfo(error: unknown): { message: string; stack?: string } {
  return {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  };
}

const COMPONENTS: Record<string, React.ComponentType<any>> = {
  BudgetChart,
  Legend,
  BudgetPlanEditor,
  BudgetPlanningPage,
  DateRangeSelector,
  TransactionList,
};

// Store React roots for re-rendering
const roots = new Map<HTMLElement, ReturnType<typeof createRoot>>();

function showErrorInContainer(element: HTMLElement, title: string, message: string): void {
  try {
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
  } catch (domError) {
    logger.error('Failed to show error in container (DOM manipulation failed)', {
      error: domError,
      title,
      message,
      elementId: element.id,
      elementTag: element.tagName,
    });
    console.error(`[CRITICAL] Cannot display error UI: ${title} - ${message}`, domError);

    // Single text-only fallback
    try {
      element.textContent = `ERROR: ${title} - ${message}`;
    } catch (textError) {
      logger.error('All error display mechanisms failed', { domError, textError, title, message });
    }
  }
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

    // Show error banner in place of failed component
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

    // Show error banner in place of failed component
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
        const { message: errorMessage, stack: errorStack } = extractErrorInfo(rootError);
        logger.error(`Failed to create React root for "${componentName}"`, {
          error: errorMessage,
          stack: errorStack,
          elementId: element.id,
          elementClasses: element.className,
        });
        throw new Error(`Failed to create React root: ${errorMessage}`);
      }
    }

    // Wrap component in ErrorBoundary to catch React render/lifecycle errors after initial hydration.
    // Initial hydration errors (props parsing, component lookup, root creation, first render) are caught by the surrounding try-catch.
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
      const { message: errorMessage, stack: errorStack } = extractErrorInfo(renderError);
      logger.error(`Failed to render component "${componentName}"`, {
        error: errorMessage,
        stack: errorStack,
        elementId: element.id,
        elementClasses: element.className,
      });
      throw new Error(`Failed to render component: ${errorMessage}`);
    }
  } catch (error) {
    const { message, stack } = extractErrorInfo(error);

    logger.error(`Failed to hydrate island "${componentName}"`, {
      error: message,
      stack,
      elementId: element.id,
      elementClasses: element.className,
    });

    showErrorInContainer(
      element,
      `Failed to load ${componentName}`,
      'There was an error loading this component. Try refreshing the page.'
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
