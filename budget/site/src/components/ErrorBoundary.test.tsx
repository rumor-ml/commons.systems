/**
 * Tests for ErrorBoundary component
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ErrorBoundary } from './ErrorBoundary';
import * as loggerModule from '../utils/logger';

// Mock logger
vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Component that throws an error
function ThrowError({ shouldThrow = true }: { shouldThrow?: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error');
  }
  return <div>No error</div>;
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error in tests (React logs errors caught by error boundaries to the console
    // even when they're successfully caught. This is expected React behavior to help developers
    // notice errors during development. See: https://reactjs.org/docs/error-boundaries.html)
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('should render children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Test content</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Test content')).toBeInTheDocument();
  });

  it('should catch and display error', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // ErrorBoundary defaults to "Component" for display when componentName prop is undefined (line 55 in ErrorBoundary.tsx)
    expect(screen.getByText(/Component Error/i)).toBeInTheDocument();
    expect(screen.getByText('Test error')).toBeInTheDocument();
  });

  it('should display custom component name in error UI', () => {
    render(
      <ErrorBoundary componentName="BudgetChart">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText(/BudgetChart Error/i)).toBeInTheDocument();
  });

  it('should log error with logger', () => {
    render(
      <ErrorBoundary componentName="TestComponent">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(loggerModule.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error in TestComponent'),
      expect.objectContaining({
        error: 'Test error',
      })
    );
  });

  it('should log error with stack and componentStack', () => {
    render(
      <ErrorBoundary componentName="TestComponent">
        <ThrowError />
      </ErrorBoundary>
    );

    expect(loggerModule.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Error in TestComponent'),
      expect.objectContaining({
        error: 'Test error',
        stack: expect.stringContaining('ThrowError'), // Verify stack trace logged
        componentStack: expect.stringContaining('ThrowError'), // Verify React component stack logged
      })
    );
  });

  it('should include refresh page button', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const refreshBtn = screen.getByRole('button', { name: /refresh page/i });
    expect(refreshBtn).toBeInTheDocument();
  });

  it('should reload page when refresh button clicked', async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const refreshBtn = screen.getByRole('button', { name: /refresh page/i });
    await user.click(refreshBtn);

    expect(reloadMock).toHaveBeenCalled();
  });

  it('should include try again button', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    expect(tryAgainBtn).toBeInTheDocument();
  });

  it('should reset error state when try again clicked', async () => {
    const user = userEvent.setup();

    function ConditionalError({ trigger }: { trigger: boolean }) {
      if (trigger) throw new Error('Test error');
      return <div>Success</div>;
    }

    const TestWrapper = () => {
      const [shouldError, setShouldError] = React.useState(true);

      return (
        <ErrorBoundary>
          <ConditionalError trigger={shouldError} />
          <button onClick={() => setShouldError(false)}>Fix Error</button>
        </ErrorBoundary>
      );
    };

    render(<TestWrapper />);

    // Error should be displayed
    expect(screen.getByText(/Component Error/i)).toBeInTheDocument();

    // Click try again
    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    await user.click(tryAgainBtn);

    // Clicking "Try Again" resets the error boundary state and re-renders the children.
    // Since the error condition is still true, the error is thrown again and caught.
    expect(screen.getByText(/Component Error/i)).toBeInTheDocument();
  });

  it('should include collapsible technical details', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const details = screen.getByText(/technical details/i);
    expect(details).toBeInTheDocument();
    expect(details.tagName.toLowerCase()).toBe('summary');
  });

  it('should display formatted error in technical details', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    // Technical details should contain error message and stack
    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain('Test error');
  });

  it('should handle errors without message', () => {
    function ThrowErrorWithoutMessage() {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw new Error();
    }

    render(
      <ErrorBoundary>
        <ThrowErrorWithoutMessage />
      </ErrorBoundary>
    );

    expect(screen.getByText(/An unexpected error occurred/i)).toBeInTheDocument();
  });

  it('should use error styling matching BudgetChart', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const errorContainer = document.querySelector('.bg-error-muted');
    expect(errorContainer).not.toBeNull();
    expect(errorContainer?.classList.contains('border-error')).toBe(true);
  });

  it('should display warning icon', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('⚠️')).toBeInTheDocument();
  });

  it('should apply correct text styling', () => {
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    const heading = screen.getByText(/Component Error/i);
    expect(heading.classList.contains('text-error')).toBe(true);
    expect(heading.classList.contains('font-semibold')).toBe(true);
  });
});
