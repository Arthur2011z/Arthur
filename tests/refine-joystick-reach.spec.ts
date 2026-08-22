import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getPlayerPos(page: Page) {
  return page.evaluate(() => (window as any).__game.state.player.pos as { x: number; y: number });
}

async function dragFromHitzoneCenter(page: Page, offsetX: number, offsetY: number, holdMs: number) {
  const zone = page.locator('#joystick-hitzone');
  const box = await zone.boundingBox();
  if (!box) throw new Error('joystick hit-zone not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + offsetX, cy + offsetY, { steps: 5 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

test.describe('Refine 2: bigger, more forgiving joystick', () => {
  test('a touch starting beyond the old visible base still drives the stick', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getPlayerPos(page);
    // 90px from center: outside the old 60px-radius base, inside the new
    // 116px-radius hit-zone.
    await dragFromHitzoneCenter(page, 0, -90, 400);
    const after = await getPlayerPos(page);

    expect(after.y).toBeLessThan(before.y);
  });

  test('a touch well outside even the enlarged hit-zone does not drive the stick', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const zone = page.locator('#joystick-hitzone');
    const box = await zone.boundingBox();
    if (!box) throw new Error('joystick hit-zone not found');
    // Straight up from the hit-zone's center, a full hit-zone-height away -
    // well clear of the zone itself and nowhere near the bottom-right buttons.
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const farY = cy - box.height;

    const before = await getPlayerPos(page);
    await page.mouse.move(cx, farY);
    await page.mouse.down();
    await page.mouse.move(cx, farY - 90, { steps: 5 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    const after = await getPlayerPos(page);

    expect(after).toEqual(before);
  });
});
