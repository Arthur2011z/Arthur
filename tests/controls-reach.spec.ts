import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/** Sets up a ball flight and player position, then invokes Player.update()
 * directly (one or more times) inside a single page.evaluate() call - fully
 * synchronous, so no real animation frame from the game's own running loop
 * can interleave between steps. Used to test trySwipeDive()'s gating (aim
 * cone, range cutoff) and the resulting contact resolution deterministically,
 * independent of round-trip timing and independent of SwipeInput's own
 * pixel-based gesture recognition (covered separately in swipe-input.spec.ts). */
async function directUpdates(
  page: Page,
  playerPos: { x: number; y: number },
  ballFrom: { x: number; y: number },
  ballTo: { x: number; y: number },
  duration: number,
  inputs: { move?: { x: number; y: number }; swipe?: { x: number; y: number } | null; jump?: boolean; pass?: boolean; hit?: boolean }[],
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
          {
            move: i.move ?? { x: 0, y: 0 },
            swipe: i.swipe ?? null,
            jump: i.jump ?? false,
            pass: i.pass ?? false,
            hit: i.hit ?? false,
          },
          g.state.ball,
          g.state.teammate.pos,
          false,
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

test.describe('Wisch-Hechten: swipe-triggered auto-dash to the ball', () => {
  test('ignored when no ball is flying', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.update(
        0.016,
        { move: { x: 0, y: 0 }, swipe: { x: 0, y: -1 }, jump: false, pass: false, hit: false },
        g.state.ball,
        g.state.teammate.pos,
        false,
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
      { swipe: { x: 0, y: -1 } },
    ]);
    expect(result.playerState).toBe('active');
  });

  test('ignored when the swipe does not point toward the ball', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // In range (2.5m) but swiped sideways, perpendicular to the ball.
    const sideways = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { swipe: { x: 1, y: 0 } },
    ]);
    expect(sideways.playerState).toBe('active');

    // Swiped pointing away from the ball entirely.
    const away = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { swipe: { x: 0, y: 1 } },
    ]);
    expect(away.playerState).toBe('active');
  });

  test('connects and enters a dive when aimed and in range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { swipe: { x: 0, y: -1 } },
    ]);
    expect(result.playerState).toBe('diving');
  });

  test('no aim needed at all once the intercept point is basically where the player stands', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight passes right through the player - intercept point is
    // their own position, well inside REACH_AIMLESS_RANGE - so even a swipe
    // aimed completely wrong still triggers the dive.
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 11.5 }, { x: 4, y: 1 }, 2, [
      { swipe: { x: 1, y: 0 } },
    ]);
    expect(result.playerState).toBe('diving');
  });

  test('a contact mid-dive resolves as a pass to the teammate when nothing else was buffered', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight passes right through the player's own position, so the
    // dive's intercept point is exactly where the player already stands -
    // still within HIT_RANGE the whole time. Swipe alone resolves it - no
    // button needed. Two update calls: the first recognizes the swipe and
    // enters 'diving' (the same frame a real one-shot swipe would, since it's
    // an edge-triggered input); the second is where updateDiving's own
    // contact check actually runs and resolves it - exactly like two
    // consecutive real animation frames 16ms apart.
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 11.5 }, { x: 4, y: 1 }, 3, [
      { swipe: { x: 0, y: -1 } },
      {},
    ]);

    expect(result.ball.state).toBe('flying');
    expect(result.ball.lastToucher).toBe('player');
    expect(result.ball.target.x).toBeCloseTo(result.teammate.x, 0);
    expect(result.ball.target.y).toBeCloseTo(result.teammate.y, 0);
    expect(result.playerState).toBe('recovering');
  });

  test('a Notfall-Schlag buffered before diving sends it over the net instead of to the teammate', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 11.5 }, { x: 4, y: 1 }, 3, [
      { swipe: { x: 0, y: -1 }, hit: true },
      {},
    ]);

    expect(result.ball.lastToucher).toBe('player');
    expect(result.ball.target.y).toBeLessThan(8); // sent over the net, not to the teammate's own-half position
  });

  test('a dive dash moves the player toward the intercept point over real time, then recovers back to active', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball flies slowly along y=9 from x=0 toward x=3 (well left of the
    // player) - the *nearest point* of that path to the player's start
    // (4, 11.5) is the segment's clamped endpoint (3, 9), 2.69m away - a
    // real, visible dash. The ball's own live position stays far off to the
    // left the entire time (it only reaches x=0.045 by the time the dash and
    // recovery are done), so it never actually gets within HIT_RANGE of the
    // player - this test is purely about the dash's movement, not a catch.
    await directUpdates(page, { x: 4, y: 11.5 }, { x: 0, y: 9 }, { x: 3, y: 9 }, 10, [
      { swipe: { x: 0, y: -1 } },
    ]);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'recovering', undefined, {
      timeout: 1000,
    });
    const duringRecovery = await page.evaluate(() => (window as any).__game.state.player.pos);
    expect(duringRecovery.x).toBeCloseTo(3, 0);
    expect(duringRecovery.y).toBeCloseTo(9, 0);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1000,
    });
  });

  test('an unresolved dive (ball never comes close enough) still returns control to active', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Same slow, far-off ball as the dash-timing test above - stays well out
    // of HIT_RANGE (and well outside the teammate's TEAMMATE_REACT_RADIUS
    // the whole flight, since its nearest approach to the teammate's home is
    // 3.28m) for the entire observation window, so nobody ever touches it.
    await directUpdates(page, { x: 4, y: 11.5 }, { x: 0, y: 9 }, { x: 3, y: 9 }, 10, [
      { swipe: { x: 0, y: -1 } },
    ]);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await page.evaluate(() => (window as any).__game.state.ball.lastToucher);
    expect(after).toBeNull();
  });
});
