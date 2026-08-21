import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state },
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

/** Fires a synthetic Hit pointerdown with its own pointerId, independent of
 * whatever the real mouse pointer is doing (e.g. holding the joystick). */
async function tapHitSynthetic(page: Page) {
  await page.locator('#hit-btn').dispatchEvent('pointerdown', { pointerId: 999, bubbles: true });
}

test.describe('Step 4: Jump button, aimed spike', () => {
  test('Jump is disabled away from the net and enabled near it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Default player position is far from the net.
    await page.waitForTimeout(100);
    expect(await jumpButtonPointerEvents(page)).toBe('none');

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);
    expect(await jumpButtonPointerEvents(page)).toBe('auto');
  });

  test('Jump locks lateral movement and a joystick-aimed spike fires on Hit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping', undefined, {
      timeout: 500,
    });

    // Hold the joystick toward the upper-right (aim right + toward the net)
    // without releasing it, then fire Hit with a separate synthetic pointer.
    const base = page.locator('#joystick-base');
    const box = await base.boundingBox();
    if (!box) throw new Error('joystick not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 40, cy - 30, { steps: 5 });

    const duringJump = await getState(page);
    expect(duringJump.player.pos).toEqual({ x: 4, y: 9 }); // no lateral movement

    await tapHitSynthetic(page);
    await page.mouse.up();

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 500,
    });
    const after = await getState(page);
    expect(after.player.state).toBe('active'); // spike ends the jump immediately
    expect(after.player.pos).toEqual({ x: 4, y: 9 }); // still hasn't moved
    // Aimed roughly right (+x) and toward the net (-y, i.e. below NET_Y=8).
    expect(after.ball.target.x).toBeGreaterThan(4);
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('an un-spiked jump window closes on its own and returns control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setup(page, { x: 4, y: 9 }, { x: 4, y: 8.8 });
    await page.waitForTimeout(100);

    await tapJump(page);
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping', undefined, {
      timeout: 500,
    });

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull(); // no spike happened
  });
});
