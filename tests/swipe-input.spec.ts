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

async function canvasCenter(page: Page) {
  const box = await page.locator('#game-canvas').boundingBox();
  if (!box) throw new Error('canvas not found');
  return { cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
}

/** The ball/player setup that used to make a swipe "up" a valid Hechten. */
async function setUpReachableBall(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.state.player.pos.x = 4;
    g.state.player.pos.y = 11.5;
    g.state.player.state = 'active';
    g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 9 }, { duration: 5, peakHeight: 3, toucher: null });
  });
}

test.describe('SwipeInput: gesture recognition on the canvas', () => {
  test('a swipe no longer triggers Hechten - that is the dive button now', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await setUpReachableBall(page);

    const { cx, cy } = await canvasCenter(page);
    // Swipe "up" on screen (toward the net, straight at the ball) - well past
    // the 40px threshold, and exactly the gesture that used to dive.
    await swipe(page, { x: cx, y: cy + 100 }, { x: cx, y: cy - 20 });
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => (window as any).__game.state.player.state);
    expect(state).toBe('active');
  });

  test('the swipe gesture still reaches the game - it aims the spike during the slow-motion window', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      (window as any).__setRandom(() => 0.99); // never net-fault
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4.05, y: 9.05 }, { duration: 5, peakHeight: 3, toucher: null });
    });

    const jumpBtn = page.locator('#jump-btn');
    const box = await jumpBtn.boundingBox();
    if (!box) throw new Error('jump button not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'slowmo_aim', undefined, {
      timeout: 500,
    });

    // Aim hard to the right - the spike must follow the swipe.
    const { cx, cy } = await canvasCenter(page);
    await swipe(page, { x: cx, y: cy }, { x: cx + 120, y: cy });

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1500,
    });
    const target = await page.evaluate(() => ({ ...(window as any).__game.state.ball.target }));
    expect(target.x).toBeGreaterThan(5);
    expect(target.y).toBeLessThan(8); // over the net
  });

  test('a swipe that starts on the joystick does not reach the game', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await setUpReachableBall(page);

    const joystick = await page.locator('#joystick-hitzone').boundingBox();
    if (!joystick) throw new Error('joystick not found');
    const jx = joystick.x + joystick.width / 2;
    const jy = joystick.y + joystick.height / 2;

    await swipe(page, { x: jx, y: jy }, { x: jx, y: jy - 80 });
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => (window as any).__game.state.player.state);
    expect(state).toBe('active');
  });

  test('a short tap (below the distance threshold) is not recognized as a swipe', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await setUpReachableBall(page);

    const { cx, cy } = await canvasCenter(page);
    await swipe(page, { x: cx, y: cy + 10 }, { x: cx, y: cy }); // 10px, below 40px threshold
    await page.waitForTimeout(200);

    const state = await page.evaluate(() => (window as any).__game.state.player.state);
    expect(state).toBe('active');
  });
});
