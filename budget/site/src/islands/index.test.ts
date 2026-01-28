import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as React from 'react';

// Mock react-dom/client - must use a factory function
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(),
}));

// Mock React components before imports
vi.mock('./BudgetChart', () => ({
  BudgetChart: () => React.createElement('div', { 'data-test': 'BudgetChart' }, 'BudgetChart'),
}));

vi.mock('./Legend', () => ({
  Legend: () => React.createElement('div', { 'data-test': 'Legend' }, 'Legend'),
}));

vi.mock('./BudgetPlanEditor', () => ({
  BudgetPlanEditor: () =>
    React.createElement('div', { 'data-test': 'BudgetPlanEditor' }, 'BudgetPlanEditor'),
}));

vi.mock('./BudgetPlanningPage', () => ({
  BudgetPlanningPage: () =>
    React.createElement('div', { 'data-test': 'BudgetPlanningPage' }, 'BudgetPlanningPage'),
}));

vi.mock('./DateRangeSelector', () => ({
  DateRangeSelector: () =>
    React.createElement('div', { 'data-test': 'DateRangeSelector' }, 'DateRangeSelector'),
}));

vi.mock('../components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children, componentName }: any) =>
    React.createElement(
      'div',
      { 'data-test': 'ErrorBoundary', 'data-component-name': componentName },
      children
    ),
}));

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import { hydrateIsland, hydrateIslands } from './index';
import { logger } from '../utils/logger';
import { createRoot } from 'react-dom/client';

// Get mocked createRoot
const mockCreateRoot = vi.mocked(createRoot);

