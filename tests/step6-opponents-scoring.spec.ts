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

/** Forces the RNG used by the opponent's error/attack roll (see utils/random.ts). */
async function forceRandom(page: Page, value: number) {
  await page.evaluate((value) => (window as any).__setRandom(() => value), value);
}

test.describe('Step 6: opponent AI + scoring', () => {
  test('the opponent whose zone the ball lands in returns it; the other stays home', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    // This test is about which opponent reacts, not the error/attack roll -
    // force the safe default branch so it's not flaky.
    await forceRandom(page, 0.99);

    // Lands deep - the back defender's zone (opponents[1]).
    await launchBall(page, { x: 2.5, y: 8 }, { x: 2.5, y: 1.5 }, 2);

    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'opponent2',
      undefined,
      { timeout: 3000 },
    );
    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    expect(after.ball.target.y).toBeGreaterThan(8); // returned into the human half
    // The net defender never had to react.
    expect(after.opponents[0].state).toBe('home');
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
    // Far baseline corner: the back defender's zone, but ~4.9m from its base
    // and this flight is over in 0.5s, so it cannot get there in time.
    await launchBall(page, { x: 4, y: 8 }, { x: 0.5, y: 0.5 }, 0.5);

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
    // Far baseline corner - unreachable in the 0.5s flight, see the test
    // above.
    await launchBall(page, { x: 4, y: 8 }, { x: 0.5, y: 0.5 }, 0.5);
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

  test('a forced error roll nets the ball out on the opponent\'s own side, scoring for the human team', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await forceRandom(page, 0); // below OPPONENT_ERROR_CHANCE - always the error branch

    // Aimed into the net zone, so the net defender (opponents[0]) is the one
    // responsible for it.
    await launchBall(page, { x: 2.5, y: 8 }, { x: 2.5, y: 6 }, 2);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent1', undefined, {
      timeout: 3000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeLessThan(8); // dropped back on the opponent's own side
    expect(after.ball.target.y).toBeGreaterThan(0);
  });

  test('a forced attack roll is noticeably faster than the safe default return', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    // Above the error chance, below error+attack - always the attack branch.
    await forceRandom(page, 0.2);

    // Aimed into the net zone, so the net defender (opponents[0]) is the one
    // responsible for it.
    await launchBall(page, { x: 2.5, y: 8 }, { x: 2.5, y: 6 }, 2);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent1', undefined, {
      timeout: 3000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeGreaterThan(8); // still a legal return into the human half
    // OPPONENT_ATTACK_DURATION (0.6s) is clearly under OPPONENT_RETURN_DURATION
    // (1.1s) - sampled right at the moment of contact, so this is close to the
    // full duration either way.
    const timeRemaining: number = await page.evaluate(() => (window as any).__game.state.ball.timeRemaining);
    expect(timeRemaining).toBeLessThan(0.9);
  });

  test('the safe default return (no forced error/attack) is the slower of the two', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await forceRandom(page, 0.99); // above error+attack - always the safe default branch

    // Aimed into the net zone, so the net defender (opponents[0]) is the one
    // responsible for it.
    await launchBall(page, { x: 2.5, y: 8 }, { x: 2.5, y: 6 }, 2);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent1', undefined, {
      timeout: 3000,
    });

    const after = await getState(page);
    expect(after.ball.target.y).toBeGreaterThan(8);
    const timeRemaining: number = await page.evaluate(() => (window as any).__game.state.ball.timeRemaining);
    expect(timeRemaining).toBeGreaterThan(0.9); // OPPONENT_RETURN_DURATION (1.1s)
  });
});
