import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The keyboard hint has two ways of going wrong and they pull against each
 * other: kept on one line it runs off both edges of a narrow window, and left
 * to wrap it grows into a third line that climbs off the letterbox band and
 * sits on top of the court. Both are checked here, at the narrowest window
 * anyone would actually play in and at a comfortable one.
 */
async function hintBox(page: Page) {
  // The hint only appears once the game knows a keyboard is in use.
  await page.keyboard.press('e');
  await expect(page.locator('#control-hint')).toBeVisible();
  return page.evaluate(() => {
    const el = document.getElementById('control-hint')!;
    const r = el.getBoundingClientRect();
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    const padding =
      parseFloat(getComputedStyle(el).paddingTop) +
      parseFloat(getComputedStyle(el).paddingBottom);
    return {
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      lines: Math.round((r.height - padding) / lineHeight),
      viewport: { w: window.innerWidth, h: window.innerHeight },
    };
  });
}

for (const size of [
  { name: 'a narrow window', width: 400, height: 800 },
  { name: 'a roomy window', width: 1100, height: 800 },
]) {
  test(`the control hint stays inside ${size.name} and on two lines at most`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.goto(distIndex);
    await page.waitForFunction(() => window.__game !== undefined);

    const box = await hintBox(page);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(box.viewport.w);
    expect(box.bottom).toBeLessThanOrEqual(box.viewport.h);
    expect(box.lines).toBeLessThanOrEqual(2);
  });
}

test('touch play gets no hint at all, not an empty pill', async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await page.locator('#viewport').tap({ position: { x: 20, y: 20 } });
  await expect(page.locator('#control-hint')).toBeHidden();
});
