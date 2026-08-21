import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos } },
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
      opponents: g.state.opponents.map((o: any) => ({ ...o.pos })),
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

async function tapHit(page: Page) {
  const btn = page.locator('#hit-btn');
  const box = await btn.boundingBox();
  if (!box) throw new Error('hit button not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Step 3: Hit button, weak random shot', () => {
  test('opponents render statically at their home positions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    await page.waitForTimeout(300);
    const after = await getState(page);

    expect(after.opponents).toEqual(before.opponents);
    // Both opponents live in the top (opponent) half of the court.
    for (const pos of after.opponents) {
      expect(pos.y).toBeLessThan(8);
    }
  });

  test('pressing Hit within range sends the ball over the net as a weak shot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    // Place the ball right next to the player, well inside HIT_RANGE.
    const nearby = { x: before.player.pos.x, y: before.player.pos.y - 0.3 };
    await launchBall(page, nearby, { x: before.player.pos.x, y: 2 }, 5);

    await tapHit(page);

    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'player',
      undefined,
      { timeout: 1000 },
    );
    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    // A weak shot always targets the opponent half (y < NET_Y = 8).
    expect(after.ball.target.y).toBeLessThan(8);
  });

  test('pressing Hit out of range does nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    expect(before.ball.state).toBe('idle'); // ball sits at court center, far from the player

    await tapHit(page);
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
    expect(after.ball.state).toBe('idle');
  });
});
