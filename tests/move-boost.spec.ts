import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Der Bewegungs-Boost: a short burst of extra pace armed by pressing Pass or
 * Notfall-Schlag. It replaces the removed dive as the help for balls sitting
 * just outside comfortable reach.
 *
 * 1. Fires on EVERY press of either action, with no condition attached - not
 *    on whether the ball is reachable, not on whether one is even in flight.
 * 2. A fixed MOVE_BOOST_DURATION (0.4s) at MOVE_BOOST_MULTIPLIER (1.5x)
 *    PLAYER_SPEED, then straight back to normal - whatever happened in between.
 * 3. Speed only: the contact rule (ball genuinely within HIT_RANGE and below
 *    CATCHABLE_HEIGHT) is untouched, so a boost never buys a hit.
 * 4. No new steering: it multiplies the movement the game would have produced
 *    anyway - the joystick's own direction, or the existing ASSIST_RANGE
 *    correction. It introduces no homing and extends no range.
 */

const PLAYER_SPEED = 4.5;
const MOVE_BOOST_DURATION = 0.4;
const MOVE_BOOST_MULTIPLIER = 1.5;
const DT = 0.016;

const NO_INPUT = {
  move: { x: 0, y: 0 }, aim: null, swipe: null,
  jump: false, spike: false, pass: false, block: false, hit: false, serve: false,
};

/** Sets up a clean, AI-free field with the player at (4, 12). */
async function isolate(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game.state;
    g.teammate.update = () => {};
    for (const o of g.opponents) o.update = () => {};
    g.awaitingServe = null;
    g.player.state = 'active';
    g.player.height = 0;
    g.player.pos.x = 4;
    g.player.pos.y = 12;
  });
}

