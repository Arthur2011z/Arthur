import { test, expect } from '@playwright/test';
import { distIndex } from './helpers';

async function getPlayerPos(page: import('@playwright/test').Page) {
  return page.evaluate(
    () => (window as any).__game.state.player.pos as { x: number; y: number },
  );
}

/** Drags the joystick knob by a fixed pixel offset and holds it for `holdMs`. */
async function dragJoystick(
  page: import('@playwright/test').Page,
  dx: number,
  dy: number,
  holdMs: number,
) {
  const base = page.locator('#joystick-base');
  const box = await base.boundingBox();
  if (!box) throw new Error('joystick base not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

test.describe('Step 1: joystick movement', () => {
  test('dragging the joystick moves the player token', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getPlayerPos(page);
    await dragJoystick(page, 0, -60, 400); // push "up" (toward the net)
    const after = await getPlayerPos(page);

    expect(after.y).toBeLessThan(before.y);
  });

  test('player cannot cross the net into the opponent half', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Hold the joystick fully "up" for long enough to reach the net boundary.
    await dragJoystick(page, 0, -60, 3000);

    const pos = await getPlayerPos(page);
    const netY: number = await page.evaluate(() => 8); // NET_Y constant
    expect(pos.y).toBeGreaterThanOrEqual(netY);
  });

  test('player stays inside the side and back lines', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await dragJoystick(page, -60, 60, 3000); // push toward the back-left corner
    const pos = await getPlayerPos(page);

    expect(pos.x).toBeGreaterThanOrEqual(0);
    expect(pos.y).toBeLessThanOrEqual(16);
  });

  test('releasing the joystick stops the player', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await dragJoystick(page, 60, 0, 300);
    const afterDrag = await getPlayerPos(page);
    await page.waitForTimeout(300);
    const afterRelease = await getPlayerPos(page);

    expect(afterRelease.x).toBeCloseTo(afterDrag.x, 3);
    expect(afterRelease.y).toBeCloseTo(afterDrag.y, 3);
  });
});
