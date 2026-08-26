import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state, aimDir: { ...g.state.player.aimDir } },
      ball: {
        pos: { ...g.state.ball.pos },
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

/** Forces the RNG used by the net-fault risk roll (see utils/random.ts). */
async function forceRandom(page: Page, value: number) {
  await page.evaluate((value) => (window as any).__setRandom(() => value), value);
}

/** Stops the AI teammate/opponents from acting at all - several of these
 * tests deliberately jump/spike right next to the net, and the teammate's
 * dynamic zone-homing (or an opponent's own reaction) can otherwise
 * occasionally wander into range of the very ball the player just spiked,
 * redirecting it before the test gets to observe lastToucher === 'player'.
 * Only the player's own Jump-Smash mechanic is under test in this file. */
async function stubAiEntities(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.state.teammate.update = () => {};
    for (const o of g.state.opponents) o.update = () => {};
  });
}

async function swipeOnCanvas(page: Page, dx: number, dy: number) {
  const canvas = await page.locator('#game-canvas').boundingBox();
  if (!canvas) throw new Error('canvas not found');
  const cx = canvas.x + canvas.width / 2;
  const cy = canvas.y + canvas.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.mouse.up();
}

test.describe('Sprung-Schmetterschlag: works anywhere, opens a slow-motion aim window on contact', () => {
  test('the jump button works from anywhere on the field, not just near the net', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);

    await teleportPlayer(page, { x: 4, y: 15 }); // deep baseline, far from the net
    await tapButton(page, 'jump-btn');

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'jumping_up', undefined, {
      timeout: 500,
    });
  });

  test('a jump with no ball nearby completes with nothing fired', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);

    await teleportPlayer(page, { x: 4, y: 15 });
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'active', undefined, {
      timeout: 1500,
    });

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
  });

  test('ball contact while airborne opens the slow-motion aim window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);

    await teleportPlayer(page, { x: 4, y: 9 });
    // Ball sits right at the player's position already - contact is
    // immediate once jumping_up starts.
    await launchBall(page, { x: 4, y: 9 }, { x: 4.05, y: 9.05 }, 5);
    await tapButton(page, 'jump-btn');

    await page.waitForFunction(() => (window as any).__game.state.player.state === 'slowmo_aim', undefined, {
      timeout: 500,
    });
  });

  test('a swipe during the aim window sets the spike direction and resolves immediately', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0.99); // never net-fault, regardless of distance

    await teleportPlayer(page, { x: 4, y: 9 });
    await launchBall(page, { x: 4, y: 9 }, { x: 4.05, y: 9.05 }, 5);
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'slowmo_aim', undefined, {
      timeout: 500,
    });

    // Diagonally right and toward the net. A purely sideways aim would no
    // longer cross at all: the spike target is not clamped into the opponent
    // court any more (that is what makes out-balls possible), so the direction
    // has to actually point over the net for the ball to go there.
    await swipeOnCanvas(page, 120, -120);

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1500,
    });
    const after = await getState(page);
    expect(after.player.state).toBe('jumping_down');
    expect(after.ball.target.x).toBeGreaterThan(5);
    expect(after.ball.target.y).toBeLessThan(8); // over the net
  });

  test('no swipe during the aim window times out with the default straight-ahead aim', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0.99); // never net-fault

    await teleportPlayer(page, { x: 4, y: 9 });
    await launchBall(page, { x: 4, y: 9 }, { x: 4.05, y: 9.05 }, 5);
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.player.state === 'slowmo_aim', undefined, {
      timeout: 500,
    });

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 2000,
    });
    const after = await getState(page);
    // Straight ahead - no swipe was made - but no longer to the millimetre:
    // every spike now lands with a small random scatter around where it was
    // aimed (SPIKE_SCATTER_RADIUS 0.55m).
    expect(Math.abs(after.ball.target.x - 4)).toBeLessThanOrEqual(0.55);
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('net-fault risk: jumping right at the net always clears, even on an unlucky roll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0); // worst possible roll

    await teleportPlayer(page, { x: 4, y: 8.4 }); // 0.4m from the net - well within the safe distance
    await launchBall(page, { x: 4, y: 8.4 }, { x: 4.05, y: 8.45 }, 5);
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 2000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeLessThan(8); // cleared the net despite the worst-case roll
  });

  test('net-fault risk: jumping far from the net nets out on an unlucky roll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0); // worst possible roll

    await teleportPlayer(page, { x: 4, y: 15 }); // deep baseline, well past the risk-max distance
    await launchBall(page, { x: 4, y: 15 }, { x: 4.05, y: 15.05 }, 5);
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 2000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeGreaterThan(8); // netted out, dropped back on the player's own side
  });

  test('bugfix: a ball that drifts out of HIT_RANGE during the aim window is never hit - no phantom contact', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0.99); // rule out the net-fault roll as a confound

    // Drives Player.update()/Ball.update() directly in lockstep, mirroring
    // exactly what GameState.update() does every frame (including the
    // ball-dt scaling while player.state === 'slowmo_aim') - fully
    // deterministic, independent of real click/network round-trip timing,
    // which a ball this fast (needed to actually drift beyond HIT_RANGE
    // within the short aim window) can't reliably survive.
    const result = await page.evaluate(() => {
      const SLOWMO_FACTOR = 0.18; // mirror src/game/constants.ts
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, dive: false, hit: false };
      const step = (dt: number, input = noInput) => {
        g.state.player.update(dt, input, g.state.ball, g.state.teammate.pos, false);
        const ballDt = g.state.player.state === 'slowmo_aim' ? dt * SLOWMO_FACTOR : dt;
        g.state.ball.update(ballDt);
      };

      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.player.state = 'active';
      // Fast flight (0.6s across 8.5m, ~14 m/s): starts just inside
      // HIT_RANGE of the player (0.4m) so the jump catches it immediately.
      g.state.ball.launch({ x: 4, y: 9.4 }, { x: 4, y: 1 }, { duration: 0.6, peakHeight: 3, toucher: null });

      step(0.016, { ...noInput, jump: true }); // -> jumping_up (tryStartJump doesn't itself check contact)
      step(0.016); // jumping_up's own contact check runs here - ball is still in range
      const enteredSlowmo = g.state.player.state === 'slowmo_aim';

      // Advance a full 0.9s of real time in small steps (matches how the
      // real game loop ticks) - past SLOWMO_REAL_DURATION (0.55s) - without
      // ever swiping, so it must resolve via the timeout path once the ball
      // has drifted away.
      for (let t = 0; t < 0.9; t += 0.016) step(0.016);

      return {
        enteredSlowmo,
        lastToucher: g.state.ball.lastToucher,
        ballState: g.state.ball.state,
        playerState: g.state.player.state,
      };
    });

    expect(result.enteredSlowmo).toBe(true); // sanity: the bug scenario was actually set up
    expect(result.lastToucher).not.toBe('player'); // no contact fired at all
    expect(result.ballState).toBe('flying'); // the original flight continues undisturbed
    expect(result.playerState).toBe('active'); // jump completed normally, empty-handed
  });

  test('net-fault risk: jumping far from the net can still succeed on a lucky roll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubAiEntities(page);
    await forceRandom(page, 0.99); // best possible roll

    await teleportPlayer(page, { x: 4, y: 15 });
    await launchBall(page, { x: 4, y: 15 }, { x: 4.05, y: 15.05 }, 5);
    await tapButton(page, 'jump-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 2000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeLessThan(8); // cleared, despite the long jump
  });
});
