# {{APP_NAME_TITLE}}

A terminal user interface (TUI) application built with [Bubbletea](https://github.com/charmbracelet/bubbletea).

## Quick Start

```bash
# Build the application
make build

# Run in development mode
make dev

# Run tests
make test
```

## Project Structure

```
{{APP_NAME}}/
├── cmd/{{APP_NAME}}/     # Application entry point
│   └── main.go
├── internal/
│   ├── model/            # Bubbletea model (state + update logic)
│   │   ├── model.go
│   │   └── model_test.go
│   └── ui/               # UI rendering
│       ├── renderer.go
│       └── renderer_test.go
├── tests/                # Integration/E2E tests
│   └── e2e_test.go
├── go.mod
├── Makefile
└── README.md
```

## Development

### Building

```bash
make build
```

The binary will be placed in `./build/{{APP_NAME}}`.

### Testing

```bash
# Run all tests
make test

# Run only unit tests
make test-unit

# Run only E2E tests
make test-e2e
```

### Using the Test Framework

This app integrates with the monorepo test framework:

```bash
# From repo root
./infrastructure/scripts/run-tests.sh {{APP_NAME}}
```

## Architecture

This app follows the [Elm Architecture](https://guide.elm-lang.org/architecture/) pattern:

- **Model**: Application state in `internal/model/model.go`
- **Update**: Message handling and state updates
- **View**: UI rendering in `internal/ui/renderer.go`

## Customization

1. Edit `internal/model/model.go` to add your application state
2. Edit `internal/ui/renderer.go` to customize the UI
3. Add new message types and handlers as needed
