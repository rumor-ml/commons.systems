import React from 'react';

export function FirebaseSetupGuide() {
  return (
    <div className="bg-bg-surface rounded-lg p-6 max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold text-text-primary mb-2">Firebase Setup Required</h2>
        <p className="text-text-secondary">
          Firebase is not configured. Choose one of the options below to get started.
        </p>
      </div>

      <div className="space-y-4">
        {/* Option 1: QA Environment */}
        <div className="bg-bg-elevated rounded-lg p-5 border border-bg-hover">
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            Option 1: QA Environment (Recommended for Testing)
          </h3>
          <p className="text-text-secondary mb-3 text-sm">
            Launch a local development environment with Firebase emulators and sample data. This is
            the fastest way to test the application without setting up a Firebase project.
          </p>
          <div className="bg-bg-void rounded p-3 font-mono text-sm mb-3">
            <code className="text-primary">make dev-qa</code>
          </div>
          <p className="text-text-tertiary text-xs">
            This will start Firebase emulators and the development server with pre-configured
            settings. The app will be available at http://localhost:5173
          </p>
        </div>

        {/* Option 2: Production Firebase */}
        <div className="bg-bg-elevated rounded-lg p-5 border border-bg-hover">
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            Option 2: Production Firebase Setup
          </h3>
          <p className="text-text-secondary mb-3 text-sm">
            Connect to a real Firebase project for production use or personal testing.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-sm text-text-secondary mb-3">
            <li>
              Create a Firebase project at{' '}
              <a
                href="https://console.firebase.google.com/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:text-primary-hover underline"
              >
                Firebase Console
              </a>
            </li>
            <li>Enable Firestore Database in your project</li>
            <li>Go to Project Settings &gt; General to find your configuration values</li>
            <li>
              Copy <code className="text-primary">budget/site/.env.example</code> to{' '}
              <code className="text-primary">budget/site/.env</code>
            </li>
            <li>Fill in your Firebase configuration values in the .env file</li>
            <li>Restart the development server</li>
          </ol>
          <p className="text-text-tertiary text-xs">
            Note: Never commit your .env file to version control. It contains sensitive
            configuration data.
          </p>
        </div>
      </div>

      {/* Additional Help */}
      <div className="mt-6 pt-4 border-t border-bg-hover">
        <p className="text-text-tertiary text-sm text-center">
          Need help? Check the README or contact support for assistance with Firebase setup.
        </p>
      </div>
    </div>
  );
}
