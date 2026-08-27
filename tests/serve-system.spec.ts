import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The serve system.
 *
 * 1. Serve mode has its own UI: all four normal action buttons are gone and a
 *    single Aufschlag button is on screen.
 * 2. Pressing it runs the whole routine by itself - the ball is tossed
 *    straight up, the player springs after it, and the strike is an ordinary
 *    Jump-Smash: the same slow-motion aim window, the same live trajectory
 *    preview, the same swipe-length power, the same scatter, and the same
 *    possibility of putting it out.
 * 3. The instant the ball is struck the UI hands back to the normal four
 *    buttons and the rally runs normally.
 * 4. While preparing to serve the player may only slide along their own
 *    baseline: no step forward into the court, and the side lines are a hard
 *    wall.
 */

const COURT_WIDTH = 8;
const NET_Y = 8;
const PLAYER_RADIUS = 0.35;
const SERVE_BASELINE_Y = 16 - PLAYER_RADIUS; // COURT_LENGTH - PLAYER_RADIUS
const SPIKE_SCATTER_RADIUS = 0.55;

const ACTION_BUTTONS = ['jump-btn', 'pass-btn', 'dive-btn', 'hit-btn'];

async function buttonVisibility(page: Page) {
  return page.evaluate((ids) => {
    const vis = (id: string) => {
      const el = document.getElementById(id);
      if (!el) return 'MISSING';
      return getComputedStyle(el).display === 'none' ? 'hidden' : 'visible';
    };
    return { serve: vis('serve-btn'), actions: ids.map(vis) };
  }, ACTION_BUTTONS);
}

/** Wins a rally for the human team so the next serve is theirs. Aimed at the
 * far baseline corner, over in 0.5s - too fast and too deep for the back-zone
 * defender to reach from its base. */
async function intoServeMode(page: Page) {
  await page.evaluate(() => {
    (window as any).__game.state.ball.launch(
      { x: 4, y: 8 },
      { x: 0.5, y: 0.5 },
      { duration: 0.5, peakHeight: 3, toucher: null },
    );
  });
  await page.waitForFunction(() => (window as any).__game.state.awaitingServe === 'human', undefined, {
    timeout: 5000,
  });
}

