# Scaffolding

This directory contains templates and generators for creating new applications in the monorepo.

## Go Full-Stack App Generator

Creates a complete Go web application with:
- HTMX + React islands architecture
- templ for type-safe templates
- Firestore integration
- Tailwind CSS styling
- TypeScript E2E tests with Playwright
- Cloud Run deployment ready

### Usage

```bash
./scaffolding/go-fullstack/create.sh <app-name>
```

Example:
```bash
./scaffolding/go-fullstack/create.sh my-awesome-app
```

This will:
1. Create `my-awesome-app/` directory with full application structure
2. Initialize Go modules and npm dependencies
3. Update `pnpm-workspace.yaml` to include the new tests workspace

### Architecture

#### Server-Side (Go)
- **Framework**: Standard library `net/http` with Go 1.22+ routing
- **Templates**: templ for type-safe HTML generation
- **Database**: Firestore (via Google Cloud SDK)
- **Port**: 8080 (Cloud Run standard)

#### Frontend
- **Server-rendered**: templ templates with HTMX for dynamic updates
- **Interactive widgets**: React islands for complex components
- **Bundler**: esbuild (via Go API)
- **Styling**: Tailwind CSS

#### Development
- **Hot reload**: Air watches Go, templ, and TypeScript files
- **Parallel builds**: Makefile runs templ, tailwind, and air concurrently
- **Local development**: `make dev` starts everything

#### Testing
- **E2E tests**: Playwright with TypeScript
- **Test config**: Uses shared `playwright.base.config.ts` from repo root
- **Fixtures**: Automatic remote browser authentication via `playwright.fixtures.ts`

### After Creating an App

1. **Start development server**:
   ```bash
   cd my-awesome-app/site
   make dev
   ```

2. **Access the app**:
   Open http://localhost:8080

3. **Run tests locally**:
   ```bash
   cd my-awesome-app/tests
   npm test
   ```

4. **Build for production**:
   ```bash
   cd my-awesome-app/site
   make build
   ```

5. **Add to root package.json** (manual step):
   ```json
   {
     "scripts": {
       "dev:my-awesome-app": "cd my-awesome-app/site && air",
       "build:my-awesome-app": "cd my-awesome-app/site && make build",
       "test:my-awesome-app": "pnpm test --workspace=my-awesome-app/tests",
       "test:my-awesome-app:deployed": "pnpm run test:deployed --workspace=my-awesome-app/tests"
     }
   }
   ```

### Directory Structure

```
my-awesome-app/
├── site/
│   ├── cmd/server/          # Application entry point
│   ├── internal/
│   │   ├── config/          # Configuration
│   │   ├── firestore/       # Firestore client wrapper
│   │   ├── handlers/        # HTTP handlers
│   │   ├── middleware/      # HTTP middleware
│   │   └── server/          # Router and static assets
│   ├── web/
│   │   ├── templates/       # templ templates
│   │   │   ├── layouts/     # Base layouts
│   │   │   ├── pages/       # Full pages
│   │   │   ├── partials/    # HTMX fragments
│   │   │   └── islands/     # React island wrappers
│   │   └── static/
│   │       ├── css/         # Tailwind input
│   │       └── js/islands/  # React components
│   ├── scripts/             # Build scripts
│   ├── go.mod
│   ├── package.json
│   ├── Dockerfile
│   ├── .air.toml
│   ├── Makefile
│   └── tailwind.config.js
└── tests/
    ├── e2e/                 # Playwright tests
    ├── playwright.config.ts
    ├── tsconfig.json
    └── package.json
```

### Key Files

- `cmd/server/main.go`: Application entry point with graceful shutdown
- `internal/server/server.go`: HTTP router with all routes
- `web/templates/layouts/base.templ`: Base HTML layout
- `web/templates/pages/*.templ`: Page templates
- `web/static/js/islands/index.ts`: React islands hydration
- `scripts/build.go`: esbuild bundler for frontend JavaScript
- `.air.toml`: Hot reload configuration
- `Dockerfile`: Multi-stage build for Cloud Run

### Adding New Pages

1. Create templ template in `web/templates/pages/`
2. Add handler in `internal/handlers/pages.go`
3. Register route in `internal/server/server.go`

### Adding New React Islands

1. Create component in `web/static/js/islands/`
2. Register in `web/static/js/islands/index.ts`
3. Use in templ template: `@islands.ReactIsland("ComponentName", props)`

### Deployment

The app is ready for Cloud Run deployment:
- Dockerfile uses multi-stage build
- Embeds static assets for production
- Runs on port 8080 (Cloud Run default)
- Includes health check endpoint

### Environment Variables

- `PORT`: Server port (default: 8080)
- `GCP_PROJECT_ID`: Google Cloud project ID (default: chalanding)
- `GO_ENV`: Environment mode (development/production)
