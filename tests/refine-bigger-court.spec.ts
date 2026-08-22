import { test, expect } from '@playwright/test';
import { distIndex } from './helpers';

test.describe('Refine 1: bigger court (capped overscan fit)', () => {
  test('scales past a plain "contain" fit on a phone-shaped aspect ratio', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); // aspect ~0.462
    await page.goto(distIndex);

    const box = await page.locator('#game-canvas').boundingBox();
    expect(box).not.toBeNull();

    // width is the constraining axis here (390/844 < court's 0.5), so a plain
    // "contain" fit would cap height at 390/0.5 = 780, leaving a ~64px gap.
    const plainContainH = 390 / (8 / 16);
    expect(box!.height).toBeGreaterThan(plainContainH); // bigger than before this fix
    expect(box!.height).toBeLessThanOrEqual(plainContainH * 1.05 + 0.5); // but capped
  });

  test('never overscans past the capped limit on an off-ratio viewport', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 700 }); // aspect ~0.571, well off the court's 0.5
    await page.goto(distIndex);

    const box = await page.locator('#game-canvas').boundingBox();
    expect(box).not.toBeNull();

    // At this aspect, height is the constraining axis for a "contain" fit:
    const courtAspect = 8 / 16;
    const containH = 700;
    const containW = containH * courtAspect;

    expect(box!.width).toBeLessThanOrEqual(containW * 1.05 + 0.5);
    expect(box!.height).toBeLessThanOrEqual(containH * 1.05 + 0.5);
    // Still centered horizontally.
    expect(box!.x + box!.width / 2).toBeCloseTo(200, 0);
  });
});