test.describe('Bewegungs-Boost bei Pass / Notfall-Schlag', () => {
  // ---------------------------------------------------------------- point 2
  test('a press gives exactly 0.4s at 1.5x, then drops straight back to normal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const r = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;

      const run = (action: 'pass' | 'hit') => {
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.player.height = 0;
        // No ball at all: isolates pure joystick movement from any assist, and
        // proves the boost does not need a ball to exist.
        g.ball.state = 'idle';
        g.ball.pos = { x: 40, y: 40 };

        const held = { ...NO_INPUT, move: { x: 0, y: -1 } }; // walk toward the net
        const speeds: number[] = [];
        let boostFrames = 0;
        for (let i = 0; i < 45; i++) {
          // Re-centre before every frame so the court boundary can never clip a
          // step short: this measures per-frame SPEED, and a clamped frame
          // would look like a third speed that the boost never actually
          // produced.
          g.player.pos.x = 4;
          g.player.pos.y = 12;
          g.player.update(DT, { ...held, [action]: i === 0 }, g.ball, g.teammate.pos, false);
          speeds.push((12 - g.player.pos.y) / DT);
          if (g.player.isBoosting) boostFrames++;
        }
        return { boostSeconds: boostFrames * DT, speeds };
      };

      return { pass: run('pass'), hit: run('hit') };
    }, { NO_INPUT, DT });

    for (const [label, run] of Object.entries(r)) {
      // The window is fixed, and inside the 0.3-0.5s the spec asks for.
      expect(run.boostSeconds, label).toBeCloseTo(MOVE_BOOST_DURATION, 5);
      expect(run.boostSeconds, label).toBeGreaterThanOrEqual(0.3);
      expect(run.boostSeconds, label).toBeLessThanOrEqual(0.5);

      // Exactly two speeds ever occur - boosted and normal. No ramp, no decay,
      // no third value: it switches off cleanly rather than fading out.
      const distinct = [...new Set(run.speeds.map((s) => Number(s.toFixed(6))))].sort((a, b) => b - a);
      expect(distinct, label).toHaveLength(2);
      expect(distinct[0], label).toBeCloseTo(PLAYER_SPEED * MOVE_BOOST_MULTIPLIER, 5);
      expect(distinct[1], label).toBeCloseTo(PLAYER_SPEED, 5);

      // ...and the fast frames all come first, in one unbroken block.
      const lastFast = run.speeds.map((s) => s > PLAYER_SPEED * 1.01).lastIndexOf(true);
      const firstSlow = run.speeds.map((s) => s > PLAYER_SPEED * 1.01).indexOf(false);
      expect(lastFast, label).toBeLessThan(firstSlow);
    }
  });

  test('the boost is a moderate 50% - not a sprint', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const r = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      const walk = (withPress: boolean) => {
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.ball.state = 'idle';
        g.ball.pos = { x: 40, y: 40 };
        const start = g.player.pos.y;
        for (let i = 0; i < 25; i++) { // 0.4s - exactly the boost window
          g.player.update(DT, { ...NO_INPUT, move: { x: 0, y: 1 }, pass: withPress && i === 0 },
            g.ball, g.teammate.pos, false);
        }
        return g.player.pos.y - start;
      };
      return { normal: walk(false), boosted: walk(true) };
    }, { NO_INPUT, DT });

    expect(r.boosted / r.normal).toBeCloseTo(MOVE_BOOST_MULTIPLIER, 5);
    // The spec's band: noticeably faster, but no extreme sprint.
    expect(r.boosted / r.normal).toBeGreaterThanOrEqual(1.4);
    expect(r.boosted / r.normal).toBeLessThanOrEqual(1.6);
    // In practice that buys about 0.9m of extra ground in the window - real
    // help for a ball just out of reach, not a teleport across the court.
    expect(r.boosted - r.normal).toBeCloseTo(0.9, 2);
  });

  test('a second press restarts the window rather than stacking on it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const boostSeconds = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      g.ball.state = 'idle';
      g.ball.pos = { x: 40, y: 40 };
      let frames = 0;
      for (let i = 0; i < 80; i++) {
        // Press at frame 0 and again at frame 12 (0.192s in, mid-boost).
        g.player.update(DT, { ...NO_INPUT, move: { x: 0, y: 1 }, pass: i === 0 || i === 12 },
          g.ball, g.teammate.pos, false);
        if (g.player.isBoosting) frames++;
      }
      return frames * DT;
    }, { NO_INPUT, DT });

    // Restarted: 0.192s elapsed + a fresh full 0.4s window.
    expect(boostSeconds).toBeCloseTo(12 * DT + MOVE_BOOST_DURATION, 5);
    expect(boostSeconds).not.toBeCloseTo(2 * MOVE_BOOST_DURATION, 2); // not stacked
  });

  // ---------------------------------------------------------------- point 1
  test('it fires unconditionally - reachable ball, no ball, wrong-way ball, all the same', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const results = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      const scenario = (label: string, action: 'pass' | 'hit', setup: () => void) => {
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.player.height = 0;
        setup();
        g.player.update(DT, { ...NO_INPUT, [action]: true }, g.ball, g.teammate.pos, false);
        return { label, action, boosting: g.player.isBoosting };
      };

      const out: any[] = [];
      for (const action of ['pass', 'hit'] as const) {
        // The case the spec calls out explicitly: the ball is trivially
        // reachable, so any "would they miss otherwise?" precheck would
        // suppress the boost. It must fire anyway.
        out.push(scenario('ball right on the player', action, () => {
          g.ball.launch({ x: 4, y: 12 }, { x: 4.02, y: 12.02 },
            { duration: 4, peakHeight: 0.2, toucher: 'opponent1' });
        }));
        out.push(scenario('no ball in flight at all', action, () => {
          g.ball.state = 'idle';
          g.ball.pos = { x: 40, y: 40 };
        }));
        out.push(scenario('ball on the far side of the court', action, () => {
          g.ball.launch({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.6 },
            { duration: 4, peakHeight: 1, toucher: 'opponent1' });
        }));
        out.push(scenario('ball moving away from the player', action, () => {
          g.ball.launch({ x: 4, y: 14 }, { x: 4, y: 15.5 },
            { duration: 2, peakHeight: 1, toucher: 'opponent1' });
        }));
      }
      return out;
    }, { NO_INPUT, DT });

    expect(results).toHaveLength(8);
    for (const r of results) {
      expect(r.boosting, `${r.action}: ${r.label}`).toBe(true);
    }
  });

  // ---------------------------------------------------------------- point 3
  test('speed only: the boost never buys a contact the player did not reach', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const rows = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      // A stationary ball `gap` metres toward the net, with the joystick
      // untouched. Whatever the boost multiplies, it multiplies the movement
      // the game produces on its own - which past ASSIST_RANGE is zero.
      const atGap = (gap: number) => {
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.player.height = 0;
        g.ball.launch({ x: 4, y: 12 - gap }, { x: 4.02, y: 12 - gap },
          { duration: 8, peakHeight: 0.3, toucher: 'opponent1' });
        const start = { ...g.player.pos };
        let minDist = Infinity;
        for (let i = 0; i < 80; i++) {
          g.player.update(DT, { ...NO_INPUT, pass: i === 0 }, g.ball, g.teammate.pos, false);
          g.ball.update(DT);
          minDist = Math.min(minDist, Math.hypot(g.ball.pos.x - g.player.pos.x, g.ball.pos.y - g.player.pos.y));
        }
        return {
          gap,
          moved: Math.hypot(g.player.pos.x - start.x, g.player.pos.y - start.y),
          minDist,
          toucher: g.ball.lastToucher,
        };
      };
      return [atGap(0.9), atGap(1.2), atGap(2.0), atGap(3.0)];
    }, { NO_INPUT, DT });

    const [inRange, ...outOfRange] = rows;
    // Inside ASSIST_RANGE the existing correction closes the last stride and
    // contact fires - but only once the ball is genuinely within HIT_RANGE.
    expect(inRange.toucher).toBe('player');
    expect(inRange.minDist).toBeLessThanOrEqual(0.71); // HIT_RANGE 0.7, +1 frame of ball drift

    // Past it, the boost changes nothing at all: no movement, no contact. It
    // multiplied zero, which is the whole guarantee.
    for (const row of outOfRange) {
      expect(row.moved, `gap ${row.gap}`).toBe(0);
      expect(row.toucher, `gap ${row.gap}`).toBe('opponent1');
      expect(row.minDist, `gap ${row.gap}`).toBeCloseTo(row.gap, 2);
    }
  });

  // ---------------------------------------------------------------- point 4
  test('no hidden homing: it only scales the direction the player already had', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const r = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      // Joystick pushed straight LEFT while the ball sits straight AHEAD, well
      // outside ASSIST_RANGE. Any steering the boost introduced would pull the
      // player toward the ball; there must be none at all.
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 12;
      g.ball.launch({ x: 4, y: 9.5 }, { x: 4.02, y: 9.5 },
        { duration: 8, peakHeight: 0.3, toucher: 'opponent1' });
      const start = { ...g.player.pos };
      for (let i = 0; i < 25; i++) {
        g.player.update(DT, { ...NO_INPUT, move: { x: -1, y: 0 }, pass: i === 0 },
          g.ball, g.teammate.pos, false);
        g.ball.update(DT);
      }
      return {
        dx: g.player.pos.x - start.x,
        dy: g.player.pos.y - start.y,
        toucher: g.ball.lastToucher,
      };
    }, { NO_INPUT, DT });

    // Not one millimetre toward the ball...
    expect(r.dy).toBe(0);
    expect(r.toucher).toBe('opponent1');
    // ...and the whole 0.4s window went into the direction the stick asked for,
    // at the boosted speed.
    expect(Math.abs(r.dx)).toBeCloseTo(PLAYER_SPEED * MOVE_BOOST_MULTIPLIER * MOVE_BOOST_DURATION, 5);
  });

  test('the assist keeps its own range - the boost widens nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await isolate(page);

    const engaged = await page.evaluate(({ NO_INPUT, DT }) => {
      const g = (window as any).__game.state;
      // Sweep the gap across the ASSIST_RANGE boundary (1.0m) and record where
      // the assist actually engages, with the boost armed throughout.
      const out: { gap: number; moved: number }[] = [];
      for (const gap of [0.75, 0.9, 0.99, 1.01, 1.1, 1.5]) {
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.ball.launch({ x: 4, y: 12 - gap }, { x: 4.02, y: 12 - gap },
          { duration: 30, peakHeight: 0.3, toucher: 'opponent1' });
        const start = g.player.pos.y;
        g.player.update(DT, { ...NO_INPUT, pass: true }, g.ball, g.teammate.pos, false);
        out.push({ gap, moved: start - g.player.pos.y });
      }
      return out;
    }, { NO_INPUT, DT });

    for (const row of engaged) {
      if (row.gap <= 1.0) {
        // Inside the range: assisted, at the boosted speed.
        expect(row.moved, `gap ${row.gap}`).toBeCloseTo(PLAYER_SPEED * MOVE_BOOST_MULTIPLIER * DT, 6);
      } else {
        // Outside it: nothing, exactly as before the boost existed.
        expect(row.moved, `gap ${row.gap}`).toBe(0);
      }
    }
  });

  // ------------------------------------------------------------- integration
  test('it works through the real buttons and the real keys', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const armed = async (fire: () => Promise<void>) => {
      // Wait out any window still running from the previous check - otherwise
      // a negative case would see the boost the case before it armed.
      await page.waitForFunction(() => !(window as any).__game.state.player.isBoosting, undefined, {
        timeout: 2000,
      });
      await page.evaluate(() => {
        const g = (window as any).__game.state;
        g.awaitingServe = null;
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
      });
      // Watch from inside the page: the window is 0.4s, too short to catch
      // reliably by polling across a round trip.
      const watch = page.evaluate(
        () =>
          new Promise<boolean>((resolve) => {
            const g = (window as any).__game.state;
            const t0 = performance.now();
            const tick = () => {
              if (g.player.isBoosting) resolve(true);
              else if (performance.now() - t0 > 1500) resolve(false);
              else requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
          }),
      );
      await fire();
      return watch;
    };

    const tap = (id: string) => async () => {
      const box = await page.locator(`#${id}`).boundingBox();
      if (!box) throw new Error(`${id} not found`);
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    };

    expect(await armed(tap('pass-btn'))).toBe(true);
    expect(await armed(tap('hit-btn'))).toBe(true);
    expect(await armed(() => page.keyboard.press('KeyE'))).toBe(true);
    expect(await armed(() => page.keyboard.press('KeyF'))).toBe(true);

    // ...and nothing else arms it: the other three actions leave it alone.
    expect(await armed(tap('jump-btn'))).toBe(false);
    expect(await armed(tap('block-btn'))).toBe(false);
    expect(await armed(() => page.keyboard.press('KeyQ'))).toBe(false);
    expect(await armed(() => page.keyboard.press('Space'))).toBe(false);
  });
});
