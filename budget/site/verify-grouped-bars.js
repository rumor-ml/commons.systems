import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Capture console messages
  page.on('console', (msg) => {
    if (msg.type() === 'log') {
      console.log('CONSOLE:', msg.text());
    } else if (msg.type() === 'error') {
      console.error('ERROR:', msg.text());
    }
  });

  // Navigate to the budget page
  await page.goto('http://localhost:5173');

  // Wait for chart to render
  await page.waitForTimeout(2000);

  // Take screenshot
  await page.screenshot({
    path: '/home/n8/worktrees/1450-budget-planning-ui/tmp/grouped-bars-screenshot.png',
    fullPage: true,
  });

  // Get some diagnostic info
  const barGroups = await page.evaluate(() => {
    const svg = document.querySelector('svg');
    if (!svg) return { error: 'No SVG found' };

    const barGroups = svg.querySelectorAll('g[aria-label="bar"]');
    return {
      barGroupCount: barGroups.length,
      barGroups: Array.from(barGroups).map((g, i) => {
        const rects = g.querySelectorAll('rect');
        const firstRect = rects[0];
        return {
          groupIndex: i,
          rectCount: rects.length,
          firstRectX: firstRect?.getAttribute('x'),
          firstRectWidth: firstRect?.getAttribute('width'),
          firstRectFill: firstRect?.getAttribute('fill'),
          // Get positions of first 3 rects to see if they're side-by-side
          positions: Array.from(rects)
            .slice(0, 3)
            .map((r) => ({
              x: r.getAttribute('x'),
              width: r.getAttribute('width'),
            })),
        };
      }),
    };
  });

  console.log('\n=== DOM INSPECTION ===');
  console.log(JSON.stringify(barGroups, null, 2));

  await browser.close();
  console.log(
    '\nScreenshot saved to: /home/n8/worktrees/1450-budget-planning-ui/tmp/grouped-bars-screenshot.png'
  );
})();
