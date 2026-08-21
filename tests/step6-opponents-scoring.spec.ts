import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      score: { ...g.state.score },
      phase: g.state.phase,
      winner: g.state.winner,
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
      opponents: g.state.opponents.map((o: any) => ({ pos: { ...o.pos }, state: o.state })),
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

async function setScore(page: Page, human: number, opponents: number) {
  await page.evaluate(
    ({ human, opponents }) => {
      const s = (window as any).__game.state.score;
      s.human = human;
      s.opponents = opponents;
    },
    { human, opponents },
  );
}

test.describe('Step 6: opponent AI + scoring', () => {
  test('the closer opponent returns an incoming ball; the other stays home', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Aimed near opponent1's home (2.5, 3) - well past opponent2's (5.5, 3).
    await launchBall(page, { x: 2.5, y: 8 }, { x: 2.5, y: 3 }, 2);

    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'opponent1',
      undefined,
      { timeout: 3000 },
    );
    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    expect(after.ball.target.y).toBeGreaterThan(8); // returned into the human half
    // opponent2 never had to react.
    expect(after.opponents[1].state).toBe('home');
  });

  test('a ball landing untouched in the human half scores a point for the opponents', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    expect(before.score).toEqual({ human: 0, opponents: 0 });

    // Straight down the far sideline, well clear of the teammate's home
    // (5.6, 11) and the player never acts without input - nobody touches this.
    await launchBall(page, { x: 1, y: 9 }, { x: 1, y: 15 }, 0.5);

    await page.waitForFunction(() => (window as any).__game.state.phase === 'point_scored', undefined, {
      timeout: 2000,
    });
    const afterLanding = await getState(page);
    expect(afterLanding.score).toEqual({ human: 0, opponents: 1 });

    // After the pause, play resumes with a fresh serve.
    await page.waitForFunction(() => (window as any).__game.state.phase === 'playing', undefined, {
      timeout: 2500,
    });
  });

  test('reaching 21 with a 2-point lead ends the game and shows the winner', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setScore(page, 20, 0);
    // Lands untouched in the opponent half -> point for the human team -> 21:0.
    // Straight down the centerline (x=4), at least 1.5m from either
    // opponent's home the whole flight - geometrically out of HIT_RANGE, so
    // neither opponent can possibly reach it in time.
    await launchBall(page, { x: 4, y: 8 }, { x: 4, y: 0.3 }, 0.5);

    await page.waitForFunction(() => (window as any).__game.state.phase === 'game_over', undefined, {
      timeout: 2000,
    });
    const after = await getState(page);
    expect(after.score).toEqual({ human: 21, opponents: 0 });
    expect(after.winner).toBe('human');

    await expect(page.locator('#game-over-overlay')).toBeVisible();
    await expect(page.locator('#restart-btn')).toBeVisible();
  });

  test('Restart resets the score and resumes play', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await setScore(page, 20, 19);
    // Straight down the centerline (x=4): at least 1.5m from either
    // opponent's home (2.5,3) / (5.5,3) at every point - geometrically out of
    // HIT_RANGE the whole flight, so neither can possibly reach it in time.
    await launchBall(page, { x: 4, y: 8 }, { x: 4, y: 0.3 }, 0.5);
    await page.waitForFunction(() => (window as any).__game.state.phase === 'game_over', undefined, {
      timeout: 2000,
    });

    const btn = page.locator('#restart-btn');
    const box = await btn.boundingBox();
    if (!box) throw new Error('restart button not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(() => (window as any).__game.state.phase === 'playing', undefined, {
      timeout: 1000,
    });
    const after = await getState(page);
    expect(after.score).toEqual({ human: 0, opponents: 0 });
    expect(after.winner).toBeNull();
    await expect(page.locator('#game-over-overlay')).toBeHidden();
  });
});
