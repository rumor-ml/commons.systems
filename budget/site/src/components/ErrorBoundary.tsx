/**
 * React Error Boundary for Budget module islands
 *
 * Catches render errors in child component tree and displays fallback UI.
 * Logs errors via structured logger. Includes stack traces for Error instances
 * and React component stack for all errors.
 * Fallback UI matches BudgetChart error styling for consistency.
 */

import React from 'react';
import { logger } from '../utils/logger';
import { formatBudgetError } from '../utils/errors';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /**
   * Display name for the component in error messages.
   * Should be a meaningful non-empty string.
   * Defaults to "Unknown Component" if not provided.
   */
  componentName?: string;
}

type ErrorBoundaryState =
  | {
      hasError: false;
      error: null;
    }
  | {
      hasError: true;
      error: Error;
    };

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const componentName = this.props.componentName || 'Unknown Component';

    logger.error(`Error in ${componentName}:`, {
      error: error.message,
      stack: error.stack ?? 'No stack trace available',
      componentStack: errorInfo.componentStack,
    });
  }

  handleRefresh = (): void => {
    try {
      window.location.reload();
    } catch (error) {
      logger.error('Failed to reload page', error);
      // Fallback: try to navigate to current URL
      try {
        window.location.href = window.location.href;
      } catch (fallbackError) {
        logger.error('Failed to navigate to current URL', fallbackError);
        logger.error('All page refresh mechanisms failed', {
          reloadError: error,
          navigateError: fallbackError,
          userAgent: navigator.userAgent,
          pageUrl: window.location.href,
        });
        alert(
          'Unable to refresh the page automatically. Please refresh manually using your browser (Ctrl+R or Cmd+R).'
        );
      }
    }
  };

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      const componentName = this.props.componentName || 'Component';
      const errorMessage = this.state.error.message || 'An unexpected error occurred';
      const formattedError = formatBudgetError(this.state.error, true);

      return (
        <div className="p-8 bg-error-muted rounded-lg border border-error">
          <div className="flex items-start gap-3">
            <span className="text-error text-2xl">⚠️</span>
            <div className="flex-1">
              <h3 className="text-error font-semibold mb-1">{componentName} Error</h3>
              <p className="text-error text-sm mb-3">{errorMessage}</p>

              <div className="flex gap-2 mb-3">
                <button onClick={this.handleRefresh} className="btn btn-sm btn-error">
                  Refresh Page
                </button>
                <button onClick={this.handleReset} className="btn btn-sm btn-ghost">
                  Try Again
                </button>
              </div>

              <details className="text-xs text-error opacity-75">
                <summary className="cursor-pointer hover:opacity-100">
                  Technical details (for debugging)
                </summary>
                <pre className="mt-2 p-2 bg-bg-base rounded overflow-x-auto text-text-secondary">
                  {formattedError}
                </pre>
              </details>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