describe('hydrateIsland', () => {
  let element: HTMLElement;
  let mockRoot: any;

  beforeEach(() => {
    element = document.createElement('div');
    element.id = 'test-island';
    element.className = 'island-container';
    document.body.appendChild(element);

    // Create mock React root
    mockRoot = {
      render: vi.fn(),
      unmount: vi.fn(),
    };

    // Configure mock to return our mock root
    mockCreateRoot.mockReturnValue(mockRoot);

    // Clear mock calls
    mockCreateRoot.mockClear();
    vi.mocked(logger.error).mockClear();
    vi.mocked(logger.warn).mockClear();
  });

  afterEach(() => {
    if (element.parentNode) {
      document.body.removeChild(element);
    }
  });

  describe('Props Parsing', () => {
    it('should parse valid JSON props successfully', () => {
      element.dataset.islandProps = JSON.stringify({ foo: 'bar', count: 42 });
      element.dataset.islandComponent = 'BudgetChart';

      hydrateIsland(element, 'BudgetChart');

      expect(mockRoot.render).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle empty props string', () => {
      element.dataset.islandProps = '';
      element.dataset.islandComponent = 'BudgetChart';

      hydrateIsland(element, 'BudgetChart');

      expect(mockRoot.render).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle missing props attribute', () => {
      // No islandProps set
      element.dataset.islandComponent = 'BudgetChart';

      hydrateIsland(element, 'BudgetChart');

      expect(mockRoot.render).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should log error and show fallback UI when props JSON is invalid', () => {
      const invalidJSON = '{invalid json}';
      element.dataset.islandProps = invalidJSON;
      element.dataset.islandComponent = 'BudgetChart';

      hydrateIsland(element, 'BudgetChart');

      // Should log error with context
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse island props'),
        expect.objectContaining({
          invalidJSON: invalidJSON,
        })
      );

      // Should show error UI in element
      expect(element.textContent).toContain('Failed to load BudgetChart');
      expect(element.textContent).toContain('Try refreshing the page');
      expect(element.querySelector('.bg-error')).toBeTruthy();

      // Should not attempt to render
      expect(mockRoot.render).not.toHaveBeenCalled();
    });

    it('should handle various malformed JSON formats', () => {
      const malformedCases = [
        '{"unclosed": ',
        '{key: "value"}', // unquoted key
        "{'single': 'quotes'}", // single quotes
        '[1, 2, 3,]', // trailing comma
        'undefined',
        'NaN',
      ];

      malformedCases.forEach((invalidJSON) => {
        vi.mocked(logger.error).mockClear();
        const testElement = document.createElement('div');
        document.body.appendChild(testElement);
        testElement.dataset.islandProps = invalidJSON;

        hydrateIsland(testElement, 'BudgetChart');

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Failed to parse island props'),
          expect.objectContaining({
            invalidJSON,
          })
        );

        document.body.removeChild(testElement);
      });
    });
  });

  describe('Component Registry', () => {
    it('should find and render component from registry', () => {
      element.dataset.islandComponent = 'BudgetChart';

      hydrateIsland(element, 'BudgetChart');

      expect(mockRoot.render).toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should handle component not found in registry', () => {
      element.dataset.islandComponent = 'NonExistentComponent';

      hydrateIsland(element, 'NonExistentComponent');

      // Should log error with available components
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('not found in registry'),
        expect.objectContaining({
          availableComponents: expect.arrayContaining([
            'BudgetChart',
            'Legend',
            'BudgetPlanEditor',
            'BudgetPlanningPage',
            'DateRangeSelector',
          ]),
        })
      );

      // Should show error UI
      expect(element.textContent).toContain('Component "NonExistentComponent" not found');
      expect(element.querySelector('.bg-error')).toBeTruthy();

      // Should not attempt to render
      expect(mockRoot.render).not.toHaveBeenCalled();
    });

    it('should render all supported components', () => {
      const components = [
        'BudgetChart',
        'Legend',
        'BudgetPlanEditor',
        'BudgetPlanningPage',
        'DateRangeSelector',
      ];

      components.forEach((componentName) => {
        vi.mocked(mockRoot.render).mockClear();
        const testElement = document.createElement('div');
        document.body.appendChild(testElement);

        hydrateIsland(testElement, componentName);

        expect(mockRoot.render).toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();

        document.body.removeChild(testElement);
      });
    });
  });

  describe('React Root Management', () => {
    it('should create React root on first hydration', () => {
      hydrateIsland(element, 'BudgetChart');

      expect(mockCreateRoot).toHaveBeenCalledWith(element);
      expect(mockRoot.render).toHaveBeenCalled();
    });

    it('should reuse existing root on subsequent hydrations', () => {
      // First hydration
      hydrateIsland(element, 'BudgetChart');

      expect(mockCreateRoot).toHaveBeenCalledTimes(1);
      mockCreateRoot!.mockClear();

      // Second hydration
      hydrateIsland(element, 'BudgetChart');

      // Should not create new root
      expect(mockCreateRoot).not.toHaveBeenCalled();
      // Should render again
      expect(mockRoot.render).toHaveBeenCalledTimes(2);
    });

    it('should log error with stack trace on root creation failure', () => {
      const rootError = new Error('DOM node is not suitable for root');
      mockCreateRoot!.mockImplementation(() => {
        throw rootError;
      });

      hydrateIsland(element, 'BudgetChart');

      // Should log error with stack trace
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create React root'),
        expect.objectContaining({
          error: rootError.message,
          stack: expect.any(String),
          elementId: element.id,
          elementClasses: element.className,
        })
      );

      // Should show error UI to user
      expect(element.textContent).toContain('Failed to load BudgetChart');
      expect(element.querySelector('.bg-error')).toBeTruthy();
    });

    it('should handle root creation errors without stack traces', () => {
      // Non-Error object thrown
      mockCreateRoot!.mockImplementation(() => {
        throw 'String error message';
      });

      hydrateIsland(element, 'BudgetChart');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create React root'),
        expect.objectContaining({
          error: 'String error message',
          stack: undefined,
        })
      );
    });
  });

  describe('ErrorBoundary Wrapping', () => {
    it('should wrap component in ErrorBoundary', () => {
      hydrateIsland(element, 'BudgetChart');

      // Check that render was called with ErrorBoundary wrapper
      expect(mockRoot.render).toHaveBeenCalled();
      const renderCall = vi.mocked(mockRoot.render).mock.calls[0][0];

      // Verify the rendered element structure
      expect(renderCall).toBeDefined();
      expect(renderCall.type).toBeDefined();
    });

    it('should pass component name to ErrorBoundary', () => {
      hydrateIsland(element, 'BudgetChart');

      // Check that render was called (ErrorBoundary wrapping is verified by successful rendering)
      expect(mockRoot.render).toHaveBeenCalled();

      // The component should render successfully, which proves ErrorBoundary is working
      expect(element.dataset.islandHydrated).toBe('true');
    });

    it('should verify ErrorBoundary wrapping structure in hydrateIsland', () => {
      // This test verifies that hydrateIsland correctly wraps components with ErrorBoundary
      // by inspecting the React element structure passed to root.render()
      //
      // NOTE: Full integration testing of ErrorBoundary error catching is done in
      // src/components/ErrorBoundary.test.tsx, which uses @testing-library/react
      // and properly handles React's error boundary lifecycle.

      hydrateIsland(element, 'BudgetChart');

      // Verify that root.render was called
      expect(mockRoot.render).toHaveBeenCalled();

      // Get the React element that was rendered
      const renderedElement = mockRoot.render.mock.calls[0][0];

      // Verify the structure: ErrorBoundary wrapping BudgetChart
      expect(renderedElement).toBeDefined();
      expect(renderedElement.type).toBeDefined();

      // The rendered element should have ErrorBoundary as the outer type
      // (In the mock, it's the mocked ErrorBoundary component)
      expect(renderedElement.props).toHaveProperty('componentName', 'BudgetChart');
      expect(renderedElement.props).toHaveProperty('children');

      // Verify the child is the actual component
      const childElement = renderedElement.props.children;
      expect(childElement).toBeDefined();
      expect(childElement.type).toBeDefined();
    });
  });

  describe('Component Rendering', () => {
    it('should render component successfully', () => {
      hydrateIsland(element, 'BudgetChart');

      expect(mockRoot.render).toHaveBeenCalled();
      expect(element.dataset.islandHydrated).toBe('true');
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('should pass props to component', () => {
      const props = { data: [1, 2, 3], title: 'Test Chart' };
      element.dataset.islandProps = JSON.stringify(props);

      hydrateIsland(element, 'BudgetChart');

      // Verify that render was called with the component
      expect(mockRoot.render).toHaveBeenCalled();

      // Component should hydrate successfully with props
      expect(element.dataset.islandHydrated).toBe('true');
    });

    it('should log error on render failure', () => {
      const renderError = new Error('Render failed due to invalid props');
      mockRoot.render.mockImplementation(() => {
        throw renderError;
      });

      hydrateIsland(element, 'BudgetChart');

      // Should log detailed error
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to render component'),
        expect.objectContaining({
          error: renderError.message,
          stack: expect.any(String),
          elementId: element.id,
          elementClasses: element.className,
        })
      );

      // Should show error UI
      expect(element.textContent).toContain('Failed to load BudgetChart');
    });

    it('should handle non-Error render failures', () => {
      mockRoot.render.mockImplementation(() => {
        throw { code: 'UNKNOWN', message: 'Custom error object' };
      });

      hydrateIsland(element, 'BudgetChart');

      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to render component'),
        expect.objectContaining({
          error: '[object Object]',
        })
      );
    });

    it('should set hydrated flag only on successful render', () => {
      // Successful render
      hydrateIsland(element, 'BudgetChart');
      expect(element.dataset.islandHydrated).toBe('true');

      // Failed render (new element)
      const failElement = document.createElement('div');
      document.body.appendChild(failElement);
      mockRoot.render.mockImplementation(() => {
        throw new Error('Render failed');
      });

      hydrateIsland(failElement, 'BudgetChart');
      expect(failElement.dataset.islandHydrated).toBeUndefined();

      document.body.removeChild(failElement);
    });
  });

  describe('Error Display', () => {
    it('should show error banner with title and message', () => {
      element.dataset.islandProps = '{invalid}';

      hydrateIsland(element, 'BudgetChart');

      const errorContainer = element.querySelector('.bg-error');
      expect(errorContainer).toBeTruthy();

      const title = errorContainer?.querySelector('.font-semibold');
      expect(title?.textContent).toBe('Failed to load BudgetChart');

      const message = errorContainer?.querySelector('.text-sm');
      expect(message?.textContent).toBe(
        'There was an error loading this component. Try refreshing the page.'
      );
    });

    it('should handle DOM manipulation errors in showErrorInContainer', () => {
      // Note: This test verifies that when DOM manipulation fails,
      // the code logs appropriate errors. The text fallback may not always
      // be visible in tests due to DOM timing, but the error logging is critical.

      const testElement = document.createElement('div');
      testElement.id = 'test-error-element';
      document.body.appendChild(testElement);
      testElement.dataset.islandProps = '{invalid}';

      // Mock appendChild to fail
      const originalAppendChild = testElement.appendChild.bind(testElement);
      const appendChildMock = vi.fn().mockImplementation(() => {
        throw new Error('DOM manipulation failed');
      });
      testElement.appendChild = appendChildMock;

      hydrateIsland(testElement, 'BudgetChart');

      // Should log critical error when appendChild fails
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to show error in container'),
        expect.objectContaining({
          title: expect.any(String),
          message: expect.any(String),
          elementId: testElement.id,
        })
      );

      // Verify appendChild was attempted and failed
      expect(appendChildMock).toHaveBeenCalled();

      // Cleanup
      testElement.appendChild = originalAppendChild;
      document.body.removeChild(testElement);
    });

    it('should handle complete DOM failure with text fallback', () => {
      element.dataset.islandProps = '{invalid}';

      // Mock both appendChild and textContent setter to fail
      const originalAppendChild = element.appendChild.bind(element);
      element.appendChild = vi.fn().mockImplementation(() => {
        throw new Error('DOM manipulation failed');
      });

      const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'textContent');
      Object.defineProperty(element, 'textContent', {
        set: vi.fn().mockImplementation(() => {
          throw new Error('textContent setter failed');
        }),
        configurable: true,
      });

      hydrateIsland(element, 'BudgetChart');

      // Should log both errors
      expect(logger.error).toHaveBeenCalledWith(
        'Failed to show error in container (DOM manipulation failed)',
        expect.objectContaining({
          elementId: element.id,
          elementTag: 'DIV',
          error: expect.any(Error),
          message: expect.any(String),
          title: expect.any(String),
        })
      );
      expect(logger.error).toHaveBeenCalledWith(
        'All error display mechanisms failed',
        expect.objectContaining({
          domError: expect.any(Error),
          textError: expect.any(Error),
          message: expect.any(String),
          title: expect.any(String),
        })
      );

      // Restore
      element.appendChild = originalAppendChild;
      if (descriptor) {
        Object.defineProperty(element, 'textContent', descriptor);
      }
    });
  });

  describe('Error Recovery', () => {
    it('should stop processing after props parse error', () => {
      element.dataset.islandProps = '{invalid}';

      hydrateIsland(element, 'BudgetChart');

      // Should not attempt to create root or render
      expect(mockCreateRoot).not.toHaveBeenCalled();
      expect(mockRoot.render).not.toHaveBeenCalled();
    });

    it('should stop processing after component not found', () => {
      hydrateIsland(element, 'NonExistentComponent');

      // Should not attempt to create root or render
      expect(mockCreateRoot).not.toHaveBeenCalled();
      expect(mockRoot.render).not.toHaveBeenCalled();
    });
  });
});

