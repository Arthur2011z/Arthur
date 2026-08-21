import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos } },
      teammate: { pos: { ...g.state.teammate.pos }, home: { ...g.state.teammate.homePos }, state: g.state.teammate.state },
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
    };
  });
}

async function launchBall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
  await page.evaluate(
    ({ from, to, duration }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight: 3, toucher: null });
    },
    { from, to, duration },
  );
}

test.describe('Step 5: AI teammate home/base logic', () => {
  test('stays home while the ball is far away and unrelated', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    // Well outside TEAMMATE_REACT_RADIUS (2.5m) of the teammate's home the whole flight.
    await launchBall(page, { x: 1, y: 15 }, { x: 1.5, y: 14 }, 1);
    await page.waitForTimeout(1200);

    const after = await getState(page);
    expect(after.teammate.state).toBe('home');
    expect(after.teammate.pos).toEqual(before.teammate.home);
  });

  test('intercepts a slow ball passing near home and sets it up high to the player', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    const home = before.teammate.home;
    // A slow, straight flight passing directly through the teammate's home
    // position at its midpoint - reached with plenty of time still remaining,
    // so this should NOT trigger the emergency-save branch.
    await launchBall(page, { x: home.x, y: home.y - 6 }, { x: home.x, y: home.y + 6 }, 3);

    await page.waitForFunction(() => (window as any).__game.state.teammate.state === 'moving_to_ball', undefined, {
      timeout: 3000,
    });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 3000,
    });

    const afterContact = await getState(page);
    expect(afterContact.ball.state).toBe('flying');
    // Sets toward the human player, not a low emergency save over the net.
    expect(afterContact.ball.target.x).toBeCloseTo(before.player.pos.x, 0);
    expect(afterContact.ball.target.y).toBeCloseTo(before.player.pos.y, 0);
  });

  test('self-sets an emergency save when the ball arrives too fast/direct', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    const home = before.teammate.home;
    // Fired directly at the teammate's exact position, fast - contact happens
    // with very little flight time left.
    await launchBall(page, { x: home.x, y: home.y - 3 }, { x: home.x, y: home.y }, 0.6);

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 2000,
    });

    const afterContact = await getState(page);
    expect(afterContact.ball.state).toBe('flying');
    // Emergency save always goes over the net into the opponent half.
    expect(afterContact.ball.target.y).toBeLessThan(8);

    // And afterwards, heads back home.
    await page.waitForFunction(() => (window as any).__game.state.teammate.state === 'home', undefined, {
      timeout: 3000,
    });
    const afterReturn = await getState(page);
    expect(afterReturn.teammate.pos).toEqual(home);
  });
});
