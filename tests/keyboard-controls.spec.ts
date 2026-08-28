import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Keyboard scheme:
 *   W A S D  run on the ground; while airborne they aim the smash
 *   Space    Block
 *   Q        first press jumps; a second press while airborne hits the smash
 *   E        Pass
 *   F        Notfall-Schlag
 *
 * The smash hit only ever fires when the ball is genuinely in reach at the
 * moment of that second Q - never into empty air.
 */

const NET_Y = 8;

async function stubAi(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.state.teammate.update = () => {};
    for (const o of g.state.opponents) o.update = () => {};
    (window as any).__setRandom(() => 0.99); // never net-fault
  });
}

async function place(page: Page, playerY: number, ballOffsetY: number, duration = 5) {
  await page.evaluate(
    ({ playerY, ballOffsetY, duration }) => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = playerY;
      g.state.player.state = 'active';
      // Ball.launch deliberately carries whatever height the ball already had
      // into the new flight (that is what makes a mid-air hit continue
      // smoothly). In a test that re-launches on a page whose ball is still
      // airborne from the previous case, that leftover height lifts the ball
      // clean out of the player's hitbox - so reset it first.
      g.state.ball.height = 0;
      g.state.ball.launch(
        { x: 4, y: playerY + ballOffsetY },
        { x: 4.05, y: playerY + ballOffsetY },
        // A near-flat arc: contact now needs the two hitboxes to actually
        // overlap, and the renderer draws height as a y-offset, so any real
        // arc lifts the ball straight out of the player's hitbox within a few
        // frames. At 0.05 the ball stays where it is put.
        { duration, peakHeight: 0.05, toucher: null },
      );
    },
    { playerY, ballOffsetY, duration },
  );
}

async function state(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      playerState: g.state.player.state,
      pos: { ...g.state.player.pos },
      aimDir: { ...g.state.player.aimDir },
      height: g.state.player.height,
      ball: { lastToucher: g.state.ball.lastToucher, target: { ...g.state.ball.target } },
    };
  });
}

