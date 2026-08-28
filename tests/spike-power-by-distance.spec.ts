import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The Jump-Smash's power falls off with how far from the net the player took
 * off (see SPIKE_POWER_* / spikeWeakness). Struck at the net it keeps its
 * full, flat, fast form; from deep it arrives slower and loopier, and so is
 * genuinely defendable instead of a near-certain point.
 *
 * Full-power values: duration 0.50s, peak 1.20m.
 * Fully-weakened values (>=7m from the net): duration 1.10s, peak 1.90m.
 */

const NET_Y = 8;

/** Jumps and spikes from `netDist` metres behind the net, driving
 * Player.update()/Ball.update() in lockstep exactly as GameState.update()
 * does (including the slow-motion ball-dt scaling), and returns the resulting
 * shot's own parameters. Fully deterministic - no reliance on real click or
 * animation-frame timing. The RNG is pinned so the net-fault roll never
 * fires: this is about the spike that DOES go over. */
async function spikeFrom(page: Page, netDist: number, ballOffsetY = 0.05) {
  return page.evaluate(
    ({ netDist, ballOffsetY, NET_Y }) => {
      const SLOWMO_FACTOR = 0.18; // mirror src/game/constants.ts
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      (window as any).__setRandom(() => 0.99); // never net-fault

      const y = NET_Y + netDist;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = y;
      g.state.player.state = 'active';
      g.state.player.height = 0;
      // Ball.launch deliberately carries whatever height the ball already had
      // into the new flight (that is what makes a mid-air hit continue
      // smoothly). In a test that re-launches on a page whose ball is still
      // airborne from the previous case, that leftover height lifts the ball
      // clean out of the player's hitbox - so reset it first.
      g.state.ball.height = 0;
      g.state.ball.launch(
        { x: 4, y: y + ballOffsetY },
        { x: 4.05, y: y + ballOffsetY },
        { duration: 5, peakHeight: 0.5, toucher: null },
      );

      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (dt: number, input = noInput) => {
        g.state.player.update(dt, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? dt * SLOWMO_FACTOR : dt);
      };

      step(0.016, { ...noInput, jump: true });
      for (let i = 0; i < 80 && g.state.ball.lastToucher !== 'player'; i++) step(0.016);

      return {
        lastToucher: g.state.ball.lastToucher,
        duration: g.state.ball.duration,
        peakHeight: g.state.ball.peakHeight,
        target: { ...g.state.ball.target },
        contactPos: { ...g.state.player.pos },
      };
    },
    { netDist, ballOffsetY, NET_Y },
  );
}

test.describe('Sprung-Schmetterschlag: power scales with the takeoff distance from the net', () => {
  test('a spike struck at the net keeps full power', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await spikeFrom(page, 0.5);
    expect(r.lastToucher).toBe('player'); // sanity: the spike actually fired
    expect(r.duration).toBeCloseTo(0.5, 2);
    expect(r.peakHeight).toBeCloseTo(1.2, 2);
  });

  test('full power still applies right up to SPIKE_POWER_FULL_DISTANCE', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await spikeFrom(page, 2);
    expect(r.duration).toBeCloseTo(0.5, 2);
    expect(r.peakHeight).toBeCloseTo(1.2, 2);
  });

  test('a spike struck from deep is at its weakest - slower and loopier', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await spikeFrom(page, 7);
    expect(r.lastToucher).toBe('player');
    expect(r.duration).toBeCloseTo(1.1, 2);
    expect(r.peakHeight).toBeCloseTo(1.9, 2);
  });

  test('power falls off monotonically with takeoff distance', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const distances = [2, 3, 4, 5, 6, 7];
    const durations: number[] = [];
    for (const d of distances) {
      const r = await spikeFrom(page, d);
      expect(r.lastToucher).toBe('player');
      durations.push(r.duration);
    }

    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThan(durations[i - 1]);
    }
    // And the whole ramp is a real difference, not a rounding wobble.
    expect(durations[durations.length - 1]).toBeGreaterThan(durations[0] * 2);
  });

  test('the weakened arc stays under CATCHABLE_HEIGHT, so the extra airtime is actually defendable', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A weak spike must be slower, not briefly untouchable: an arc peaking
    // above CATCHABLE_HEIGHT (2.0) would be un-catchable mid-flight, which
    // works against the whole point of the ramp.
    for (const d of [3, 5, 7, 9]) {
      const r = await spikeFrom(page, d);
      expect(r.peakHeight).toBeLessThanOrEqual(2.0);
    }
  });

  test('power is fixed at takeoff: the in-air drift toward the ball cannot restore it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball sits 0.85m closer to the net than the player: outside HIT_RANGE
    // (0.7m) but inside JUMP_ASSIST_RANGE (0.9m), which is the only band in
    // which the in-air drift can act at all now that it has been trimmed to
    // a fine correction. So the player does drift netward before contact -
    // and the spike must still be graded on where they jumped FROM (7m out
    // => fully weakened), not on where they ended up.
    const drifted = await spikeFrom(page, 7, -0.85);
    expect(drifted.lastToucher).toBe('player');
    expect(drifted.contactPos.y).toBeLessThan(15); // sanity: the drift really happened
    expect(drifted.duration).toBeCloseTo(1.1, 2);
    expect(drifted.peakHeight).toBeCloseTo(1.9, 2);
  });

  test('a weakened spike is still aimed where it was aimed - only its pace changes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Default aim (no swipe) is straight over the net; a weak spike must
    // still cross, not fall short on the player's own side.
    const r = await spikeFrom(page, 7);
    expect(r.target.y).toBeLessThan(NET_Y);
  });
});
