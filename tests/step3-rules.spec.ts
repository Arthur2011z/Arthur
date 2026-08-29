import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

/** Runs a sequence of rule-book calls against a fresh rally and reports the
 * first fault it produced (or null). Everything happens inside the page so the
 * real Rally instance is exercised, not a copy. */
async function ruleSequence(page: Page, steps: string[]) {
  return page.evaluate((steps) => {
    const g = window.__game!;
    const s = g.state;
    s.rally.possession = 'opponents';
    s.rally.touches = 0;
    s.rally.lastToucher = null;

    const byName: Record<string, () => unknown> = {
      player: () => s.rally.registerTouch(s.player),
      teammate: () => s.rally.registerTouch(s.teammate),
      opponent1: () => s.rally.registerTouch(s.opponents[0]),
      opponent2: () => s.rally.registerTouch(s.opponents[1]),
      'block:player': () => s.rally.registerBlock(s.player),
      'cross:human': () => s.rally.registerNetCross('human'),
      'cross:opponents': () => s.rally.registerNetCross('opponents'),
    };

    for (const step of steps) {
      const result = byName[step]();
      if (result) return result as { winner: string; loser: string; reason: string };
    }
    return null;
  }, steps);
}

/** Silences the automatic serve so a test owns what is in the air. */
async function prepare(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.debug.clear();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await prepare(page);
});

test('three touches are allowed and the fourth is a fault', async ({ page }) => {
  expect(await ruleSequence(page, ['player', 'teammate', 'player'])).toBeNull();

  const fault = await ruleSequence(page, ['player', 'teammate', 'player', 'teammate']);
  expect(fault).toMatchObject({ reason: 'four_touches', loser: 'human', winner: 'opponents' });
});

test('the same player may not touch twice in a row', async ({ page }) => {
  const fault = await ruleSequence(page, ['player', 'player']);
  expect(fault).toMatchObject({ reason: 'double_contact', loser: 'human' });
});

test('but the same player may take the first and the third touch', async ({ page }) => {
  expect(await ruleSequence(page, ['player', 'teammate', 'player'])).toBeNull();
  expect(await ruleSequence(page, ['opponent1', 'opponent2', 'opponent1'])).toBeNull();
});

test('crossing the net gives the receiving team a fresh set of three', async ({ page }) => {
  expect(
    await ruleSequence(page, [
      'player',
      'teammate',
      'player',
      'cross:opponents',
      'opponent1',
      'opponent2',
      'opponent1',
    ]),
  ).toBeNull();

  const fault = await ruleSequence(page, [
    'player',
    'teammate',
    'player',
    'cross:opponents',
    'opponent1',
    'opponent2',
    'opponent1',
    'opponent2',
  ]);
  expect(fault).toMatchObject({ reason: 'four_touches', loser: 'opponents' });
});

test('a block costs no touch and lets the blocker play the next ball', async ({ page }) => {
  // Block, then immediately dig the same ball: legal under the indoor rule.
  expect(await ruleSequence(page, ['block:player', 'player'])).toBeNull();
  // And the team still has all three contacts afterwards.
  expect(
    await ruleSequence(page, ['block:player', 'player', 'teammate', 'player']),
  ).toBeNull();
  expect(
    await ruleSequence(page, ['block:player', 'player', 'teammate', 'player', 'teammate']),
  ).toMatchObject({ reason: 'four_touches' });
});

test('a ball landing in bounds gives the point to the other side', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.rally.lastToucher = 'opponent1';
    g.state.launchBall({ x: 4, y: 4, z: 2 }, { x: 4, y: 12 }, 1.8);
  });
  await page.waitForFunction(() => window.__game!.state.phase === 'point_scored', undefined, {
    timeout: 5000,
  });

  const s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    fault: window.__game!.state.lastFault,
    serving: window.__game!.state.servingTeam,
  }));
  expect(s.fault).toBe('grounded');
  expect(s.score.opponents).toBe(1);
  expect(s.score.human).toBe(0);
  // Whoever wins the rally serves next.
  expect(s.serving).toBe('opponents');
});

