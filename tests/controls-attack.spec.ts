import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state, height: g.state.player.height },
      ball: {
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
    };
  });
}

async function launchBall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
  await page.evaluate(
    ({ from, to, duration }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight: 3, toucher: null });
    },
    { from, to, duration },
  );
}

async function teleportPlayer(page: Page, pos: { x: number; y: number }) {
  await page.evaluate((pos) => {
    const g = (window as any).__game;
    g.state.player.pos.x = pos.x;
    g.state.player.pos.y = pos.y;
  }, pos);
}

async function tapButton(page: Page, id: string) {
  const btn = page.locator(`#${id}`);
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function dragJoystick(page: Page, dx: number, dy: number, holdMs: number) {
  const zone = page.locator('#joystick-hitzone');
  const box = await zone.boundingBox();
  if (!box) throw new Error('joystick hit-zone not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

/** Forces the player straight into 'jumping_up' via a real Sprung/Hecht tap,
 * with the ball's intercept point already at the player's own position
 * (aimless trigger - works regardless of joystick direction). */
async function tapReachIntoJump(page: Page, playerPos: { x: number; y: number }, ballTo: { x: number; y: number }, duration: number) {
  await teleportPlayer(page, playerPos);
  await launchBall(page, playerPos, ballTo, duration);
  await tapButton(page, 'reach-btn');
  await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
    timeout: 500,
  });
}

test.describe('Schlag button: spike while jumping near the net', () => {
  test('does nothing while merely active on the ground, even with the ball in range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Far corner, well outside the teammate's TEAMMATE_REACT_RADIUS (2.5m
    // from its home at (5.6, 11)) - otherwise the teammate itself would race
    // in and catch a ball this close to the player's own position first.
    await teleportPlayer(page, { x: 1, y: 15 });
    await launchBall(page, { x: 1, y: 14.7 }, { x: 1, y: 4 }, 5);

    await tapButton(page, 'attack-btn');
    await page.waitForTimeout(300);

    const after = await getState(page);
    expect(after.player.state).toBe('active');
    expect(after.ball.lastToucher).toBeNull();
  });

  test('fires immediately with the default aim when already in range at the moment of the jump', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await tapReachIntoJump(page, { x: 4, y: 9 }, { x: 4.05, y: 9.05 }, 5);
    await tapButton(page, 'attack-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 500,
    });
    const after = await getState(page);
    expect(after.player.state).toBe('jumping_down');
    expect(after.ball.target.x).toBeCloseTo(4, 0); // straight ahead - stick was never held
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('aim direction follows whatever the joystick is held toward during the jump', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Long, barely-moving flight so the ball stays within HIT_RANGE for the
    // whole test regardless of exactly how long the drag/tap round trips take.
    await tapReachIntoJump(page, { x: 4, y: 9 }, { x: 4.05, y: 9.05 }, 5);

    await dragJoystick(page, 60, 0, 120); // hold right
    await tapButton(page, 'attack-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 500,
    });
    const after = await getState(page);
    expect(after.ball.target.x).toBeGreaterThan(5);
  });

  test('a Schlag buffered before the ball is in range resolves once it arrives - even past the jump peak (grace period)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Player near the net; ball flies straight through the player's y from
    // well above - its intercept point is immediately at the player's own
    // position (aimless trigger fires the jump right away), but the ball's
    // own live position only actually arrives within HIT_RANGE partway
    // through the flight, at roughly t=0.41s - after JUMP_RISE_DURATION
    // (0.35s) but inside JUMP_SCHLAG_GRACE_DURATION's window (until 0.5s).
    await teleportPlayer(page, { x: 4, y: 9 });
    await launchBall(page, { x: 4, y: 13 }, { x: 4, y: 5 }, 1.0);
    await tapButton(page, 'reach-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });

    // Press Schlag right away - well before the ball has arrived.
    await tapButton(page, 'attack-btn');
    const rightAfterPress = await getState(page);
    expect(rightAfterPress.ball.lastToucher).toBeNull();

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const after = await getState(page);
    // Fired successfully, whichever of jumping_up/jumping_down it landed in.
    expect(['jumping_up', 'jumping_down']).toContain(after.player.state);
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('if the ball has already left before Schlag is pressed, the jump completes with nothing fired', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 4, y: 9 });
    // Ball starts exactly at the player's position (so the aimless trigger
    // fires the jump) and flies far away over 1s - clearing HIT_RANGE (0.7m)
    // after just ~0.12s, but still counting as "flying" for the whole test.
    await launchBall(page, { x: 4, y: 9 }, { x: 10, y: 9 }, 1);
    await tapButton(page, 'reach-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });

    // Explicit margin, well past the ~0.12s the ball needs to clear
    // HIT_RANGE, before Schlag is actually pressed - independent of exactly
    // how fast the round-trips above happened to be.
    await page.waitForTimeout(300);
    await tapButton(page, 'attack-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
  });
});
