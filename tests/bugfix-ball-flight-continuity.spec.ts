import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function launchBall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, duration: number, peakHeight: number) {
  await page.evaluate(
    ({ from, to, duration, peakHeight }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight, toucher: null });
    },
    { from, to, duration, peakHeight },
  );
}

/** Watches ball.lastToucher inside the page itself (via requestAnimationFrame,
 * not Playwright polling) so the "before" and "after" snapshots are captured
 * on consecutive real frames with no round-trip lag between them - essential
 * for a precise no-jump assertion. */
async function captureContactTransition(page: Page, expectedToucher: string, timeoutMs = 4000) {
  return page.evaluate(
    ({ expectedToucher, timeoutMs }) => {
      const g = (window as any).__game;
      return new Promise((resolve, reject) => {
        const deadline = performance.now() + timeoutMs;
        let prev = {
          pos: { ...g.state.ball.pos },
          height: g.state.ball.height,
          toucher: g.state.ball.lastToucher,
        };
        const check = () => {
          const cur = {
            pos: { ...g.state.ball.pos },
            height: g.state.ball.height,
            toucher: g.state.ball.lastToucher,
          };
          if (cur.toucher !== prev.toucher && cur.toucher === expectedToucher) {
            resolve({ before: prev, after: cur });
            return;
          }
          if (performance.now() > deadline) {
            reject(new Error(`timed out waiting for lastToucher to become ${expectedToucher}`));
            return;
          }
          prev = cur;
          requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      });
    },
    { expectedToucher, timeoutMs },
  );
}

test.describe('Bugfix 1: ball flight stays continuous through a mid-air catch', () => {
  test('teammate catch: no position or height jump at the moment of contact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const home = await page.evaluate(() => (window as any).__game.state.teammate.homePos);
    // Straight line through the teammate's home at its midpoint - contact
    // happens mid-arc, while the ball is still well off the ground, exactly
    // the scenario where the old code snapped both position and height.
    await launchBall(page, { x: home.x, y: home.y - 6 }, { x: home.x, y: home.y + 6 }, 3, 3);

    const result: any = await captureContactTransition(page, 'teammate');

    // Sanity check: this really was a mid-air catch, not a near-ground one.
    expect(result.before.height).toBeGreaterThan(1);

    const posJump = Math.hypot(result.after.pos.x - result.before.pos.x, result.after.pos.y - result.before.pos.y);
    expect(posJump).toBeLessThan(0.3); // at most a fraction of one frame's travel

    const heightJump = Math.abs(result.after.height - result.before.height);
    expect(heightJump).toBeLessThan(0.3);
  });

  test('opponent catch: no position or height jump at the moment of contact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const home = await page.evaluate(() => (window as any).__game.state.opponents[0].pos);
    // Stays fully in-bounds (opponent half is y in [0, 8]) so this test is
    // independent of the separate net-crossing clamp fix.
    await launchBall(page, { x: home.x, y: home.y - 2.5 }, { x: home.x, y: home.y + 2.5 }, 2, 3);

    const result: any = await captureContactTransition(page, 'opponent1');

    expect(result.before.height).toBeGreaterThan(1);

    const posJump = Math.hypot(result.after.pos.x - result.before.pos.x, result.after.pos.y - result.before.pos.y);
    expect(posJump).toBeLessThan(0.3);

    const heightJump = Math.abs(result.after.height - result.before.height);
    expect(heightJump).toBeLessThan(0.3);
  });
});
