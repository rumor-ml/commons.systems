import React from 'react';
import { createRoot } from 'react-dom/client';
import { BudgetApp } from '../BudgetApp';
import '../styles/main.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);
root.render(React.createElement(BudgetApp));
