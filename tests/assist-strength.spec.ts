import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The automatic movement help is a fine correction, not a way to travel. Each
 * action only pulls the player the last short stretch onto a ball they have
 * already run down themselves:
 *
 *   Pass / Notfall-Schlag  ASSIST_RANGE       1.0m  (was 2.2m)
 *   Sprung-Schmetterschlag JUMP_ASSIST_RANGE  0.9m  (was 1.6m)
 *
 * Block is deliberately absent from this list: it moves the player by exactly
 * zero metres under every circumstance, which block.spec.ts asserts directly.
 *
 * Measured as: how far does the game move the player, with the joystick
 * completely untouched, when the given action is triggered with the ball a
 * fixed gap away? Beyond each range the answer must be exactly zero - the
 * action simply doesn't engage, and the player has to close the gap manually.
 */

type Action = 'pass' | 'hit' | 'jump';

/** Returns how many metres the game moved the player on its own (no joystick
 * input at all) for `action`, with a near-stationary ball `gap` metres toward
 * the net. Drives Player/Ball update() in lockstep like GameState does, so
 * it is fully deterministic. */
async function autoMovement(page: Page, action: Action, gap: number): Promise<number> {
  return page.evaluate(
    ({ action, gap }) => {
      const SLOWMO_FACTOR = 0.18; // mirror src/game/constants.ts
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      (window as any).__setRandom(() => 0.99);

      const startY = 12;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = startY;
      g.state.player.state = 'active';
      g.state.ball.launch(
        { x: 4, y: startY - gap },
        { x: 4.05, y: startY - gap },
        { duration: 8, peakHeight: 0.4, toucher: null },
      );

      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      const press = { ...noInput, [action]: true };
      const step = (input: any) => {
        g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      step(press);
      // Pass/Notfall are held (they buffer anyway); jump is one-shot.
      const follow = action === 'pass' || action === 'hit' ? press : noInput;
      for (let i = 0; i < 90; i++) {
        step(follow);
        if (g.state.ball.lastToucher === 'player') break;
      }
      return startY - g.state.player.pos.y;
    },
    { action, gap },
  );
}

test.describe('Automatische Bewegungsunterstützung: a fine correction, not a way to travel', () => {
  test('Pass and Notfall-Schlag assist only inside ASSIST_RANGE, and only by a stride', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    for (const action of ['pass', 'hit'] as const) {
      // Just inside the range: a small, real correction.
      const near = await autoMovement(page, action, 0.9);
      expect(near).toBeGreaterThan(0);
      expect(near).toBeLessThan(0.5);

      // Past the range: the player is entirely on their own.
      expect(await autoMovement(page, action, 1.2)).toBe(0);
      expect(await autoMovement(page, action, 2.0)).toBe(0);
    }
  });

  test('the Jump-Smash drift is the smallest correction of all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const near = await autoMovement(page, 'jump', 0.85);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(0.3);

    expect(await autoMovement(page, 'jump', 1.0)).toBe(0);
    expect(await autoMovement(page, 'jump', 1.5)).toBe(0);
  });

  test('the assist never out-runs manual control - boosted or not', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // ASSIST_SPEED_MULTIPLIER is 1.0 (it was 1.15, i.e. the automatic
    // correction physically out-ran manual control). That invariant is now
    // measured against manual running rather than against a hard-coded number,
    // because the Bewegungs-Boost lifts BOTH by the same factor for its first
    // MOVE_BOOST_DURATION (0.4s) - the press that starts an assist is also the
    // press that arms the boost, so the two can only be compared like for like.
    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };

      /** One frame of movement, with the ball placed `gap` metres toward the
       * net (Infinity = nowhere near, so no assist runs). `warmUp` frames run
       * first, out of assist range, to let the boost expire. */
      const oneFrame = (gap: number, move: { x: number; y: number }, warmUp: number) => {
        const startY = 12;
        g.state.player.pos.x = 4;
        g.state.player.pos.y = startY;
        g.state.player.state = 'active';
        const far = { x: 40, y: 40 };
        g.state.ball.launch(far, { ...far }, { duration: 30, peakHeight: 0.4, toucher: null });

        // Press once, then run the warm-up frames with the ball out of reach.
        g.state.player.update(0.016, { ...noInput, pass: true }, g.state.ball, g.state.teammate.pos, false);
        for (let i = 0; i < warmUp; i++) {
          g.state.player.update(0.016, noInput, g.state.ball, g.state.teammate.pos, false);
        }
        // Now put the ball where this measurement wants it and take one frame.
        g.state.player.pos.y = startY;
        if (Number.isFinite(gap)) {
          g.state.ball.launch(
            { x: 4, y: startY - gap }, { x: 4.05, y: startY - gap },
            { duration: 30, peakHeight: 0.4, toucher: null },
          );
        }
        const before = g.state.player.pos.y;
        g.state.player.update(0.016, { ...noInput, move }, g.state.ball, g.state.teammate.pos, false);
        return { step: before - g.state.player.pos.y, boosting: g.state.player.isBoosting };
      };

      const stick = { x: 0, y: -1 }; // straight toward the net, full deflection
      return {
        // 0.9m: inside ASSIST_RANGE (1.0), outside HIT_RANGE (0.7) - the assist
        // walk runs and no contact fires on this frame.
        assistBoosted: oneFrame(0.9, { x: 0, y: 0 }, 0),
        manualBoosted: oneFrame(Infinity, stick, 0),
        // 30 frames = 0.48s: past MOVE_BOOST_DURATION, still inside
        // INPUT_BUFFER_WINDOW (1.2s), so the Pass is buffered but unboosted.
        assistPlain: oneFrame(0.9, { x: 0, y: 0 }, 30),
        manualPlain: oneFrame(Infinity, stick, 30),
      };
    });

    const PLAYER_SPEED = 4.5; // mirror src/game/constants.ts

    // Sanity: the two pairs really were taken in the states they claim.
    expect(r.assistBoosted.boosting).toBe(true);
    expect(r.manualBoosted.boosting).toBe(true);
    expect(r.assistPlain.boosting).toBe(false);
    expect(r.manualPlain.boosting).toBe(false);

    // The invariant: assisted movement is exactly manual movement, never more.
    expect(r.assistBoosted.step).toBeCloseTo(r.manualBoosted.step, 6);
    expect(r.assistPlain.step).toBeCloseTo(r.manualPlain.step, 6);

    // ...and unboosted that is exactly the player's own running speed - not
    // the old 1.15x multiplier.
    expect(r.assistPlain.step).toBeCloseTo(PLAYER_SPEED * 0.016, 5);
    expect(r.assistPlain.step).toBeLessThan(PLAYER_SPEED * 1.15 * 0.016);
  });
});
