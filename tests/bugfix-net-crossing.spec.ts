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

/** Samples an entity's pos.y on every real animation frame for durationMs (via
 * requestAnimationFrame inside the page itself, not Playwright polling, so no
 * round-trip lag is added between samples) and returns the min/max observed. */
async function sampleYRange(page: Page, path: 'teammate' | 'opponent0', durationMs: number) {
  return page.evaluate(
    ({ path, durationMs }) => {
      const g = (window as any).__game;
      const getPos = () => (path === 'teammate' ? g.state.teammate.pos : g.state.opponents[0].pos);
      return new Promise<{ min: number; max: number }>((resolve) => {
        const deadline = performance.now() + durationMs;
        let min = getPos().y;
        let max = getPos().y;
        const tick = () => {
          const y = getPos().y;
          if (y < min) min = y;
          if (y > max) max = y;
          if (performance.now() < deadline) {
            requestAnimationFrame(tick);
          } else {
            resolve({ min, max });
          }
        };
        requestAnimationFrame(tick);
      });
    },
    { path, durationMs },
  );
}

test.describe('Bugfix 2: players never cross the net line', () => {
  test('teammate does not chase a ball across the net into the opponent half', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const home = await page.evaluate(() => (window as any).__game.state.teammate.homePos);
    const netY = 8; // NET_Y constant
    const radius = await page.evaluate(() => (window as any).__game.state.teammate.radius);

    // Starts right next to the teammate (guarantees an immediate reaction) and
    // flies deep behind the opponents' baseline. The ball is always faster
    // (4.667 m/s) than the teammate (4.2 m/s), so it can never be caught -
    // the teammate is pulled straight toward the net and, if unclamped,
    // straight through it for the whole sampled window.
    await launchBall(page, { x: home.x, y: home.y - 1 }, { x: home.x, y: -4 }, 3, 3);

    const { min } = await sampleYRange(page, 'teammate', 1500);

    // Never allowed onto the opponent half (y <= netY), own-half bound is
    // netY + radius, same clamp Player already had. Small epsilon only for
    // floating-point/frame-step slack, not to paper over a real crossing.
    expect(min).toBeGreaterThanOrEqual(netY + radius - 0.02);
  });

  test('opponent does not chase a ball across the net into the human half', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const home = await page.evaluate(() => (window as any).__game.state.opponents[0].pos);
    const netY = 8; // NET_Y constant
    const radius = await page.evaluate(() => (window as any).__game.state.opponents[0].radius);

    // Starts deep in the human half (y=14) and flies down to the opponents'
    // own half (target.y=1, satisfying the "ball is coming to my side" gate
    // opponents use to react at all), staying above the net for the whole
    // sampled window - so the opponent is pulled straight toward, and if
    // unclamped straight across, the net the entire time.
    await launchBall(page, { x: home.x, y: 14 }, { x: home.x, y: 1 }, 3, 3);

    const { max } = await sampleYRange(page, 'opponent0', 1300);

    expect(max).toBeLessThanOrEqual(netY - radius + 0.02);
  });
});
