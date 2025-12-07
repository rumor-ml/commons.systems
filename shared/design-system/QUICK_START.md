# Quick Start Guide

## Installation

The package is already available in the monorepo workspace:

```bash
# From any app in the monorepo
pnpm add @commons/design-system
```

## Basic Usage

### Option 1: Import Everything

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My App</title>

    <!-- Import complete design system -->
    <style>
      @import '@commons/design-system';
    </style>
  </head>
  <body>
    <div class="container">
      <h1 class="text-heading-1">Hello World</h1>
      <button class="btn btn--primary">Click Me</button>
    </div>
  </body>
</html>
```

### Option 2: Import Layers Separately

```css
/* main.css */

/* Design tokens */
@import '@commons/design-system/tokens';

/* Base styles */
@import '@commons/design-system/base';

/* Only the components you need */
@import '@commons/design-system/components/buttons';
@import '@commons/design-system/components/cards';
@import '@commons/design-system/components/forms';

/* Layout utilities */
@import '@commons/design-system/layouts';

/* Optional: utility classes */
@import '@commons/design-system/utilities';
```

### Option 3: With Vite/Build Tools

```js
// main.js or index.js
import '@commons/design-system';

// Or specific components
import '@commons/design-system/components/buttons';
import '@commons/design-system/components/cards';
```

## Quick Examples

### Button Variants

```html
<button class="btn btn--primary">Primary</button>
<button class="btn btn--secondary">Secondary</button>
<button class="btn btn--outline">Outline</button>
<button class="btn btn--ghost">Ghost</button>

<!-- With sizes -->
<button class="btn btn--primary btn--sm">Small</button>
<button class="btn btn--primary btn--lg">Large</button>

<!-- Icon button -->
<button class="btn btn--primary btn--icon">⚡</button>
```

### Form with Cyan Focus Glow

```html
<div class="form-group">
  <label class="label" for="email">Email</label>
  <input type="email" class="input" id="email" placeholder="you@example.com" />
  <span class="help-text">We'll never share your email.</span>
</div>

<div class="form-group">
  <label class="label" for="message">Message</label>
  <textarea class="textarea" id="message" placeholder="Your message..."></textarea>
</div>

<button class="btn btn--primary">Submit</button>
```

### Interactive Card with Hover Lift

```html
<div class="card card--interactive">
  <div class="card__header">
    <h3 class="card__title">Project Name</h3>
    <span class="card__badge">Active</span>
  </div>
  <div class="card__body">Hover to see the signature 4px lift effect with shadow.</div>
  <div class="card__footer">
    <button class="btn btn--primary btn--sm">View Details</button>
  </div>
</div>
```

### Grid Layout

```html
<div class="container">
  <div class="grid md:grid-cols-3 gap-4">
    <div class="card">Card 1</div>
    <div class="card">Card 2</div>
    <div class="card">Card 3</div>
  </div>
</div>
```

### Navigation

```html
<nav class="topbar">
  <a href="/" class="topbar__logo">My App</a>
  <div class="topbar__nav">
    <a href="/" class="nav-item nav-item--active">Home</a>
    <a href="/about" class="nav-item">About</a>
    <a href="/contact" class="nav-item">Contact</a>
  </div>
</nav>
```

### Loading States

```html
<!-- Spinner -->
<div class="loading">
  <div class="spinner spinner--glow"></div>
  <p class="loading__message">Loading...</p>
</div>

<!-- Progress bar -->
<div class="progress">
  <div class="progress__bar" style="width: 65%"></div>
</div>

<!-- Skeleton loader -->
<div class="skeleton skeleton--heading"></div>
<div class="skeleton skeleton--text"></div>
<div class="skeleton skeleton--text"></div>
```

## Using Design Tokens

Access CSS custom properties directly:

```css
.custom-component {
  background-color: var(--color-bg-surface);
  color: var(--color-text-primary);
  padding: var(--spacing-4);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  transition: all var(--duration-normal) var(--ease-out-expo);
}

.custom-component:hover {
  background-color: var(--color-bg-elevated);
  box-shadow: var(--shadow-glow); /* Signature cyan glow */
}
```

## Tailwind Integration

If your app uses Tailwind, use the preset:

```js
// tailwind.config.js
import designSystemPreset from '@commons/design-system/tailwind/preset';

export default {
  presets: [designSystemPreset],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      // Your custom extensions
    },
  },
};
```

Then use Tailwind classes with design system tokens:

```html
<div class="bg-bg-surface text-text-primary p-4 rounded-lg shadow-glow">
  <h2 class="text-2xl font-semibold text-primary">Hello World</h2>
</div>
```

## Signature Effects in Action

### Cyan Focus Glow (Automatic)

All focusable elements automatically get the cyan glow:

```html
<input type="text" class="input" />
<!-- Tab to focus -->
<button class="btn btn--primary">Button</button>
<!-- Tab to focus -->
```

### Button Hover Glow

Primary buttons glow cyan on hover:

```html
<button class="btn btn--primary">Hover Me</button>
```

### Card Hover Lift

Interactive cards lift 4px on hover:

```html
<div class="card card--interactive">Hover to see lift effect</div>
```

## Demo Page

Open `/Users/n8/worktrees/apply-frontend-skill/shared/design-system/demo.html` in a browser to see all components and effects in action.

## Next Steps

- Browse `README.md` for complete documentation
- Check `IMPLEMENTATION.md` for technical details
- Explore `src/` directory for all available CSS files
- Use `demo.html` as a reference for component usage

## Tips

1. **Always import tokens first** if building custom components
2. **Use semantic color names** (`--color-text-primary`) not raw colors
3. **Leverage CSS custom properties** for consistency
4. **Follow the 8px spacing scale** for layouts
5. **Use signature effects** (cyan glow, hover lift) to maintain brand identity
