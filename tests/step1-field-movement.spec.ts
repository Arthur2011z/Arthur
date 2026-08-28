import { expect, test } from '@playwright/test';
import { distIndex } from './helpers';

/** Court constants mirrored from src/game/constants.ts. */
const COURT_WIDTH = 8;
const COURT_LENGTH = 16;
const NET_Y = 8;
const PLAYER_RADIUS = 0.35;

const playerPos = (page: import('@playwright/test').Page) =>
  page.evaluate(() => ({ ...window.__game!.state.player.pos }));

const orientation = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__game!.court.orientation);

const inputMode = (page: import('@playwright/test').Page) =>
  page.evaluate(() => window.__game!.input.mode);

/** Holds a key down for `ms` and releases it. */
async function hold(page: import('@playwright/test').Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
});

test('the human player starts inside their own half', async ({ page }) => {
  const pos = await playerPos(page);
  expect(pos.y).toBeGreaterThan(NET_Y);
  expect(pos.y).toBeLessThan(COURT_LENGTH);
  expect(pos.x).toBeGreaterThan(0);
  expect(pos.x).toBeLessThan(COURT_WIDTH);
});

test('W runs toward the net and releasing the key stops the player dead', async ({ page }) => {
  const start = await playerPos(page);
  await hold(page, 'w', 350);
  const afterRun = await playerPos(page);
  expect(afterRun.y).toBeLessThan(start.y - 0.5);

  // No glide: the position must be identical after a further idle period.
  await page.waitForTimeout(300);
  const afterRelease = await playerPos(page);
  expect(afterRelease.y).toBeCloseTo(afterRun.y, 5);
  expect(afterRelease.x).toBeCloseTo(afterRun.x, 5);
});

test('the net blocks the player like a solid wall', async ({ page }) => {
  await hold(page, 'w', 2500);
  const pos = await playerPos(page);
  expect(pos.y).toBeGreaterThanOrEqual(NET_Y + PLAYER_RADIUS - 1e-6);
  expect(pos.y).toBeLessThan(NET_Y + PLAYER_RADIUS + 0.05);
});

test('side lines and the base line block the player', async ({ page }) => {
  await hold(page, 'a', 2500);
  expect((await playerPos(page)).x).toBeCloseTo(PLAYER_RADIUS, 2);

  await hold(page, 'd', 4000);
  expect((await playerPos(page)).x).toBeCloseTo(COURT_WIDTH - PLAYER_RADIUS, 2);

  await hold(page, 's', 4000);
  expect((await playerPos(page)).y).toBeCloseTo(COURT_LENGTH - PLAYER_RADIUS, 2);
});

test('a wide screen rotates the court and remaps the controls with it', async ({ page }) => {
  expect(await orientation(page)).toBe('portrait');

  await page.setViewportSize({ width: 900, height: 460 });
  await page.waitForFunction(() => window.__game!.court.orientation === 'landscape');
  expect(await orientation(page)).toBe('landscape');

  // In landscape the human team defends the left, so "push right" on screen
  // has to mean "run toward the net" - i.e. decreasing court y.
  const start = await playerPos(page);
  await hold(page, 'd', 350);
  const moved = await playerPos(page);
  expect(moved.y).toBeLessThan(start.y - 0.5);
  expect(moved.x).toBeCloseTo(start.x, 2);
});

test('the input mode follows the device actually being used', async ({ page }) => {
  await page.keyboard.press('w');
  expect(await inputMode(page)).toBe('keyboard');
  await expect(page.locator('#touch-controls')).toBeHidden();

  await page.locator('#viewport').tap({ position: { x: 30, y: 30 } });
  expect(await inputMode(page)).toBe('touch');
  await expect(page.locator('#touch-controls')).toBeVisible();
  await expect(page.locator('#jump-btn')).toBeVisible();
});
