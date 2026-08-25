import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

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

test.describe('Volleyball-Regel: höchstens 3 Kontakte pro Team', () => {
  test('Pass on the mandatory final touch auto-converts to a hit over the net (via a real 2-touch rally)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Simulates "this team already touched it twice" directly on the running
    // GameState, exactly as a real rally (dive-pass to teammate, teammate
    // set to player) would leave it - GameState.mustCrossNet() reads this
    // same field every frame.
    await page.evaluate(() => {
      (window as any).__game.state.rallyTouches = { team: 'human', count: 2 };
    });

    await teleportPlayer(page, { x: 1, y: 15 });
    await launchBall(page, { x: 1, y: 14.7 }, { x: 1, y: 4 }, 5);
    await tapButton(page, 'pass-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const target = await page.evaluate(() => (window as any).__game.state.ball.target);
    expect(target.y).toBeLessThan(8); // crossed the net, not sent to the teammate
  });

  test('Pass still goes to the teammate normally when touches remain', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 1, y: 15 });
    await launchBall(page, { x: 1, y: 14.7 }, { x: 1, y: 4 }, 5);
    await tapButton(page, 'pass-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const state = await page.evaluate(() => {
      const g = (window as any).__game;
      return { target: g.state.ball.target, teammate: g.state.teammate.pos };
    });
    expect(state.target.x).toBeCloseTo(state.teammate.x, 0);
    expect(state.target.y).toBeCloseTo(state.teammate.y, 0);
  });

  test('a Hechten-dive contact on the mandatory final touch also crosses the net instead of passing', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.ball.launch({ x: 4, y: 11.5 }, { x: 4, y: 1 }, { duration: 3, peakHeight: 3, toucher: null });
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, pass: false, dive: false, hit: false };
      // First call consumes the Hechten press and enters 'diving'; the second
      // is where updateDiving's own contact check actually runs and resolves
      // it - exactly like two consecutive real animation frames 16ms apart.
      g.state.player.update(
        0.016,
        { ...noInput, dive: true },
        g.state.ball,
        g.state.teammate.pos,
        true, // mustCrossNet
      );
      g.state.player.update(0.016, noInput, g.state.ball, g.state.teammate.pos, true);
      return { target: { ...g.state.ball.target }, lastToucher: g.state.ball.lastToucher };
    });

    expect(result.lastToucher).toBe('player');
    expect(result.target.y).toBeLessThan(8);
  });

  test("the AI teammate sets over the net instead of to the player on the team's mandatory final touch", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      const teammatePos = { ...g.state.teammate.pos };
      g.state.ball.launch(
        { x: teammatePos.x, y: teammatePos.y - 0.1 },
        { x: teammatePos.x, y: teammatePos.y + 0.1 },
        { duration: 3, peakHeight: 3, toucher: null },
      );
      g.state.teammate.state = 'moving_to_ball';
      g.state.teammate.update(
        0.016,
        g.state.ball,
        { pos: { x: 4, y: 11 }, state: 'active', hasPendingContactInput: false },
        true, // mustCrossNet
      );
      return { target: { ...g.state.ball.target }, lastToucher: g.state.ball.lastToucher };
    });

    expect(result.lastToucher).toBe('teammate');
    expect(result.target.y).toBeLessThan(8); // over the net, not toward the player's own-half position
  });
});
