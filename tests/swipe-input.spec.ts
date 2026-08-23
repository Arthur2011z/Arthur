import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/** Simulates a real swipe gesture with the mouse: down at `from`, move past
 * the recognition threshold toward `to`, release. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();
}

test.describe('SwipeInput: gesture recognition on the canvas', () => {
  test('a swipe on the open court reaches the game (Hechten triggers) when aimed at a reachable ball', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Place the player and an incoming ball so a swipe straight "up" (toward
    // the net, i.e. toward the ball) is a valid, in-range, well-aimed dive.
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 9 }, { duration: 5, peakHeight: 3, toucher: null });
    });

    const canvasBox = await page.locator('#game-canvas').boundingBox();
    if (!canvasBox) throw new Error('canvas not found');
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    // Swipe "up" on screen (toward the net) - well past the 40px threshold.
    await swipe(page, { x: cx, y: cy + 100 }, { x: cx, y: cy - 20 });

    await page.waitForFunction(
      () => (window as any).__game.state.player.state === 'diving',
      undefined,
      { timeout: 500 },
    );
  });

  test('a swipe that starts on the joystick does not trigger Hechten', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 9 }, { duration: 5, peakHeight: 3, toucher: null });
    });

    const joystick = await page.locator('#joystick-hitzone').boundingBox();
    if (!joystick) throw new Error('joystick not found');
    const jx = joystick.x + joystick.width / 2;
    const jy = joystick.y + joystick.height / 2;

    await swipe(page, { x: jx, y: jy }, { x: jx, y: jy - 80 });
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => (window as any).__game.state.player.state);
    expect(state).toBe('active');
  });

  test('a short tap (below the distance threshold) does not trigger Hechten', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 9 }, { duration: 5, peakHeight: 3, toucher: null });
    });

    const canvasBox = await page.locator('#game-canvas').boundingBox();
    if (!canvasBox) throw new Error('canvas not found');
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;

    await swipe(page, { x: cx, y: cy + 10 }, { x: cx, y: cy }); // 10px, below 40px threshold
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => (window as any).__game.state.player.state);
    expect(state).toBe('active');
  });
});
