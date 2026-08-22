import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state, height: g.state.player.height },
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
    };
  });
}

/** Test-only shortcut: teleport the player and place the ball, bypassing the
 * joystick/serve timers so jump/spike tests are fast and deterministic. */
async function setup(page: Page, playerPos: { x: number; y: number }, ballPos: { x: number; y: number }) {
  await page.evaluate(
    ({ playerPos, ballPos }) => {
      const g = (window as any).__game;
      g.state.player.pos.x = playerPos.x;
      g.state.player.pos.y = playerPos.y;
      g.state.ball.pos.x = ballPos.x;
      g.state.ball.pos.y = ballPos.y;
    },
    { playerPos, ballPos },
  );
}

async function jumpButtonPointerEvents(page: Page): Promise<string> {
  return page.locator('#jump-btn').evaluate((el) => (el as HTMLElement).style.pointerEvents);
}

async function tapJump(page: Page) {
  const btn = page.locator('#jump-btn');
  const box = await btn.boundingBox();
  if (!box) throw new Error('jump button not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** Performs a quick drag on the canvas (away from the joystick) - a swipe,
 * either a dive trigger while active or an aim+fire while jumping. */
async function swipe(page: Page, dx: number, dy: number) {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const startX = box.x + box.width * 0.7;
  const startY = box.y + box.height * 0.55;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 3 });
  await page.mouse.up();
}

test.describe('Step 4 / Refine 3: Jump + swipe-to-spike', () => {
  test('Jump is disabled away from the net and enabled near it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.waitForTimeout(100);
    expect(await jumpButtonPointerEvents(page)).toBe('none');

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);
    expect(await jumpButtonPointerEvents(page)).toBe('auto');
  });

  test('a swipe during the rise fires an immediate aimed spike, then falls before returning control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });

    // Swipe up-right: aim right (+x) and toward the net (-y).
    await swipe(page, 60, -40);

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 500,
    });
    const afterSwipe = await getState(page);
    expect(afterSwipe.player.state).toBe('jumping_down'); // falls, doesn't snap back instantly
    expect(afterSwipe.player.pos).toEqual({ x: 4, y: 9 }); // never moved laterally
    expect(afterSwipe.ball.target.x).toBeGreaterThan(4);
    expect(afterSwipe.ball.target.y).toBeLessThan(8);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1000,
    });
    const afterLanding = await getState(page);
    expect(afterLanding.player.height).toBe(0);
  });

  test('an out-of-range swipe during the rise is forgiven, not a failed attempt', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball well outside HIT_RANGE (0.7m).
    await setup(page, { x: 4, y: 9 }, { x: 4, y: 6 });
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });

    await swipe(page, 60, -40);
    await page.waitForTimeout(100);

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
    expect(after.player.state).toBe('jumping_up'); // still open, not ended by the failed swipe
  });

  test('reaching the peak with no swipe and the ball in range auto-fires the default-direction spike', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });

    const after = await getState(page);
    expect(after.player.state).toBe('jumping_down');
    expect(after.ball.target.x).toBeCloseTo(4, 0); // straight ahead
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('reaching the peak with no swipe and the ball out of range fires nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 6 }); // out of HIT_RANGE
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
  });
});