test.describe('Tastatur-Steuerung', () => {
  test('Space triggers Block - the same net wall as the on-screen Block button', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    await place(page, 8.5, -4); // at the net, ball nowhere near
    const before = await state(page);
    expect(before.playerState).toBe('active');

    // Record every state and height the player passes through, from inside the
    // page: the block only lasts BLOCK_DURATION (0.55s), too brief to catch
    // reliably by polling across a browser round-trip.
    await page.evaluate(() => {
      const g = (window as any).__game;
      (window as any).__states = [] as string[];
      (window as any).__heights = [] as number[];
      const tick = () => {
        (window as any).__states.push(g.state.player.state);
        (window as any).__heights.push(g.state.player.height);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    await page.keyboard.press('Space');
    await page.waitForTimeout(1200); // block + margin

    const seen: string[] = await page.evaluate(() => (window as any).__states);
    const heights: number[] = await page.evaluate(() => (window as any).__heights);
    expect(seen).toContain('blocking');
    expect(seen[seen.length - 1]).toBe('active'); // and control comes back

    // The block goes UP - that is the whole move - and comes back down.
    expect(Math.max(...heights)).toBeCloseTo(0.85, 2); // BLOCK_PEAK_HEIGHT
    expect(heights[heights.length - 1]).toBe(0);

    // Nothing of the old dive survives: the player never moved, and there is
    // no recovery pause afterwards.
    const after = await state(page);
    expect(after.pos.x).toBeCloseTo(before.pos.x, 6);
    expect(after.pos.y).toBeCloseTo(before.pos.y, 6);
    expect(seen).not.toContain('diving');
    expect(seen).not.toContain('recovering');
  });

  test('Space blocks from anywhere, but only intercepts at the net', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // Deep in the back court - far past BLOCK_NET_DISTANCE (1.5m).
    await place(page, 14, -5);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);

    // The move still plays (the button is never dead)...
    expect((await state(page)).playerState).toBe('blocking');
    await page.waitForTimeout(700);
    // ...and ends cleanly, having touched nothing.
    const after = await state(page);
    expect(after.playerState).toBe('active');
    expect(after.ball.lastToucher).toBeNull();
  });

  test('Q jumps exactly once - holding it does not re-trigger', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // No ball anywhere near, so the jump runs its full course untouched.
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 14;
      g.state.player.state = 'active';
      g.state.ball.state = 'idle';
    });

    await page.keyboard.down('KeyQ');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });

    // Hold Q down through the whole jump: auto-repeat must not produce more
    // jumps, so it lands back in 'active' normally.
    await page.waitForTimeout(400);
    await page.keyboard.up('KeyQ');

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });
    expect((await state(page)).ball.lastToucher).toBeNull(); // nothing was hit
  });

  test('WASD steers the smash aim while airborne', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // Ball right on the player, so the jump makes contact and opens the aim
    // window; then hold D and fire with the second Q - the smash must go right.
    await place(page, 9, 0.02);
    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'slowmo_aim', undefined, {
      timeout: 700,
    });

    // D and W together: right AND toward the net. A purely sideways aim would
    // no longer cross - the spike target is not clamped into the opponent
    // court any more.
    await page.keyboard.down('KeyD');
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(60);
    const aimed = await state(page);
    expect(aimed.aimDir.x).toBeGreaterThan(0.5); // aim now points right...
    expect(aimed.aimDir.y).toBeLessThan(-0.5); // ...and toward the net

    await page.keyboard.press('KeyQ');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('KeyW');

    const after = await state(page);
    expect(after.ball.target.x).toBeGreaterThan(5); // struck to the right
    expect(after.ball.target.y).toBeLessThan(NET_Y); // and over the net
  });

  test('the second Q fires the hit only with the ball actually in reach', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // Deterministic frame-stepping: a real jump lasts ~0.35s, far too short to
    // land keystrokes inside reliably over a browser round-trip.
    const result = await page.evaluate(() => {
      const SLOWMO_FACTOR = 0.18;
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (input = noInput) => {
        g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      // Ball parked 3m away - never within reach at any point of the jump.
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 12;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4.05, y: 9 }, { duration: 8, peakHeight: 0.5, toucher: null });

      step({ ...noInput, jump: true }); // first Q -> jump
      const jumped = g.state.player.state;

      // Spam the second Q for the entire flight. It must never fire, and must
      // never abort the jump either.
      const states: string[] = [];
      for (let i = 0; i < 60; i++) {
        step({ ...noInput, spike: true });
        states.push(g.state.player.state);
      }

      return {
        jumped,
        firedIntoNothing: g.state.ball.lastToucher !== null,
        returnedToActive: states[states.length - 1],
        everEnteredSlowmo: states.includes('slowmo_aim'),
      };
    });

    expect(result.jumped).toBe('jumping_up');
    expect(result.firedIntoNothing).toBe(false); // no contact fired into empty air
    expect(result.everEnteredSlowmo).toBe(false); // never even reached the ball
    expect(result.returnedToActive).toBe('active'); // the jump completed normally
  });

  test('the second Q does fire the moment the ball IS in reach', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    const result = await page.evaluate(() => {
      const SLOWMO_FACTOR = 0.18;
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (input = noInput) => {
        g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9.02 }, { x: 4.05, y: 9.02 }, { duration: 8, peakHeight: 0.5, toucher: null });

      step({ ...noInput, jump: true });
      // One frame with no spike press: contact opens the aim window.
      step();
      const beforeSpike = { state: g.state.player.state, toucher: g.state.ball.lastToucher };
      // Now the second Q.
      step({ ...noInput, spike: true });

      return {
        beforeSpike,
        afterToucher: g.state.ball.lastToucher,
        afterState: g.state.player.state,
      };
    });

    // Pressing nothing left the ball untouched; the second Q is what hit it.
    expect(result.beforeSpike.toucher).toBeNull();
    expect(result.afterToucher).toBe('player');
    expect(result.afterState).toBe('jumping_down');
  });

  test('a second Q pressed too late - after the ball has left reach - does not fire', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    const result = await page.evaluate(() => {
      const SLOWMO_FACTOR = 0.18;
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (input = noInput) => {
        g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      // A fast ball passing right through the player: briefly in reach, then
      // gone. Jump with it already in reach, then deliberately wait it out
      // before pressing the second Q.
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 4, y: 9.4 }, { x: 4, y: 1 }, { duration: 0.6, peakHeight: 3, toucher: null });

      step({ ...noInput, jump: true });
      step(); // contact opens the aim window
      const openedAimWindow = g.state.player.state === 'slowmo_aim';

      // Let the ball creep out of range without pressing anything...
      for (let i = 0; i < 40; i++) step();
      const stillUntouched = g.state.ball.lastToucher;

      // ...then press Q, far too late.
      for (let i = 0; i < 20; i++) step({ ...noInput, spike: true });

      return { openedAimWindow, stillUntouched, finalToucher: g.state.ball.lastToucher };
    });

    expect(result.openedAimWindow).toBe(true); // sanity: the scenario really set up
    expect(result.stillUntouched).toBeNull();
    expect(result.finalToucher).toBeNull(); // the late Q fired nothing
  });

  test('E passes and F plays the Notfall-Schlag', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // E -> pass to the teammate (stays on the human side). Offset 0.2 rather
    // than 0.3: contact needs the two hitboxes to overlap (0.5m between
    // centres), and the ball's own small arc eats into that margin while the
    // keypress makes its round trip.
    await place(page, 15, -0.2);
    await page.keyboard.press('KeyE');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const passed = await state(page);
    expect(passed.ball.target.y).toBeGreaterThan(NET_Y);

    // F -> Notfall-Schlag over the net.
    await place(page, 15, -0.2);
    await page.keyboard.press('KeyF');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const hit = await state(page);
    expect(hit.ball.target.y).toBeLessThan(NET_Y);
  });

  test('WASD moves the player on the ground', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    const before = await state(page);

    await page.keyboard.down('KeyD');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyD');
    const right = await state(page);
    expect(right.pos.x).toBeGreaterThan(before.pos.x);

    // W runs up the court, toward the net (decreasing y).
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(300);
    await page.keyboard.up('KeyW');
    const up = await state(page);
    expect(up.pos.y).toBeLessThan(right.pos.y);

    // Releasing stops the player.
    await page.waitForTimeout(200);
    const settled = await state(page);
    await page.waitForTimeout(200);
    expect((await state(page)).pos).toEqual(settled.pos);
  });

  test('keyboard smash power still scales with the takeoff distance from the net', async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(distIndex);
    await stubAi(page);

    // Same Q-jump / Q-hit sequence, from the net and from deep. The existing
    // distance-based power rule must apply to the keyboard path too.
    const measure = async (netDist: number) =>
      page.evaluate((netDist) => {
        const SLOWMO_FACTOR = 0.18;
        const g = (window as any).__game;
        const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
        const step = (input = noInput) => {
          g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
          g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
        };
        const y = 8 + netDist;
        g.state.player.pos.x = 4;
        g.state.player.pos.y = y;
        g.state.player.state = 'active';
        g.state.ball.launch({ x: 4, y: y + 0.02 }, { x: 4.05, y: y + 0.02 }, { duration: 8, peakHeight: 0.5, toucher: null });
        step({ ...noInput, jump: true });
        for (let i = 0; i < 60 && g.state.ball.lastToucher !== 'player'; i++) step({ ...noInput, spike: true });
        return { duration: g.state.ball.duration, peakHeight: g.state.ball.peakHeight, toucher: g.state.ball.lastToucher };
      }, netDist);

    const atNet = await measure(1);
    const fromDeep = await measure(7);

    expect(atNet.toucher).toBe('player');
    expect(fromDeep.toucher).toBe('player');
    expect(atNet.duration).toBeCloseTo(0.5, 2); // full power
    expect(fromDeep.duration).toBeCloseTo(1.1, 2); // weakest
    expect(fromDeep.duration).toBeGreaterThan(atNet.duration);
  });
});
