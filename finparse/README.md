# finparse

Financial statement parser for budget prototype.

## Installation

```bash
make build
# Binary will be in bin/finparse
```

## Usage

```bash
# Parse all statements to stdout
finparse -input ~/statements

# Parse to file
finparse -input ~/statements -output budget.json

# Dry run to preview
finparse -input ~/statements -dry-run -verbose
```

## Development Status

**Phase 1 Complete:**

- ✅ Project structure
- ✅ Domain types matching TypeScript schema
- ✅ Parser interface and registry
- ✅ File system scanner

**Coming in Phase 2:**

- OFX/QFX parser implementation
- Bank, credit card, investment statement support

**Coming in Phase 3:**

- CSV parser (PNC format)

## Project Structure

```
finparse/
├── cmd/finparse/         # CLI entry point
├── internal/
│   ├── domain/           # Domain types (Transaction, etc.)
│   ├── parser/           # Parser interface
│   ├── registry/         # Parser registry
│   └── scanner/          # File scanner
└── Makefile
```

## License

MIT
