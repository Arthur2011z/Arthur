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

  test('the assist never out-runs manual control', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // ASSIST_SPEED_MULTIPLIER is 1.0 (it was 1.15, i.e. the automatic
    // correction physically out-ran manual control). Measured against manual
    // running rather than a hard-coded number, because the same press that
    // starts an assist also arms the Bewegungs-Boost, and the boost lifts both
    // by the same factor.
    //
    // There is no longer an "assisted but unboosted" state to measure at all:
    // INPUT_BUFFER_WINDOW (0.18s) is now shorter than MOVE_BOOST_DURATION
    // (0.4s), so a buffered press has always expired before its boost has. The
    // like-for-like comparison below is therefore the whole invariant.
    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };

      /** One frame of movement from a standing start, with the ball either
       * inside ASSIST_RANGE (so the assist walks) or nowhere near (so only the
       * joystick moves the player). */
      const oneFrame = (gap: number, move: { x: number; y: number }) => {
        const startY = 12;
        g.state.player.pos.x = 4;
        g.state.player.pos.y = startY;
        g.state.player.state = 'active';
        g.state.player.height = 0;
        g.state.ball.height = 0;
        const at = Number.isFinite(gap) ? { x: 4, y: startY - gap } : { x: 40, y: 40 };
        g.state.ball.launch(at, { ...at }, { duration: 30, peakHeight: 0.05, toucher: 'opponent1' });
        g.state.player.update(0.016, { ...noInput, move, pass: true }, g.state.ball, g.state.teammate.pos, false);
        return { step: startY - g.state.player.pos.y, boosting: g.state.player.isBoosting };
      };

      return {
        // 0.9m: inside ASSIST_RANGE (1.0), outside TOUCH_DISTANCE (0.5), so
        // the assist walk runs and no contact fires on this frame.
        assisted: oneFrame(0.9, { x: 0, y: 0 }),
        // Same frame, same boost state, but moved by the stick alone.
        manual: oneFrame(Infinity, { x: 0, y: -1 }),
      };
    });

    expect(r.assisted.boosting).toBe(true);
    expect(r.manual.boosting).toBe(true);
    // The invariant: assisted movement is exactly manual movement, never more.
    expect(r.assisted.step).toBeGreaterThan(0);
    expect(r.assisted.step).toBeCloseTo(r.manual.step, 6);
  });
});
