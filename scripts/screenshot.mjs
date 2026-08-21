import { chromium, devices } from '@playwright/test';
import path from 'node:path';

const outPath = process.argv[2];
if (!outPath) {
  console.error('Usage: node scripts/screenshot.mjs <output.png> [--landscape]');
  process.exit(1);
}
const landscape = process.argv.includes('--landscape');

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const device = devices['Pixel 7'];
const viewport = landscape
  ? { width: device.viewport.height, height: device.viewport.width }
  : device.viewport;
const context = await browser.newContext({ ...device, viewport, hasTouch: true });
const page = await context.newPage();
await page.goto('file://' + path.resolve('dist/index.html'));
await page.waitForTimeout(150);
await page.screenshot({ path: outPath });
await browser.close();
