import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state },
      ball: { pos: { ...g.state.ball.pos }, state: g.state.ball.state, lastToucher: g.state.ball.lastToucher },
      teammate: { pos: { ...g.state.teammate.pos } },
    };
  });
}

/** Directly places the ball in flight via Ball.launch(), bypassing the random
 * auto-serve, so dive tests are deterministic. */
async function launchBall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
  await page.evaluate(
    ({ from, to, duration }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight: 3, toucher: null });
    },
    { from, to, duration },
  );
}

/** Performs a quick drag on the canvas (away from the joystick) to trigger a
 * swipe/dive in the given screen-space direction. */
async function swipe(page: Page, dx: number, dy: number) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  // Start well clear of the bottom-left joystick zone.
  const startX = box.x + box.width * 0.7;
  const startY = box.y + box.height * 0.55;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 3 });
  await page.mouse.up();
}

test.describe('Step 2: swipe-to-dive + auto-pass to teammate', () => {
  test('the ball auto-serves into the human half after being idle', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.waitForFunction(() => (window as any).__game.state.ball.state === 'flying', undefined, {
      timeout: 3000,
    });
  });

  test('a well-aimed swipe near the ball connects and passes it to the teammate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    // Ball starts just 1m "above" the player (well inside DIVE_RANGE) and flies
    // on toward the net very slowly, so it stays close to that spot even with
    // the extra round-trip latency a full Playwright Test run adds versus a
    // bare script.
    const diveSpot = { x: before.player.pos.x, y: before.player.pos.y - 1 };
    await launchBall(page, diveSpot, { x: before.player.pos.x, y: 2 }, 8);

    // Swipe upward (negative screen-y), matching the ball's direction from the player.
    await swipe(page, 0, -120);

    // Dash completes quickly; poll for the connected pass.
    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'player',
      undefined,
      { timeout: 1000 },
    );
    const afterDash = await getState(page);
    expect(afterDash.ball.state).toBe('flying');
    expect(afterDash.player.state).toBe('recovering');

    // Let the pass complete: the ball should arrive at the teammate.
    await page.waitForFunction(() => (window as any).__game.state.ball.state === 'idle', undefined, {
      timeout: 2000,
    });
    const afterPass = await getState(page);
    expect(afterPass.ball.pos.x).toBeCloseTo(afterPass.teammate.pos.x, 0);
    expect(afterPass.ball.pos.y).toBeCloseTo(afterPass.teammate.pos.y, 0);

    // Recovery pause, then control returns to the player.
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1000,
    });
  });

  test('swiping with no ball in range whiffs (no dive-connect) but still lunges', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    await swipe(page, 0, -120);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'diving', undefined, {
      timeout: 500,
    });
    const during = await getState(page);
    expect(during.ball.lastToucher).toBeNull();

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
    // The player still lunged (moved) in the swiped direction, just didn't connect.
    expect(after.player.pos.y).toBeLessThan(before.player.pos.y);
  });
});
