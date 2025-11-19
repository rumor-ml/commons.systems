# Contributing Guide

Thank you for considering contributing to the Fellspiral project!

## Development Workflow

### 1. Fork and Clone

```bash
git clone <your-fork-url>
cd commons.systems
```

### 2. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

### 3. Make Changes

- Follow the existing code style
- Write clear, descriptive commit messages
- Add tests for new features

### 4. Test Your Changes

```bash
# Run all tests
npm test

# Run tests in UI mode for debugging
cd fellspiral/tests
npm run test:ui

# Test the build
cd ../site
npm run build
npm run preview
```

### 5. Submit a Pull Request

- Push your branch to your fork
- Open a PR against the main repository
- Describe your changes clearly
- Link any related issues

## Code Standards

### HTML

- Use semantic HTML5 elements
- Include proper accessibility attributes
- Keep markup clean and readable

### CSS

- Follow BEM naming convention where appropriate
- Use CSS custom properties (variables)
- Mobile-first responsive design
- Keep selectors specific but not overly complex

### JavaScript

- Use modern ES6+ syntax
- Write clear, self-documenting code
- Add comments for complex logic
- Avoid global variables

## Testing

### Writing Tests

Tests are located in `fellspiral/tests/e2e/`.

Example test structure:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('should do something', async ({ page }) => {
    const element = page.locator('.selector');
    await expect(element).toBeVisible();
  });
});
```

### Test Categories

1. **Homepage tests**: Basic page loading and structure
2. **Feature tests**: Specific functionality (tabs, navigation)
3. **Accessibility tests**: ARIA attributes, keyboard navigation
4. **Performance tests**: Load times, bundle sizes
5. **Responsive tests**: Mobile/tablet/desktop layouts

### Running Tests

```bash
# All tests
npm test

# Specific file
npx playwright test homepage.spec.js

# Specific test
npx playwright test -g "should display hero"

# Debug mode
npx playwright test --debug
```

## Project Structure

```
commons.systems/
├── fellspiral/
│   ├── site/               # Static website
│   │   ├── src/
│   │   │   ├── index.html
│   │   │   ├── styles/
│   │   │   └── scripts/
│   │   ├── package.json
│   │   └── vite.config.js
│   ├── tests/              # Test suite
│   │   ├── e2e/
│   │   ├── package.json
│   │   └── playwright.config.js
│   └── rules.md            # Game rules
├── infrastructure/         # GCP infrastructure
│   ├── terraform/
│   └── scripts/
├── .github/
│   └── workflows/          # CI/CD pipelines
├── package.json            # Root package
└── README.md
```

## Adding New Content

### Adding Weapons/Equipment

Edit `fellspiral/site/src/index.html`:

1. Find the appropriate section (weapons, armor, skills, upgrades)
2. Copy an existing equipment card
3. Update the title, tags, stats, and description
4. Add corresponding tests in `fellspiral/tests/e2e/equipment.spec.js`

Example:

```html
<div class="equipment-card">
  <h4>New Weapon</h4>
  <div class="tags">
    <span class="tag">2h</span>
    <span class="tag">precise</span>
  </div>
  <p>d8 weapon die, 2 slots</p>
  <p class="note">Special ability description</p>
</div>
```

### Adding New Sections

1. Add section to `index.html`
2. Add styles in `main.css` if needed
3. Add navigation link
4. Add tests
5. Update documentation

## Infrastructure Changes

### Modifying GCP Setup

If you need to change the infrastructure:

1. Update Terraform files in `infrastructure/terraform/`
2. Update setup scripts in `infrastructure/scripts/`
3. Update documentation in `SETUP.md`
4. Test changes in a separate GCP project first

### Modifying CI/CD

If you need to change the workflows:

1. Edit files in `.github/workflows/`
2. Test in a fork first
3. Document any new required secrets/variables

## Release Process

1. All changes go through PR review
2. Tests must pass
3. PRs to main trigger automatic deployment
4. Deployment tests run against live site
5. Health checks monitor site continuously

## Getting Help

- Open an issue for bugs or feature requests
- Ask questions in discussions
- Review existing issues and PRs

## Code of Conduct

- Be respectful and constructive
- Welcome newcomers
- Focus on what is best for the project
- Show empathy towards others
