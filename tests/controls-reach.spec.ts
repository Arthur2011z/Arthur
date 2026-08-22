import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/** Sets up a ball flight and player position, then invokes Player.update()
 * directly (one or more times) inside a single page.evaluate() call - fully
 * synchronous, so no real animation frame from the game's own running loop
 * can interleave between steps. Used to test tryReach()'s gating (aim cone,
 * range cutoff, jump-vs-dive branch) and the resulting contact resolution
 * deterministically, independent of round-trip timing. */
async function directUpdates(
  page: Page,
  playerPos: { x: number; y: number },
  ballFrom: { x: number; y: number },
  ballTo: { x: number; y: number },
  duration: number,
  inputs: { move: { x: number; y: number }; reach?: boolean; attack?: boolean; pass?: boolean }[],
) {
  return page.evaluate(
    ({ playerPos, ballFrom, ballTo, duration, inputs }) => {
      const g = (window as any).__game;
      g.state.ball.launch(ballFrom, ballTo, { duration, peakHeight: 3, toucher: null });
      g.state.player.pos.x = playerPos.x;
      g.state.player.pos.y = playerPos.y;
      g.state.player.state = 'active';
      for (const i of inputs) {
        g.state.player.update(
          0.016,
          { move: i.move, reach: i.reach ?? false, attack: i.attack ?? false, pass: i.pass ?? false },
          g.state.ball,
          g.state.teammate.pos,
        );
      }
      return {
        playerState: g.state.player.state,
        playerPos: { ...g.state.player.pos },
        ball: { target: { ...g.state.ball.target }, state: g.state.ball.state, lastToucher: g.state.ball.lastToucher },
        teammate: { ...g.state.teammate.pos },
      };
    },
    { playerPos, ballFrom, ballTo, duration, inputs },
  );
}

test.describe('Sprung/Hecht button: auto-approach to the ball', () => {
  test('ignored when no ball is flying', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.update(
        0.016,
        { move: { x: 0, y: -1 }, reach: true, attack: false, pass: false },
        g.state.ball,
        g.state.teammate.pos,
      );
      return g.state.player.state;
    });
    expect(result).toBe('active');
  });

  test('ignored when the ball is out of range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Player at the back baseline; ball's flight stays up near the net -
    // 7m+ away, well past REACH_RANGE (3m) even though perfectly aimed.
    const result = await directUpdates(page, { x: 4, y: 16 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 0, y: -1 }, reach: true },
    ]);
    expect(result.playerState).toBe('active');
  });

  test('ignored when the joystick does not point toward the ball', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // In range (2.5m) but stick held sideways, perpendicular to the ball.
    const sideways = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 1, y: 0 }, reach: true },
    ]);
    expect(sideways.playerState).toBe('active');

    // Stick held pointing away from the ball entirely.
    const away = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 0, y: 1 }, reach: true },
    ]);
    expect(away.playerState).toBe('active');

    // Stick left centered (no direction held at all).
    const centered = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 0, y: 0 }, reach: true },
    ]);
    expect(centered.playerState).toBe('active');
  });

  test('connects and enters a jump when aimed and near the net', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // y=9 is within NET_PROXIMITY_RANGE (1.5m) of NET_Y (8) - canJump() true.
    const result = await directUpdates(page, { x: 4, y: 9 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 0, y: -1 }, reach: true },
    ]);
    expect(result.playerState).toBe('jumping_up');
  });

  test('connects and enters a dive when aimed but far from the net', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // y=11.5 is outside NET_PROXIMITY_RANGE - canJump() false.
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { move: { x: 0, y: -1 }, reach: true },
    ]);
    expect(result.playerState).toBe('diving');
  });

  test('while diving, a buffered Pass resolves the instant the ball is in range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight passes right through the player's own position, so the
    // dive's intercept point is exactly where the player already stands -
    // still within HIT_RANGE the whole time. Reach, then Pass, both applied
    // atomically (no real time passes between them).
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 11.5 }, { x: 4, y: 1 }, 3, [
      { move: { x: 0, y: -1 }, reach: true },
      { move: { x: 0, y: 0 }, pass: true },
    ]);

    expect(result.ball.state).toBe('flying');
    expect(result.ball.lastToucher).toBe('player');
    expect(result.ball.target.x).toBeCloseTo(result.teammate.x, 0);
    expect(result.ball.target.y).toBeCloseTo(result.teammate.y, 0);
    expect(result.playerState).toBe('recovering');
  });

  test('a dive dash moves the player toward the intercept point over real time, then recovers back to active', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Intercept point (4, 9) is 2.5m from the player's start (4, 11.5) - a
    // real, visible dash. Ball stays far from HIT_RANGE the whole time
    // (target y=9, well above the human baseline it's dashing toward is
    // irrelevant here - x=4 the whole flight keeps the ball's own path at
    // y=9 fixed, never close enough at x=4,y=11.5 to accidentally resolve a
    // contact), so this test is purely about the movement, not a catch.
    await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 9 }, 5, [
      { move: { x: 0, y: -1 }, reach: true },
    ]);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'recovering', undefined, {
      timeout: 1000,
    });
    const duringRecovery = await page.evaluate(() => (window as any).__game.state.player.pos);
    expect(duringRecovery.y).toBeCloseTo(9, 0);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1000,
    });
  });

  test('an unresolved dive (no button pressed) still returns control to active', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 9 }, 5, [
      { move: { x: 0, y: -1 }, reach: true },
    ]);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await page.evaluate(() => (window as any).__game.state.ball.lastToucher);
    expect(after).toBeNull();
  });
});
