import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/** Sets up a ball flight and player position, then invokes Player.update()
 * directly (one or more times) inside a single page.evaluate() call - fully
 * synchronous, so no real animation frame from the game's own running loop
 * can interleave between steps. Used to test tryButtonDive()'s gating (the
 * REACH_RANGE cutoff) and the resulting contact resolution deterministically,
 * independent of round-trip timing. */
async function directUpdates(
  page: Page,
  playerPos: { x: number; y: number },
  ballFrom: { x: number; y: number },
  ballTo: { x: number; y: number },
  duration: number,
  inputs: {
    move?: { x: number; y: number };
    swipe?: { x: number; y: number } | null;
    jump?: boolean;
    pass?: boolean;
    dive?: boolean;
    hit?: boolean;
  }[],
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
            dive: i.dive ?? false,
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

async function tapButton(page: Page, id: string) {
  const btn = page.locator(`#${id}`);
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Hechten button: auto-aimed one-shot dash to the ball', () => {
  test('the Hechten button exists and is labelled', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const btn = page.locator('#dive-btn');
    await expect(btn).toHaveText('Hechten');
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
  });

  test('a real button press triggers the dive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 9 }, { duration: 5, peakHeight: 3, toucher: null });
    });

    await tapButton(page, 'dive-btn');

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'diving', undefined, {
      timeout: 500,
    });
  });

  test('ignored when no ball is flying', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.update(
        0.016,
        { move: { x: 0, y: 0 }, swipe: null, jump: false, pass: false, dive: true, hit: false },
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
    // 7m+ away, well past REACH_RANGE (3m).
    const result = await directUpdates(page, { x: 4, y: 16 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [{ dive: true }]);
    expect(result.playerState).toBe('active');
  });

  test('no aiming required: dives regardless of joystick direction', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball is 2.5m "up" the court (toward the net) while the joystick is
    // held hard the opposite way. The old swipe mechanic gated on direction;
    // the button deliberately does not - the dash target comes purely from
    // the ball's trajectory.
    const away = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { dive: true, move: { x: 0, y: 1 } },
    ]);
    expect(away.playerState).toBe('diving');

    // Same, joystick held sideways.
    const sideways = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { dive: true, move: { x: 1, y: 0 } },
    ]);
    expect(sideways.playerState).toBe('diving');

    // And with no joystick input at all.
    const idle = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [{ dive: true }]);
    expect(idle.playerState).toBe('diving');
  });

  test('a swipe alone no longer triggers a dive', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Exactly the setup that used to dive on a well-aimed swipe: in range,
    // swipe pointing straight at the ball. Must now do nothing at all.
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 9 }, { x: 4, y: 1 }, 2, [
      { swipe: { x: 0, y: -1 } },
    ]);
    expect(result.playerState).toBe('active');
    expect(result.ball.lastToucher).toBeNull();
  });

  test('a contact mid-dive resolves as a pass to the teammate when nothing else was buffered', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight passes right through the player's own position, so the
    // dive's intercept point is exactly where the player already stands -
    // still within HIT_RANGE the whole time. Two update calls: the first
    // consumes the edge-triggered dive press and enters 'diving'; the second
    // is where updateDiving's own contact check runs and resolves it -
    // exactly like two consecutive real animation frames 16ms apart.
    const result = await directUpdates(page, { x: 4, y: 11.5 }, { x: 4, y: 11.5 }, { x: 4, y: 1 }, 3, [
      { dive: true },
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
      { dive: true, hit: true },
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
    // left the entire time, so it never actually gets within HIT_RANGE of the
    // player - this test is purely about the dash's movement, not a catch.
    await directUpdates(page, { x: 4, y: 11.5 }, { x: 0, y: 9 }, { x: 3, y: 9 }, 10, [{ dive: true }]);

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

  test('every dive ends in a recovery pause, even one that never connects', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Same slow, far-off ball as the dash-timing test above - stays well out
    // of HIT_RANGE (and well outside the teammate's TEAMMATE_REACT_RADIUS
    // the whole flight) for the entire observation window, so nobody ever
    // touches it. The dive must still pass through 'recovering' before
    // control returns.
    await directUpdates(page, { x: 4, y: 11.5 }, { x: 0, y: 9 }, { x: 3, y: 9 }, 10, [{ dive: true }]);

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'recovering', undefined, {
      timeout: 1000,
    });
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    const after = await page.evaluate(() => (window as any).__game.state.ball.lastToucher);
    expect(after).toBeNull();
  });
});
