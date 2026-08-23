import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state },
      ball: {
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
    };
  });
}

async function launchBall(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  duration: number,
  peakHeight = 3,
) {
  await page.evaluate(
    ({ from, to, duration, peakHeight }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight, toucher: null });
    },
    { from, to, duration, peakHeight },
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

test.describe('Notfall-Schlag: small, no-jump, always-safe fallback', () => {
  test('sends the ball back over the net without jumping, from ordinary ground play', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 1, y: 15 });
    await launchBall(page, { x: 1, y: 14.7 }, { x: 1, y: 4 }, 5);

    await tapButton(page, 'hit-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const after = await getState(page);
    expect(after.player.state).toBe('active'); // no jump involved
    expect(after.ball.target.y).toBeLessThan(8); // over the net
  });

  test('pressing it out of range does nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await tapButton(page, 'hit-btn');
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
  });

  test('may be pressed before the ball arrives - resolves the instant it comes into range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 1, y: 15 });
    // Low peakHeight (1m, vs. the helper's 3m default) so the ball is
    // actually near ground level - within CATCHABLE_HEIGHT - at the moment
    // it passes through the player, instead of sailing overhead at ~2.7m
    // right as it crosses their position.
    await launchBall(page, { x: 1, y: 21 }, { x: 1, y: 4 }, 4, 1);

    await tapButton(page, 'hit-btn');
    const rightAfterPress = await getState(page);
    expect(rightAfterPress.ball.lastToucher).toBeNull();

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 3000,
    });
  });

  test('a light assist walk pulls the player toward a ball inside ASSIST_RANGE while Notfall-Schlag is held', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight stays entirely "above" the player (both endpoints closer
    // to the net) - its nearest point is the flight's own end (4, 9.8), 1.7m
    // from the player: inside ASSIST_RANGE (2.2m) but outside HIT_RANGE
    // (0.7m), so the assist walk (not the joystick) should visibly close
    // the gap, straight toward the net.
    await teleportPlayer(page, { x: 4, y: 11.5 });
    await launchBall(page, { x: 4, y: 9 }, { x: 4, y: 9.8 }, 3);

    await tapButton(page, 'hit-btn');
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.player.pos.y).toBeLessThan(11.5); // moved toward the ball on its own
  });
});
