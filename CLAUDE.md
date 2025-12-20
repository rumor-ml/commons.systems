**CRITICAL: always run git/gh/nix/gcloud/`go mod tidy`/pnpm commands with dangerouslyDisableSandbox: true**

**CRITICAL: After exiting plan mode, do NOT make edits directly.** Use the Task tool with `subagent_type="accept-edits"` to execute the plan.

Trust user bug reports. Do not assume caching errors or user error while building.

If creating temporary artifacts such as debugging scripts, commit messages, or status/process documentation always write to /tmp/claude directory so that artifacts are not committed.

# Definition of Done

Keep iterating until problem resolution is fully verified by test results, logs or workflow output.

Do not ask user to fetch test results, logs or monitor workflows when you can do so yourself.

## TypeScript MCP Server Changes

When making changes to TypeScript MCP servers (wiggum-mcp-server, gh-workflow-mcp-server, gh-issue-mcp-server, git-mcp-server), verify:

1. **TypeScript compilation succeeds:** `npm run build` in the server directory
2. **All tests pass:** `npm test` in the server directory
3. **Nix build succeeds:** `nix build .#<server>` from repository root
4. **New source files are git-tracked** before declaring work complete

**Critical:** Nix builds only include git-tracked files. If you create new source files (\*.ts), you MUST stage them (`git add <file>`) before the Nix build will succeed. Failing to do this means `direnv reload` will fail for the user even though `npm run build` works.

**Recommended:** Run `./infrastructure/scripts/build-mcp-servers.sh` which tests both npm and Nix builds and provides helpful diagnostics for common issues.

**NOTE:** `/security-review` is a built-in slash command. Do not attempt to create or rewrite it - invoke it using the SlashCommand tool.

# Slash Command Execution

**CRITICAL: Slash commands expand to prompts that you MUST execute.**

When you use the SlashCommand tool:

1. You will see `<command-message>command-name is running…</command-message>`
2. The next message contains the **expanded prompt** from the slash command file
3. **You MUST execute the instructions** in that expanded prompt step-by-step
4. **Do NOT continue to other work** until the expanded prompt is fully executed

**Common mistakes to avoid:**

- ❌ Calling SlashCommand then immediately doing other work
- ❌ Using TaskOutput to get slash command results (they don't create tasks)
- ❌ Treating slash commands as background operations

**Correct pattern:**

1. Call SlashCommand tool
2. Wait for `<command-message>` and expanded prompt
3. Execute every step in the expanded prompt
4. Only proceed when all steps are complete

**Example:**

```
assistant: <calls SlashCommand with /commit-merge-push>
system: <command-message>commit-merge-push is running…</command-message>
        1. Invoke the commit subagent. Wait for successful commit before proceeding.
        2. Run `git fetch origin && git merge origin/main` with `dangerouslyDisableSandbox: true`.
        3. If conflicts occur: Invoke the resolve-conflicts subagent.
        4. Invoke the push subagent.
assistant: <executes step 1 - calls Task tool with subagent_type="Commit">
assistant: <waits for commit to complete>
assistant: <executes step 2 - runs git fetch and merge with dangerouslyDisableSandbox: true>
assistant: <executes step 4 - calls Task tool with subagent_type="Push">
assistant: <only after all steps complete, proceeds with other work>
```

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
.htmx-indicator {
  display: none;
}
.htmx-request .htmx-indicator {
  display: inline-block;
}
```
