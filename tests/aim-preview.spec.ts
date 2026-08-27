import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The spike's aim swipe, with a live trajectory preview.
 *
 * 1. While aiming, `player.aimPreview` describes the exact flight the spike
 *    would take right now - a real parabola, not a straight swipe trail - and
 *    is recomputed every frame so it follows the swipe.
 * 2. Swipe DIRECTION aims it; swipe LENGTH sets how far (SPIKE_MIN_RANGE..
 *    SPIKE_RANGE) and, secondarily, the pace. Net distance at takeoff stays
 *    the dominant term for pace.
 * 3. The ball lands with a small random scatter around the aimed point.
 * 4. It can land out - the target is not clamped into the court - and hitting
 *    out loses the point.
 */

const COURT_WIDTH = 8;
const COURT_LENGTH = 16;
const SPIKE_SCATTER_RADIUS = 0.55;

/** Drives a jump into the aim window, then applies `aims` one frame each,
 * returning the preview after every one. Fully deterministic. */
async function aimFrames(page: Page, netDist: number, aims: { dir: { x: number; y: number }; strength: number }[]) {
  return page.evaluate(
    ({ netDist, aims }) => {
      const SLOWMO_FACTOR = 0.18;
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      (window as any).__setRandom(() => 0.99);

      const noInput = { move: { x: 0, y: 0 }, aim: null, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (i: any = noInput) => {
        g.state.player.update(0.016, i, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      const y = 8 + netDist;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = y;
      g.state.player.state = 'active';
      g.state.player.height = 0;
      g.state.ball.height = 0;
      g.state.ball.launch({ x: 4, y: y + 0.02 }, { x: 4.05, y: y + 0.02 }, { duration: 8, peakHeight: 0.5, toucher: null });

      step({ ...noInput, jump: true });
      step();
      if (g.state.player.state !== 'slowmo_aim') return null;

      const out: any[] = [];
      for (const aim of aims) {
        step({ ...noInput, aim });
        const p = g.state.player.aimPreview;
        out.push({
          target: { ...p.target },
          from: { ...p.from },
          duration: p.duration,
          peakHeight: p.peakHeight,
          initialHeight: p.initialHeight,
        });
      }
      return out;
    },
    { netDist, aims },
  );
}

/** One full jump-aim-fire cycle; returns where it was aimed and where it went. */
async function spikeOnce(page: Page, netDist: number, dir: { x: number; y: number }, strength: number) {
  return page.evaluate(
    ({ netDist, dir, strength }) => {
      const SLOWMO_FACTOR = 0.18;
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      const noInput = { move: { x: 0, y: 0 }, aim: null, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const step = (i: any = noInput) => {
        g.state.player.update(0.016, i, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      const y = 8 + netDist;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = y;
      g.state.player.state = 'active';
      g.state.player.height = 0;
      g.state.ball.height = 0;
      g.state.ball.launch({ x: 4, y: y + 0.02 }, { x: 4.05, y: y + 0.02 }, { duration: 8, peakHeight: 0.5, toucher: null });

      step({ ...noInput, jump: true });
      step();
      if (g.state.player.state !== 'slowmo_aim') return null;
      step({ ...noInput, aim: { dir, strength } });
      const aimed = { ...g.state.player.aimPreview.target };
      step({ ...noInput, swipe: dir });
      return { aimed, actual: { ...g.state.ball.target }, previewCleared: g.state.player.aimPreview === null };
    },
    { netDist, dir, strength },
  );
}

test.describe('Schmetterschlag: live trajectory preview, swipe power, scatter, out-balls', () => {
  test('the preview is a real parabola, not a straight line', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const frames = await aimFrames(page, 1, [{ dir: { x: 0, y: -1 }, strength: 1 }]);
    expect(frames).not.toBeNull();
    const p = frames![0];

    // Rebuild the drawn curve the same way the renderer does, and check it
    // actually bulges away from the straight chord between its endpoints.
    const heightAt = (u: number) => p.peakHeight * 4 * u * (1 - u) + p.initialHeight * (1 - u);
    expect(p.peakHeight).toBeGreaterThan(0);
    expect(heightAt(0)).toBeCloseTo(p.initialHeight, 5); // starts at the ball
    expect(heightAt(1)).toBeCloseTo(0, 5); // and comes back down to the ground
    expect(heightAt(0.5)).toBeGreaterThan(heightAt(0.1)); // rises...
    expect(heightAt(0.5)).toBeGreaterThan(heightAt(0.9)); // ...then falls again

    // Curved, not straight: a straight line between the same two endpoints
    // would just decay the initial height linearly. The real curve sits above
    // it everywhere in between, by the arc's own peak.
    const straightLineAt = (u: number) => p.initialHeight * (1 - u);
    expect(heightAt(0.5) - straightLineAt(0.5)).toBeCloseTo(p.peakHeight, 5);
    expect(heightAt(0.25)).toBeGreaterThan(straightLineAt(0.25));
    expect(heightAt(0.75)).toBeGreaterThan(straightLineAt(0.75));

    // And it falls under gravity rather than descending evenly: the last
    // quarter of the flight loses far more height than the quarter before it.
    const dropBefore = heightAt(0.5) - heightAt(0.75);
    const dropLast = heightAt(0.75) - heightAt(1);
    expect(dropLast).toBeGreaterThan(dropBefore * 2);
  });

  test('the preview updates live as the swipe changes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const frames = await aimFrames(page, 1, [
      { dir: { x: 0, y: -1 }, strength: 1 },
      { dir: { x: 0.7, y: -0.7 }, strength: 1 },
      { dir: { x: 0, y: -1 }, strength: 0.2 },
    ]);
    expect(frames).not.toBeNull();
    const [straight, diagonal, weak] = frames!;

    // Turning the swipe moves the target sideways...
    expect(diagonal.target.x).toBeGreaterThan(straight.target.x + 1);
    // ...and shortening it pulls the target back in.
    expect(weak.target.y).toBeGreaterThan(straight.target.y + 1);
  });

  test('swipe length sets how far the spike is aimed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const frames = await aimFrames(page, 1, [
      { dir: { x: 0, y: -1 }, strength: 0 },
      { dir: { x: 0, y: -1 }, strength: 0.5 },
      { dir: { x: 0, y: -1 }, strength: 1 },
    ]);
    const [short, mid, long] = frames!;
    const player = 9;
    // SPIKE_MIN_RANGE 3 .. SPIKE_RANGE 9, from the player's y.
    expect(player - short.target.y).toBeCloseTo(3, 1);
    expect(player - mid.target.y).toBeCloseTo(6, 1);
    expect(player - long.target.y).toBeCloseTo(9, 1);
  });

  test('swipe length also nudges the pace - but net distance stays dominant', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const atNet = await aimFrames(page, 1, [
      { dir: { x: 0, y: -1 }, strength: 0 },
      { dir: { x: 0, y: -1 }, strength: 1 },
    ]);
    const [nearShort, nearLong] = atNet!;
    // A full swipe reproduces the pure net-distance value (factor exactly 1);
    // the shortest stretches it by SPIKE_SWIPE_SLOW_FACTOR (1.25).
    expect(nearLong.duration).toBeCloseTo(0.5, 3);
    expect(nearShort.duration).toBeCloseTo(0.625, 3);

    const deep = await aimFrames(page, 7, [{ dir: { x: 0, y: -1 }, strength: 1 }]);
    // The net-distance ramp spans 0.5 -> 1.1 (a factor of 2.2); the swipe term
    // only spans 1.0 -> 1.25. The distance rule must be the bigger effect.
    const swipeSpread = nearShort.duration / nearLong.duration;
    const netSpread = deep![0].duration / nearLong.duration;
    expect(netSpread).toBeGreaterThan(swipeSpread);
    expect(deep![0].duration).toBeCloseTo(1.1, 3);
  });

  test('the ball lands with a small scatter around the aimed point, not exactly on it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const offsets: number[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await spikeOnce(page, 1, { x: 0, y: -1 }, 0.5);
      expect(r).not.toBeNull();
      offsets.push(Math.hypot(r!.actual.x - r!.aimed.x, r!.actual.y - r!.aimed.y));
    }

    // Always inside the scatter disc...
    expect(Math.max(...offsets)).toBeLessThanOrEqual(SPIKE_SCATTER_RADIUS + 1e-6);
    // ...never a perfect bullseye every time...
    expect(Math.max(...offsets)).toBeGreaterThan(0.1);
    // ...and genuinely varying, not one fixed offset.
    expect(new Set(offsets.map((o) => o.toFixed(3))).size).toBeGreaterThan(20);
  });

  test('the preview is cleared once the spike is struck', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await spikeOnce(page, 1, { x: 0, y: -1 }, 1);
    expect(r!.previewCleared).toBe(true);
  });

  test('there is no preview while not aiming', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const preview = await page.evaluate(() => (window as any).__game.state.player.aimPreview);
    expect(preview).toBeNull();
  });

  test('a full-power spike can land out - the target is not clamped into the court', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    let out = 0;
    const total = 40;
    for (let i = 0; i < total; i++) {
      // From the net, aimed at full length straight ahead: that is 9m from
      // y=9, i.e. right on the opponents' baseline, so the scatter decides.
      const r = await spikeOnce(page, 1, { x: 0, y: -1 }, 1);
      const t = r!.actual;
      if (t.x < 0 || t.x > COURT_WIDTH || t.y < 0 || t.y > COURT_LENGTH) out++;
    }
    expect(out).toBeGreaterThan(0); // out-balls really happen...
    expect(out).toBeLessThan(total); // ...but are not guaranteed
  });

  test('a controlled shorter swipe stays in - aiming still pays', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    for (let i = 0; i < 25; i++) {
      const r = await spikeOnce(page, 1, { x: 0, y: -1 }, 0.3);
      const t = r!.actual;
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(COURT_WIDTH);
      expect(t.y).toBeGreaterThanOrEqual(0);
      expect(t.y).toBeLessThanOrEqual(COURT_LENGTH);
    }
  });

  test('hitting out loses the point, it does not win one', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, aim: null, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      g.state.restart();
      g.state.teammate.update = () => {};
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      g.state.awaitingServe = null;
      g.state.phase = 'playing';

      // The human team hits it well past the opponents' baseline.
      g.state.ball.launch({ x: 4, y: 8.5 }, { x: 4, y: -2 }, { duration: 0.5, peakHeight: 1, toucher: 'player' });
      for (let i = 0; i < 200 && g.state.phase === 'playing'; i++) g.state.update(0.016, noInput);
      const afterHumanOut = { ...g.state.score };

      // ...and the same the other way: an opponent hits past the human baseline.
      g.state.restart();
      g.state.teammate.update = () => {};
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      g.state.awaitingServe = null;
      g.state.phase = 'playing';
      g.state.ball.launch({ x: 4, y: 7.5 }, { x: 4, y: 18 }, { duration: 0.5, peakHeight: 1, toucher: 'opponent1' });
      for (let i = 0; i < 200 && g.state.phase === 'playing'; i++) g.state.update(0.016, noInput);
      const afterOpponentOut = { ...g.state.score };

      return { afterHumanOut, afterOpponentOut };
    });

    // Hit out by the human team -> point to the opponents, NOT to the humans
    // (which is what the plain "which half did it land in" rule would have said).
    expect(r.afterHumanOut).toEqual({ human: 0, opponents: 1 });
    // And symmetrically.
    expect(r.afterOpponentOut).toEqual({ human: 1, opponents: 0 });
  });

  test('a ball landing IN still scores by which half it came down on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, aim: null, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      g.state.restart();
      g.state.teammate.update = () => {};
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      g.state.awaitingServe = null;
      g.state.phase = 'playing';
      // Lands in the far corner of the opponent half, in bounds, untouched.
      g.state.ball.launch({ x: 4, y: 8.5 }, { x: 0.5, y: 0.5 }, { duration: 0.5, peakHeight: 1, toucher: 'player' });
      for (let i = 0; i < 200 && g.state.phase === 'playing'; i++) g.state.update(0.016, noInput);
      return { ...g.state.score };
    });

    expect(r).toEqual({ human: 1, opponents: 0 });
  });
});
