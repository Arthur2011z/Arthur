import { test, expect } from '@playwright/test';
import { distIndex } from './helpers';

test.describe('Step 0: scaffold', () => {
  test('renders a letterboxed court with a horizontal net in portrait', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const canvas = page.locator('#game-canvas');
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    // Court aspect ratio is COURT_WIDTH:COURT_LENGTH = 8:16 = 0.5
    expect(box!.width / box!.height).toBeCloseTo(0.5, 1);
  });

  test('stays correctly letterboxed in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto(distIndex);

    const canvas = page.locator('#game-canvas');
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width / box!.height).toBeCloseTo(0.5, 1);
    // In landscape the court should be pillarboxed, i.e. much narrower than the viewport.
    expect(box!.width).toBeLessThan(844);
  });
});
