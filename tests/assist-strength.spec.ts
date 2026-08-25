import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The automatic movement help is a fine correction, not a way to travel. Each
 * action only pulls the player the last short stretch onto a ball they have
 * already run down themselves:
 *
 *   Pass / Notfall-Schlag  ASSIST_RANGE       1.0m  (was 2.2m)
 *   Sprung-Schmetterschlag JUMP_ASSIST_RANGE  0.9m  (was 1.6m)
 *   Hechten                REACH_RANGE        2.0m  (was 3.0m)
 *
 * Measured as: how far does the game move the player, with the joystick
 * completely untouched, when the given action is triggered with the ball a
 * fixed gap away? Beyond each range the answer must be exactly zero - the
 * action simply doesn't engage, and the player has to close the gap manually.
 */

type Action = 'dive' | 'pass' | 'hit' | 'jump';

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

      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, dive: false, hit: false };
      const press = { ...noInput, [action]: true };
      const step = (input: any) => {
        g.state.player.update(0.016, input, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(g.state.player.state === 'slowmo_aim' ? 0.016 * SLOWMO_FACTOR : 0.016);
      };

      step(press);
      // Pass/Notfall are held (they buffer anyway); dive/jump are one-shot.
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

  test('Hechten still covers real ground, but is capped at REACH_RANGE', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A dive is meant to cover ground - that is the whole point of it.
    expect(await autoMovement(page, 'dive', 1.8)).toBeGreaterThan(1);

    // But not from anywhere: past REACH_RANGE it does not engage at all.
    expect(await autoMovement(page, 'dive', 2.2)).toBe(0);
    expect(await autoMovement(page, 'dive', 3.0)).toBe(0);
  });

  test('the assist walks at exactly the player\'s own speed, never faster', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // ASSIST_SPEED_MULTIPLIER is 1.0 now (it was 1.15, i.e. the automatic
    // correction physically out-ran manual control). Measured directly: one
    // frame of held Pass with the ball inside ASSIST_RANGE but outside
    // HIT_RANGE must move the player exactly PLAYER_SPEED * dt.
    const perFrame = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};

      const startY = 12;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = startY;
      g.state.player.state = 'active';
      // 0.9m away: inside ASSIST_RANGE (1.0), outside HIT_RANGE (0.7), so the
      // assist walk runs and no contact fires on this frame.
      g.state.ball.launch(
        { x: 4, y: startY - 0.9 },
        { x: 4.05, y: startY - 0.9 },
        { duration: 8, peakHeight: 0.4, toucher: null },
      );

      g.state.player.update(
        0.016,
        { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: true, dive: false, hit: false },
        g.state.ball,
        g.state.teammate.pos,
        false,
      );
      return startY - g.state.player.pos.y;
    });

    const PLAYER_SPEED = 4.5; // mirror src/game/constants.ts
    expect(perFrame).toBeCloseTo(PLAYER_SPEED * 0.016, 5);
    // Explicitly: not the old 1.15x multiplier.
    expect(perFrame).toBeLessThan(PLAYER_SPEED * 1.15 * 0.016);
  });
});
