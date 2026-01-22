# Budget Site

Full-stack budget visualization app with Go backend and React/HTMX frontend.

## Architecture

- **Backend**: Go server with Firebase Auth and Firestore
- **Frontend**: Hybrid React islands + HTMX for new features
- **Data Storage**: Firestore (multi-user with access control)
- **Auth**: Firebase Auth with GitHub sign-in

## Current Status

This app is being migrated from frontend-only to full-stack:

- ✅ Go backend server with Firestore integration
- ✅ REST API endpoints for transactions, statements, accounts
- 🚧 Frontend API integration (in progress)
- 🚧 Transaction review page (in progress)
- 🚧 Firebase Auth implementation (planned)

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

## Backend API

### Firestore Collections

1. **budget-transactions**: Individual financial transactions
   - userId, date, description, amount, category
   - redeemable, vacation, transfer flags
   - statementIds array for linking

2. **budget-statements**: Statement periods
   - userId, accountId, startDate, endDate
   - transactionIds array

3. **budget-accounts**: User accounts
   - userId, institutionId, name, type

4. **budget-institutions**: Financial institutions
   - userId, name

### API Endpoints

#### Protected (require Firebase Auth token)

- `GET /api/transactions` - List all user's transactions
- `GET /api/statements` - List all user's statements
- `GET /api/accounts` - List all user's accounts
- `GET /api/institutions` - List all user's institutions

#### Public

- `GET /health` - Health check
- `GET /` - Serve frontend (static files)

## Development Setup

### Prerequisites

- Go 1.25.4+
- Node.js 18+ and pnpm
- Firebase project with Firestore enabled
- Firebase service account credentials

### Configuration

Set environment variables:

```bash
export FIREBASE_PROJECT_ID="your-project-id"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

### Running

```bash
# Install dependencies
make install-deps

# Run backend and frontend concurrently
make dev
```

- Backend: http://localhost:8080
- Frontend: http://localhost:5173

### Building

```bash
make build              # Build both backend and frontend
make build-backend      # Build only backend
make build-frontend     # Build only frontend
```

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