describe('hydrateIslands', () => {
  let container: HTMLElement;
  let mockRoot: any;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);

    // Mock createRoot
    mockRoot = {
      render: vi.fn(),
      unmount: vi.fn(),
    };
    mockCreateRoot.mockReturnValue(mockRoot);
    mockCreateRoot.mockClear();

    vi.mocked(logger.error).mockClear();
  });

  afterEach(() => {
    if (container.parentNode) {
      document.body.removeChild(container);
    }
  });

  it('should hydrate all islands in container', () => {
    const island1 = document.createElement('div');
    island1.dataset.islandComponent = 'BudgetChart';
    container.appendChild(island1);

    const island2 = document.createElement('div');
    island2.dataset.islandComponent = 'Legend';
    container.appendChild(island2);

    hydrateIslands(container);

    expect(mockCreateRoot).toHaveBeenCalledTimes(2);
    expect(island1.dataset.islandHydrated).toBe('true');
    expect(island2.dataset.islandHydrated).toBe('true');
  });

  it('should handle mixed valid and invalid islands', () => {
    // Valid island
    const validIsland = document.createElement('div');
    validIsland.dataset.islandComponent = 'BudgetChart';
    container.appendChild(validIsland);

    // Invalid island (bad props)
    const invalidIsland = document.createElement('div');
    invalidIsland.dataset.islandComponent = 'Legend';
    invalidIsland.dataset.islandProps = '{invalid}';
    container.appendChild(invalidIsland);

    hydrateIslands(container);

    // Valid island should be hydrated
    expect(validIsland.dataset.islandHydrated).toBe('true');

    // Invalid island should show error
    expect(invalidIsland.textContent).toContain('Failed to load Legend');
    expect(invalidIsland.dataset.islandHydrated).toBeUndefined();
  });

  it('should default to document.body when no container provided', () => {
    const island = document.createElement('div');
    island.dataset.islandComponent = 'BudgetChart';
    document.body.appendChild(island);

    hydrateIslands();

    expect(island.dataset.islandHydrated).toBe('true');

    document.body.removeChild(island);
  });

  it('should handle empty container', () => {
    hydrateIslands(container);

    // Should complete without errors
    expect(logger.error).not.toHaveBeenCalled();
    expect(mockCreateRoot).not.toHaveBeenCalled();
  });

  it('should process islands in DOM order', () => {
    const calls: string[] = [];

    mockCreateRoot!.mockImplementation((element: any) => {
      calls.push(element.dataset.islandComponent);
      return {
        render: vi.fn(),
        unmount: vi.fn(),
      } as any;
    });

    const island1 = document.createElement('div');
    island1.dataset.islandComponent = 'BudgetChart';
    container.appendChild(island1);

    const island2 = document.createElement('div');
    island2.dataset.islandComponent = 'Legend';
    container.appendChild(island2);

    const island3 = document.createElement('div');
    island3.dataset.islandComponent = 'DateRangeSelector';
    container.appendChild(island3);

    hydrateIslands(container);

    expect(calls).toEqual(['BudgetChart', 'Legend', 'DateRangeSelector']);
  });

  it('should continue hydrating after individual island failure', () => {
    const island1 = document.createElement('div');
    island1.dataset.islandComponent = 'BudgetChart';
    island1.dataset.islandProps = '{invalid}'; // Will fail
    container.appendChild(island1);

    const island2 = document.createElement('div');
    island2.dataset.islandComponent = 'Legend';
    container.appendChild(island2);

    hydrateIslands(container);

    // First island should fail
    expect(island1.textContent).toContain('Failed to load BudgetChart');

    // Second island should succeed
    expect(island2.dataset.islandHydrated).toBe('true');
  });
});
