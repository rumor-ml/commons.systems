# Budget Visualization App

A frontend-only budget visualization application built with React, Observable Plot, and the @commons design system.

## Features

- **Interactive Stacked Bar Charts**: View income and expenses by category over time
- **Category Filtering**: Toggle individual spending categories on/off
- **Vacation Filter**: Show or hide vacation-related expenses
- **Net Income Line**: Track your net income month by month
- **3-Month Trailing Average**: See spending trends with a rolling average
- **Redeemable Transactions**: Automatically adjusts display for rewards/cashback
- **Summary Statistics**: Real-time totals for income, expenses, net income, and savings rate

## Data Model

The app uses a hierarchical data structure:

- **Institutions** (banks, credit card companies)
  - **Accounts** (checking, savings, credit cards)
    - **Statements** (monthly billing periods)
      - **Transactions** (individual purchases/deposits)

Each transaction includes:

- Amount (positive for income, negative for expenses)
- Category (income, housing, utilities, groceries, dining, etc.)
- Redeemable flag (for cashback/rewards)
- Vacation flag (for travel expenses)
- Transfer flag (excluded from charts)
- Redemption rate (default 0.5 for 50% cashback)

## Getting Started

### Prerequisites

- Node.js 18+ and pnpm installed
- This is a monorepo workspace package

### Development

```bash
# From the budget/site directory
pnpm dev
```

The dev server will start at http://localhost:3001

### Build

```bash
# Production build
pnpm build

# Preview production build
pnpm preview
```

## Project Structure

```
budget/site/
├── src/
│   ├── index.html          # Main HTML entry
│   ├── BudgetApp.tsx       # Main app with state management
│   ├── styles/
│   │   └── main.css        # App styles + design system
│   ├── scripts/
│   │   └── main.ts         # App initialization
│   ├── data/
│   │   └── transactions.json  # Fake transaction data
│   └── islands/
│       ├── index.ts        # Island hydration
│       ├── types.ts        # TypeScript types
│       ├── BudgetChart.tsx # Observable Plot chart
│       └── Legend.tsx      # Interactive legend
├── package.json
├── vite.config.js
└── tsconfig.json
```

## Technology Stack

- **React 18**: Component framework
- **Observable Plot 0.6**: Declarative charting library
- **D3 7.9**: Data manipulation
- **Vite 5**: Build tool and dev server
- **TypeScript 5**: Type safety
- **Tailwind CSS**: Utility-first styling
- **@commons/design-system**: Shared design tokens and components

## Architecture

This is a frontend-only application with no backend requirements:

- All data is loaded from a static JSON file
- React islands pattern for selective hydration
- Observable Plot for declarative, data-driven charts
- Responsive design with CSS Grid
- Supports dark/light themes via design system

## Customization

### Adding More Data

Edit `src/data/transactions.json` to add more transactions, accounts, or institutions. The format follows the TypeScript interfaces defined in `src/islands/types.ts`.

### Modifying Categories

Categories are defined in `src/islands/types.ts` as the `Category` type. To add new categories:

1. Update the `Category` type
2. Add colors in `BudgetChart.tsx` (categoryColors object)
3. Add labels in `Legend.tsx` (CATEGORY_LABELS object)

### Changing the Chart

The chart configuration is in `BudgetChart.tsx` using Observable Plot's declarative API. Refer to the [Observable Plot documentation](https://observablehq.com/plot/) for customization options.

## License

Part of the commons.systems monorepo.