test('a ball hit out costs the side that hit it', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.rally.lastToucher = 'player';
    // From the human half, well past the far base line.
    g.state.launchBall({ x: 4, y: 12, z: 2 }, { x: 4, y: -2 }, 1.9);
  });
  await page.waitForFunction(() => window.__game!.state.phase === 'point_scored', undefined, {
    timeout: 5000,
  });

  const s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    fault: window.__game!.state.lastFault,
    event: { ...window.__game!.state.lastEvent! },
  }));
  expect(s.fault).toBe('out');
  expect(s.event.inBounds).toBe(false);
  expect(s.score.opponents).toBe(1);
});

test('a ball into the net costs the side that hit it', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.rally.lastToucher = 'player';
    g.state.ball.strike({ x: 4, y: 11, z: 1.1 }, { x: 0, y: -8, z: 0.4 }, 'player');
  });
  await page.waitForFunction(() => window.__game!.state.phase === 'point_scored', undefined, {
    timeout: 5000,
  });

  const s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    fault: window.__game!.state.lastFault,
  }));
  expect(s.fault).toBe('net');
  expect(s.score.opponents).toBe(1);
});

test('21 only wins with two clear points', async ({ page }) => {
  // 20:20 - the next point makes it 21:20, which is not yet a win.
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.score = { human: 20, opponents: 20 };
    g.state.rally.lastToucher = 'opponent1';
    g.state.launchBall({ x: 4, y: 4, z: 2 }, { x: 4, y: -2 }, 1.9);
  });
  await page.waitForFunction(() => window.__game!.state.phase !== 'rally', undefined, {
    timeout: 5000,
  });

  let s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    phase: window.__game!.state.phase,
    winner: window.__game!.state.winner,
  }));
  expect(s.score).toEqual({ human: 21, opponents: 20 });
  expect(s.phase).toBe('point_scored');
  expect(s.winner).toBeNull();

  // 22:20 ends it.
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.phase = 'rally';
    g.state.rally.lastToucher = 'opponent1';
    g.state.launchBall({ x: 4, y: 4, z: 2 }, { x: 4, y: -2 }, 1.9);
  });
  await page.waitForFunction(() => window.__game!.state.phase === 'game_over', undefined, {
    timeout: 5000,
  });

  s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    phase: window.__game!.state.phase,
    winner: window.__game!.state.winner,
  }));
  expect(s.score).toEqual({ human: 22, opponents: 20 });
  expect(s.winner).toBe('human');
  await expect(page.locator('#restart-btn')).toBeVisible();
});

test('restarting clears the score and puts a ball back in play', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = true;
    g.state.score = { human: 21, opponents: 4 };
    g.state.winner = 'human';
    g.state.phase = 'game_over';
  });
  await expect(page.locator('#restart-btn')).toBeVisible();
  await page.locator('#restart-btn').tap();

  await page.waitForFunction(() => window.__game!.state.phase === 'rally');
  const s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    winner: window.__game!.state.winner,
  }));
  expect(s.score).toEqual({ human: 0, opponents: 0 });
  expect(s.winner).toBeNull();
});

test('the human can win a point with a Notfall shot over the net', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 12 };
    g.state.rally.possession = 'human';
    g.state.rally.lastToucher = 'opponent1';
    g.state.launchBall({ x: 4, y: 4, z: 2 }, { x: 4, y: 12 }, 1.8);
  });

  await page.waitForFunction(() => {
    const g = window.__game!;
    const b = g.state.ball.pos;
    const p = g.state.player.pos;
    return g.state.ball.state === 'live' && Math.hypot(b.x - p.x, b.y - p.y) < 1.2;
  });
  // Notfall, not Pass: a pass deliberately stays on the own side of the net.
  await page.keyboard.press('f');

  await page.waitForFunction(() => window.__game!.state.phase === 'point_scored', undefined, {
    timeout: 6000,
  });
  const s = await page.evaluate(() => ({
    score: { ...window.__game!.state.score },
    lastToucher: window.__game!.state.ball.lastToucher,
  }));
  expect(s.lastToucher).toBe('player');
  // The opponents never move yet, so a legal return always lands on them.
  expect(s.score.human).toBe(1);
});
