# @commons/design-system

Unified design system with refined minimalism + retro-futuristic aesthetic.

## Design Direction

**Refined Minimalism + Retro-Futuristic**

- Electric cyan (`#00d4ed`) as signature accent with glowing effects
- Warm near-black backgrounds for depth
- Geist Sans/Mono fonts from Vercel
- Signature: cyan edge glow on interactive elements
- Hover lift effects on cards (4px)
- Smooth, expressive animations

## Installation

```bash
pnpm add @commons/design-system
```

## Usage

### Complete System

Import the entire design system:

```css
@import '@commons/design-system';
```

### Individual Layers

Import only what you need:

```css
/* Tokens only */
@import '@commons/design-system/tokens';

/* Base styles */
@import '@commons/design-system/base';

/* Components */
@import '@commons/design-system/components';

/* Specific components */
@import '@commons/design-system/components/buttons';
@import '@commons/design-system/components/forms';
@import '@commons/design-system/components/cards';
```

### With Tailwind CSS

Use the Tailwind preset for hybrid apps:

```js
// tailwind.config.js
import designSystemPreset from '@commons/design-system/tailwind/preset';

export default {
  presets: [designSystemPreset],
  content: ['./src/**/*.{html,js,jsx,ts,tsx}'],
  // Your custom config...
};
```

## Components

### Buttons

```html
<button class="btn btn--primary">Primary Button</button>
<button class="btn btn--secondary">Secondary</button>
<button class="btn btn--outline">Outline</button>
<button class="btn btn--ghost">Ghost</button>
```

**Button Variants:**
- `.btn--primary` - Electric cyan with glow on hover (signature)
- `.btn--secondary` - Soft violet
- `.btn--outline` - Transparent with border
- `.btn--ghost` - Transparent, no border
- `.btn--danger` - Error red
- `.btn--success` - Success green

**Button Sizes:**
- `.btn--sm` - Small
- `.btn--lg` - Large
- `.btn--xl` - Extra large

### Forms

```html
<div class="form-group">
  <label class="label">Email</label>
  <input type="email" class="input" placeholder="you@example.com" />
  <span class="help-text">We'll never share your email.</span>
</div>
```

**Form Components:**
- `.input` - Text input with cyan focus glow
- `.textarea` - Multi-line text input
- `.select` - Select dropdown
- `.checkbox` - Checkbox with cyan checked state
- `.radio` - Radio button
- `.switch` - Toggle switch

### Cards

```html
<div class="card card--interactive">
  <div class="card__header">
    <h3 class="card__title">Card Title</h3>
  </div>
  <div class="card__body">
    Card content goes here.
  </div>
  <div class="card__footer">
    <button class="btn btn--primary">Action</button>
  </div>
</div>
```

**Card Features:**
- `.card--interactive` - Hover lift effect (signature 4px lift)
- `.card--primary` - Cyan border with glow
- `.card--elevated` - Elevated shadow

### Navigation

```html
<nav class="nav">
  <a href="#" class="nav-item nav-item--active">Home</a>
  <a href="#" class="nav-item">About</a>
  <a href="#" class="nav-item">Contact</a>
</nav>
```

**Navigation Components:**
- `.nav` - Basic navigation
- `.nav-item` - Navigation item with hover states
- `.nav-item--active` - Active state with cyan accent
- `.sidebar` - Vertical sidebar navigation
- `.topbar` - Top navigation bar
- `.tabs` - Tabbed navigation with cyan underline

### Modals

```html
<div class="modal-backdrop">
  <div class="modal">
    <div class="modal__header">
      <h2 class="modal__title">Modal Title</h2>
      <button class="modal__close">×</button>
    </div>
    <div class="modal__body">
      Modal content...
    </div>
    <div class="modal__footer">
      <button class="btn btn--ghost">Cancel</button>
      <button class="btn btn--primary">Confirm</button>
    </div>
  </div>
</div>
```

### Loading States

