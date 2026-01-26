# Mythic Bastionland Realms - Procedural Hex Map Generator

## Overview

This is a procedural hex map generator for Mythic Bastionland RPG adventures. It generates random wilderness regions with terrain types, encounters, points of interest, and resources.

## Features

- **Procedural Generation**: Uses seeded random number generation for reproducible maps
- **Interactive Hex Grid**: Click hexes to view detailed information
- **Terrain Diversity**: 8 different terrain types with varying travel difficulty
- **Dynamic Content**: Random points of interest, encounters, and resources
- **Export Functionality**: Save maps as JSON for later use
- **Responsive Design**: Works on desktop and mobile devices

## Architecture

### React Islands Pattern

This app uses the "islands" architecture:

- HTMX handles page structure and navigation
- React components are hydrated as interactive "islands"
- Main island: `HexMap` component

### File Structure

```
realms/
├── site/
│   ├── src/
│   │   ├── index.html          # Main HTML shell
│   │   ├── styles/
│   │   │   └── main.css        # Global styles with design system
│   │   ├── scripts/
│   │   │   └── main.js         # Island hydration
│   │   └── islands/
│   │       ├── index.js        # Island registry
│   │       └── HexMap.jsx      # Main hex map component
│   ├── package.json
│   ├── vite.config.js
│   └── tailwind.config.js
└── tests/
    ├── test-realms.spec.js     # E2E tests
    ├── playwright.config.js
    └── package.json
```

## Hex Map System

### Coordinate System

Uses axial coordinates (q, r) for hexagonal grid:

- Point-topped hexagons
- Each hex represents ~1 day's travel (6 miles)
- Radius determines map size

### Terrain Types

1. **Plains** (difficulty 1) - Easy travel, open terrain
2. **Forest** (difficulty 2) - Moderate cover, slower travel
3. **Hills** (difficulty 2) - Elevated terrain, good visibility
4. **Mountains** (difficulty 3) - Difficult passage, requires climbing
5. **Swamp** (difficulty 3) - Treacherous footing, disease risk
6. **Water** (difficulty 4) - Requires swimming or boats
7. **Desert** (difficulty 2) - Hot, dry, water scarcity
8. **Tundra** (difficulty 3) - Cold, harsh conditions

### Random Elements

- **Points of Interest** (20% chance): Ruins, monuments, settlements
- **Encounters** (25% chance): Creatures, travelers, events
- **Resources** (30% chance): Water, food, shelter

## Development

### Local Development

```bash
cd realms/site
pnpm install
pnpm run dev
```

### Build for Production

```bash
cd realms/site
pnpm run build
```

### Run Tests

```bash
cd realms/tests
pnpm install
pnpm test
```

## Design System Integration

Uses the shared Commons design system:

- CSS variables for theming
- Automatic dark/light mode
- Consistent component styles
- Tailwind CSS for utilities

## Future Enhancements

- Save/load maps from browser storage
- Share maps via URL with seed parameter
- More detailed hex descriptions
- Weather and season systems
- Travel time calculator
- Print-friendly map view
- Custom terrain types
- Hex notes and annotations
