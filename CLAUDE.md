**CRITICAL: always run git/gh/nix/gcloud/`go mod tidy` commands with dangerouslyDisableSandbox: true**

**CRITICAL: After exiting plan mode, do NOT make edits directly.** Use the Task tool with `subagent_type="accept-edits"` to execute the plan.

Trust user bug reports. Do not assume caching errors or user error while building.

If creating temporary artifacts such as debugging scripts, commit messages, or status/process documentation always write to /tmp/claude directory so that artifacts are not committed.

# Definition of Done
Keep iterating until problem resolution is fully verified by test results, logs or workflow output.

Do not ask user to fetch test results, logs or monitor workflows when you can do so yourself.

# Frontend Architecture

## Design Philosophy: HTMX-First with React Islands

Prioritize HTMX for UI interactions. Use React islands only to fill gaps where HTMX cannot handle the complexity.

### When to Use HTMX
- Server-Sent Events (SSE) real-time updates via `hx-ext="sse"`
- Form submissions and CRUD operations via `hx-post`, `hx-get`, etc.
- Partial page updates via `hx-target` and `hx-swap`
- Loading states via `hx-indicator`
- Modals and dialogs (append to body, dismiss on action)
- Simple expand/collapse via native `<details>/<summary>`

### When to Use React Islands
- Complex client-side state that cannot be server-driven
- Interactive components requiring frequent local state changes
- Third-party React-only libraries (charts, editors)
- Rich drag-and-drop or canvas interactions

### SSE Pattern
For real-time updates, use HTMX SSE extension:
```html
<div hx-ext="sse" sse-connect="/api/stream">
  <div id="target" sse-swap="event-name" hx-swap="innerHTML">
    <!-- Server sends HTML, HTMX swaps it -->
  </div>
</div>
```

Backend should render templ partials to HTML for SSE events, not JSON.

### Out-of-Band Updates
Use `hx-swap-oob="true"` for targeted element updates:
```html
<div id="file-123" hx-swap-oob="true">Updated content</div>
```

# Shared Design System

## Location
`shared/design-system/` - Shared across all apps (printsync, financesync, etc.)

## Usage in Apps
1. Import Tailwind preset in `tailwind.config.js`:
   ```js
   import preset from '@commons/design-system/tailwind/preset.js'
   export default { presets: [preset], ... }
   ```

2. Import CSS in app's `input.css`:
   ```css
   @import '@commons/design-system';
   @tailwind base;
   @tailwind components;
   @tailwind utilities;
   ```

## Key Design Tokens

### Colors (CSS Variables - auto theme switching)
- Backgrounds: `bg-void`, `bg-base`, `bg-surface`, `bg-elevated`, `bg-hover`, `bg-active`
- Text: `text-primary`, `text-secondary`, `text-tertiary`
- Primary (Electric Cyan): `primary`, `primary-hover`, `primary-active`, `primary-muted`
- Secondary (Soft Violet): `secondary`, `secondary-hover`, `secondary-active`, `secondary-muted`
- Semantic: `success`, `warning`, `error` (each with hover/muted variants)

### Typography
- Font families: `font-sans` (Geist), `font-mono` (Geist Mono)
- Sizes: `text-xs` through `text-4xl`

### Effects
- Shadows: `shadow-xs` through `shadow-2xl`
- Glow effects: `shadow-glow`, `shadow-glow-subtle`, `shadow-glow-sm`, `shadow-glow-md`
- Transitions: `duration-fast` (100ms), `duration-normal` (200ms), `duration-slow` (300ms)

### Component Classes (from design system CSS)
- Buttons: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-error`, `.btn-ghost`, `.btn-sm`
- Cards: `.card`, `.card-elevated`
- Forms: `.input`, `.input-error`, `.label`
- Loading: `.spinner`, `.spinner-sm`
- Modals: `.modal-overlay`, `.modal-content`

### HTMX Indicator Pattern
```css
.htmx-indicator { display: none; }
.htmx-request .htmx-indicator { display: inline-block; }
``` 