```html
<!-- Spinner -->
<div class="spinner spinner--glow"></div>

<!-- Progress bar -->
<div class="progress">
  <div class="progress__bar" style="width: 60%"></div>
</div>

<!-- Skeleton loader -->
<div class="skeleton skeleton--text"></div>
<div class="skeleton skeleton--heading"></div>
```

## Design Tokens

### Colors

```css
/* Backgrounds */
--color-bg-void: #0a0a0c;
--color-bg-base: #111114;
--color-bg-surface: #18181c;
--color-bg-elevated: #1f1f24;

/* Primary - Electric Cyan (signature) */
--color-primary: #00d4ed;
--color-primary-hover: #00b8d4;
--color-primary-glow: 0 0 20px rgba(0, 212, 237, 0.4);

/* Text */
--color-text-primary: #f0f0f2;
--color-text-secondary: #a0a0a8;
--color-text-tertiary: #606068;
```

### Typography

```css
/* Font families */
--font-sans: 'Geist', ...system fonts;
--font-mono: 'Geist Mono', ...monospace fonts;

/* Type scale */
--font-size-xs: 0.75rem;    /* 12px */
--font-size-sm: 0.875rem;   /* 14px */
--font-size-base: 1rem;     /* 16px */
--font-size-lg: 1.25rem;    /* 20px */
--font-size-xl: 1.5rem;     /* 24px */
--font-size-2xl: 2rem;      /* 32px */
```

### Spacing

8px base scale:

```css
--spacing-1: 0.25rem;   /* 4px */
--spacing-2: 0.5rem;    /* 8px */
--spacing-3: 0.75rem;   /* 12px */
--spacing-4: 1rem;      /* 16px */
--spacing-6: 1.5rem;    /* 24px */
--spacing-8: 2rem;      /* 32px */
```

### Shadows

```css
/* Standard elevation */
--shadow-sm, --shadow-md, --shadow-lg, --shadow-xl

/* Signature: Cyan glow */
--shadow-glow: 0 0 20px rgba(0, 212, 237, 0.4);
--shadow-glow-subtle: 0 0 10px rgba(0, 212, 237, 0.2);
--shadow-glow-intense: 0 0 30px rgba(0, 212, 237, 0.6);

/* Focus ring with glow */
--shadow-focus: 0 0 0 3px var(--color-primary-muted), var(--shadow-glow);
```

### Motion

```css
/* Signature easing */
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);

/* Duration */
--duration-fast: 100ms;
--duration-normal: 200ms;
--duration-slow: 300ms;
```

## Signature Effects

### 1. Cyan Glow on Focus

All focusable elements automatically get cyan ring + glow:

```css
:focus-visible {
  outline: 2px solid var(--color-primary);
  box-shadow: var(--shadow-focus);
}
```

### 2. Hover Lift on Cards

Interactive cards lift 4px on hover:

```css
.card--interactive:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lift);
}
```

### 3. Button Glow

Primary buttons get cyan shadow on hover:

```css
.btn--primary:hover {
  box-shadow: var(--shadow-glow);
}
```

## Layout Utilities

### Container

```html
<div class="container">
  <!-- Max-width responsive container -->
</div>

<div class="container container--sm">
  <!-- Small container -->
</div>
```

### Grid

```html
<div class="grid grid-cols-3 gap-4">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>

<!-- Auto-fit responsive -->
<div class="grid grid-auto-fit gap-4">
  <!-- Automatically creates responsive columns -->
</div>
```

### Flexbox

```html
<div class="flex items-center justify-between">
  <div>Left</div>
  <div>Right</div>
</div>

<div class="stack">
  <!-- Vertical stack with gap -->
</div>
```

## Accessibility

- All interactive elements have focus states with cyan glow
- Respects `prefers-reduced-motion`
- Respects `prefers-contrast: high`
- Includes `.sr-only` utility for screen readers
- Skip to main content link

## Browser Support

Modern browsers with CSS custom properties support:
- Chrome 88+
- Firefox 85+
- Safari 14+
- Edge 88+

## License

ISC