async function tap(page: Page, id: string) {
  const box = await page.locator(`#${id}`).boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Aufschlag: its own UI mode, its own routine, its own movement rules', () => {
  test('serve mode shows exactly one button - the four normal actions are gone, not just greyed out', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // The opponents serve first, so the normal UI is up to begin with.
    const before = await buttonVisibility(page);
    expect(before.serve).toBe('hidden');
    expect(before.actions).toEqual(['visible', 'visible', 'visible', 'visible']);

    await intoServeMode(page);
    const during = await buttonVisibility(page);
    expect(during.serve).toBe('visible');
    expect(during.actions).toEqual(['hidden', 'hidden', 'hidden', 'hidden']);
  });

  test('the whole routine on one press: toss, jump, slow-motion aim window, strike', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    // Records the state sequence and every frame that carried a live aim
    // preview. Sampled inside the page: the slow-motion window is 0.55s of
    // real time, far too short to poll over a round trip.
    const recording = page.evaluate(
      () =>
        new Promise<{ states: string[]; previewFrames: number; lastPreview: any; firstToucher: string | null }>(
          (resolve) => {
            const g = (window as any).__game.state;
            const states: string[] = [];
            let previewFrames = 0;
            let lastPreview: any = null;
            // Who played the ball FIRST after the serve went up. Sampling
            // lastToucher at the end of the recording instead would just show
            // whichever opponent has since returned it.
            let firstToucher: string | null = null;
            const t0 = performance.now();
            const tick = () => {
              if (states[states.length - 1] !== g.player.state) states.push(g.player.state);
              if (!firstToucher && g.ball.lastToucher) firstToucher = g.ball.lastToucher;
              if (g.player.aimPreview) {
                previewFrames += 1;
                lastPreview = {
                  target: { ...g.player.aimPreview.target },
                  duration: g.player.aimPreview.duration,
                  peakHeight: g.player.aimPreview.peakHeight,
                  from: { ...g.player.aimPreview.from },
                };
              }
              if (performance.now() - t0 < 3000) requestAnimationFrame(tick);
              else resolve({ states, previewFrames, lastPreview, firstToucher });
            };
            requestAnimationFrame(tick);
          },
        ),
    );

    await tap(page, 'serve-btn');
    const rec = await recording;

    // The ball is tossed and the player springs after it, unprompted.
    expect(rec.states).toContain('serve_toss');
    expect(rec.states).toContain('jumping_up');
    // ...and the strike is an ordinary Jump-Smash, with the same slow-motion
    // aim window as any other.
    expect(rec.states).toContain('slowmo_aim');
    expect(rec.states.indexOf('serve_toss')).toBeLessThan(rec.states.indexOf('jumping_up'));
    expect(rec.states.indexOf('jumping_up')).toBeLessThan(rec.states.indexOf('slowmo_aim'));

    // The live trajectory preview ran for the whole window (~0.55s at 60fps).
    expect(rec.previewFrames).toBeGreaterThan(20);
    expect(rec.lastPreview).not.toBeNull();
    // Aimed over the net, from the baseline.
    expect(rec.lastPreview.from.y).toBeCloseTo(SERVE_BASELINE_Y, 1);
    expect(rec.lastPreview.target.y).toBeLessThan(NET_Y);

    // The serve is the player's own touch - nobody else got to it first.
    expect(rec.firstToucher).toBe('player');
  });

  test('the ball is struck exactly where the preview showed - only the scatter differs', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    const capture = page.evaluate(
      () =>
        new Promise<{ preview: any; struck: any }>((resolve) => {
          const g = (window as any).__game.state;
          let preview: any = null;
          const tick = () => {
            if (g.player.aimPreview) {
              preview = {
                target: { ...g.player.aimPreview.target },
                duration: g.player.aimPreview.duration,
                peakHeight: g.player.aimPreview.peakHeight,
              };
            }
            if (preview && g.ball.lastToucher === 'player') {
              resolve({
                preview,
                struck: { target: { ...g.ball.target }, duration: g.ball.duration, peakHeight: g.ball.peakHeight },
              });
              return;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

    await tap(page, 'serve-btn');
    const { preview, struck } = await capture;

    // Same flight parameters, to the millisecond...
    expect(struck.duration).toBeCloseTo(preview.duration, 5);
    expect(struck.peakHeight).toBeCloseTo(preview.peakHeight, 5);
    // ...and the same landing point, up to the deliberate scatter (the one
    // thing the preview cannot show, since the roll has not been made yet).
    const off = Math.hypot(struck.target.x - preview.target.x, struck.target.y - preview.target.y);
    expect(off).toBeLessThanOrEqual(SPIKE_SCATTER_RADIUS + 1e-6);
  });

  test('the UI hands back to the normal buttons the moment the ball is struck', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    await tap(page, 'serve-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 5000,
    });
    // awaitingServe is what the UI is driven from, and it is cleared by the
    // strike itself - so it must already be null here, not "eventually".
    expect(await page.evaluate(() => (window as any).__game.state.awaitingServe)).toBeNull();

    await page.waitForTimeout(100); // one frame for the DOM to follow
    const after = await buttonVisibility(page);
    expect(after.serve).toBe('hidden');
    expect(after.actions).toEqual(['visible', 'visible', 'visible', 'visible']);
  });

  test('a serve jump that never reaches the ball still hands the UI back - it can never get stuck', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game.state;
      const input = {
        move: { x: 0, y: 0 }, aim: null, swipe: null,
        jump: false, spike: false, pass: false, dive: false, hit: false, serve: false,
      };
      g.update(0.016, { ...input, serve: true }); // start the toss

      // Teleport the toss far away the instant it is airborne, so the jump
      // comes down empty-handed and resolveSpike never runs.
      const states: string[] = [];
      for (let t = 0; t < 3; t += 0.016) {
        g.ball.from = { x: 40, y: 40 };
        g.ball.target = { x: 40, y: 40 };
        g.ball.pos = { x: 40, y: 40 };
        g.update(0.016, input);
        if (states[states.length - 1] !== g.player.state) states.push(g.player.state);
      }
      return { states, awaitingServe: g.awaitingServe, serving: g.player.isServing };
    });

    expect(result.states[result.states.length - 1]).toBe('active');
    expect(result.serving).toBe(false);
    expect(result.awaitingServe).toBeNull();
  });

  test('serve stance: no step forward into the court, and the side lines are a hard wall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate(() => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.player.enterServeReady();

      const base = {
        move: { x: 0, y: 0 }, aim: null, swipe: null,
        jump: false, spike: false, pass: false, dive: false, hit: false, serve: false,
      };
      const step = (dt: number, move: { x: number; y: number }) =>
        g.player.update(dt, { ...base, move }, g.ball, g.teammate.pos, false);

      const ys: number[] = [];
      const xs: number[] = [];
      const track = () => { ys.push(g.player.pos.y); xs.push(g.player.pos.x); };

      const hold = (move: { x: number; y: number }, seconds: number) => {
        for (let t = 0; t < seconds; t += 0.016) { step(0.016, move); track(); }
        return { ...g.player.pos };
      };

      const startX = g.player.pos.x;
      // Forward (toward the net) and backward, five seconds each - both must
      // move the player exactly nowhere.
      const afterForward = hold({ x: 0, y: -1 }, 5);
      const afterBackward = hold({ x: 0, y: 1 }, 5);
      // Ten seconds hard right, then ten hard left - far longer than the court
      // is wide, so anything but a real wall would run off the side.
      const afterRight = hold({ x: 1, y: 0 }, 10);
      const afterLeft = hold({ x: -1, y: 0 }, 10);
      // Diagonals must not smuggle any forward motion in either.
      const afterDiagonal = hold({ x: 1, y: -1 }, 5);
      // And one absurd frame - a stalled tab resuming - which uncorrected
      // would place the player 13.5m off the side of an 8m-wide court.
      step(3, { x: 1, y: 0 }); track();
      step(3, { x: -1, y: -1 }); track();
      const afterHugeDt = { ...g.player.pos };

      return {
        startX, afterForward, afterBackward, afterRight, afterLeft, afterDiagonal, afterHugeDt,
        minY: Math.min(...ys), maxY: Math.max(...ys), minX: Math.min(...xs), maxX: Math.max(...xs),
        state: g.player.state,
      };
    });

    // Still preparing to serve throughout - nothing here ended the routine.
    expect(r.state).toBe('serve_ready');

    // Point 4a: no forward (or backward) movement is possible at all. Not
    // "clamped back afterwards" - never anywhere else, on any frame.
    expect(r.minY).toBeCloseTo(SERVE_BASELINE_Y, 6);
    expect(r.maxY).toBeCloseTo(SERVE_BASELINE_Y, 6);
    expect(r.afterForward.y).toBeCloseTo(SERVE_BASELINE_Y, 6);
    expect(r.afterBackward.y).toBeCloseTo(SERVE_BASELINE_Y, 6);
    expect(r.afterDiagonal.y).toBeCloseTo(SERVE_BASELINE_Y, 6);
    expect(r.afterHugeDt.y).toBeCloseTo(SERVE_BASELINE_Y, 6);

    // ...but sliding sideways along the baseline does work.
    expect(r.afterRight.x).toBeGreaterThan(r.startX);
    expect(r.afterLeft.x).toBeLessThan(r.startX);
    expect(r.afterDiagonal.x).toBeGreaterThan(0);

    // Point 4b: the side lines are a wall. Never crossed, on any frame,
    // however long the input is held or however large the frame.
    expect(r.minX).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
    expect(r.maxX).toBeLessThanOrEqual(COURT_WIDTH - PLAYER_RADIUS + 1e-9);
    expect(r.afterRight.x).toBeCloseTo(COURT_WIDTH - PLAYER_RADIUS, 6);
    expect(r.afterLeft.x).toBeCloseTo(PLAYER_RADIUS, 6);
  });

  test('serve stance via the real joystick: slides sideways, never leaves the baseline or the court', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    const box = await page.locator('#joystick-hitzone').boundingBox();
    if (!box) throw new Error('joystick not found');
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;

    // Hard right AND hard "forward" at once, held well past the point where
    // the player reaches the side line.
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy - 200, { steps: 5 });
    const samples = await page.evaluate(
      () =>
        new Promise<{ x: number; y: number }[]>((resolve) => {
          const s: { x: number; y: number }[] = [];
          const t0 = performance.now();
          const tick = () => {
            const p = (window as any).__game.state.player.pos;
            s.push({ x: p.x, y: p.y });
            if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
            else resolve(s);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.mouse.up();

    expect(samples.length).toBeGreaterThan(30);
    for (const s of samples) {
      expect(s.y).toBeCloseTo(SERVE_BASELINE_Y, 6);
      expect(s.x).toBeGreaterThanOrEqual(PLAYER_RADIUS - 1e-9);
      expect(s.x).toBeLessThanOrEqual(COURT_WIDTH - PLAYER_RADIUS + 1e-9);
    }
    // It did actually slide, and it did stop at the line.
    expect(samples[samples.length - 1].x).toBeCloseTo(COURT_WIDTH - PLAYER_RADIUS, 6);

    // The ball stays in the server's hand throughout.
    const held = await page.evaluate(() => ({
      p: { ...(window as any).__game.state.player.pos },
      b: { ...(window as any).__game.state.ball.pos },
    }));
    expect(held.b).toEqual(held.p);
  });

  test('the AI teammate does not dig its own partner"s serve out of the air', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    // The serve is struck at the baseline and flies the whole length of the
    // court, passing within ~2m of the teammate's back-zone base - inside its
    // reaction radius. It must let it go: it is already on its way over.
    await tap(page, 'serve-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 5000,
    });

    // Watch only up to the moment the serve crosses the net. Anything after
    // that is the rally proper, where a teammate touch is perfectly legal -
    // the regression is specifically a touch on the way over.
    const outcome = await page.evaluate(
      () =>
        new Promise<{ toucherBeforeCrossing: string | null; crossed: boolean }>((resolve) => {
          const g = (window as any).__game.state;
          const t0 = performance.now();
          const tick = () => {
            if (g.ball.lastToucher !== 'player') {
              resolve({ toucherBeforeCrossing: g.ball.lastToucher, crossed: false });
            } else if (g.ball.pos.y < 8) {
              resolve({ toucherBeforeCrossing: g.ball.lastToucher, crossed: true });
            } else if (performance.now() - t0 > 3000) {
              resolve({ toucherBeforeCrossing: g.ball.lastToucher, crossed: false });
            } else requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }),
    );

    expect(outcome.toucherBeforeCrossing).toBe('player');
    expect(outcome.crossed).toBe(true);
  });

  test('a serve can be hit out, and hitting it out loses the point', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await intoServeMode(page);

    const result = await page.evaluate(() => {
      const g = (window as any).__game.state;
      const before = { ...g.score };
      const base = {
        move: { x: 0, y: 0 }, aim: null, swipe: null,
        jump: false, spike: false, pass: false, dive: false, hit: false, serve: false,
      };
      // Full-strength, straight over the net: from the baseline that is
      // SERVE_MAX_RANGE, which deliberately carries past the far baseline.
      const fullAim = { dir: { x: 0, y: -1 }, strength: 1 };

      g.update(0.016, { ...base, serve: true });
      let target: { x: number; y: number } | null = null;
      for (let t = 0; t < 8 && g.phase === 'playing'; t += 0.016) {
        g.update(0.016, { ...base, aim: fullAim });
        if (!target && g.ball.lastToucher === 'player') target = { ...g.ball.target };
      }
      return { before, after: { ...g.score }, target, phase: g.phase };
    });

    expect(result.target).not.toBeNull();
    // Past the opponents' baseline - out, with no correction pulling it back in.
    expect(result.target!.y).toBeLessThan(0);
    // ...and the serving team loses the point for it.
    expect(result.after.opponents).toBe(result.before.opponents + 1);
    expect(result.after.human).toBe(result.before.human);
  });
});
