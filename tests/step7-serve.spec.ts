import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;
const COURT_LENGTH = 16;
const PLAYER_RADIUS = 0.35;

/** Opens a rally with the human player holding serve. */
async function humanServe(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.score = { human: 0, opponents: 0 };
    g.state.servingTeam = 'human';
    g.state.serverIndex = { human: 0, opponents: 0 };
    g.state.winner = null;
    g.state.lastEvent = null;
    g.state.beginRally();
    g.debug.clear();
  });
  await page.waitForFunction(() => window.__game!.state.awaitingServe);
}

const serveState = (page: Page) =>
  page.evaluate(() => {
    const g = window.__game!;
    return {
      awaiting: g.state.awaitingServe,
      humanServes: g.state.humanIsServing,
      ball: { ...g.state.ball.pos },
      ballState: g.state.ball.state,
      toucher: g.state.ball.lastToucher,
      player: { ...g.state.player.pos },
      pose: g.state.player.pose,
      jumping: g.state.player.jumping,
    };
  });

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  // Touch mode so the button layout is visible to assertions.
  await page.locator('#viewport').tap({ position: { x: 20, y: 20 } });
});

test('holding serve replaces every action button with a single serve button', async ({
  page,
}) => {
  await humanServe(page);
  await expect(page.locator('#serve-btn')).toBeVisible();
  for (const id of ['#jump-btn', '#pass-btn', '#block-btn', '#emergency-btn']) {
    await expect(page.locator(id)).toBeHidden();
  }
});

test('the server waits on their own base line with the ball in hand', async ({ page }) => {
  await humanServe(page);
  const s = await serveState(page);
  expect(s.ballState).toBe('held');
  expect(s.pose).toBe('serving');
  expect(s.player.y).toBeCloseTo(COURT_LENGTH - PLAYER_RADIUS, 2);
  // The ball tracks the hand, so it sits right where the server stands.
  expect(s.ball.x).toBeCloseTo(s.player.x, 3);
  expect(s.ball.z).toBeGreaterThan(1);
});

test('the server may only move sideways along the base line', async ({ page }) => {
  await humanServe(page);
  const before = (await serveState(page)).player;

  // Forward is refused outright.
  await page.keyboard.down('w');
  await page.waitForTimeout(500);
  await page.keyboard.up('w');
  expect((await serveState(page)).player.y).toBeCloseTo(before.y, 3);

  // Sideways works, and the ball comes along.
  await page.keyboard.down('a');
  await page.waitForTimeout(400);
  await page.keyboard.up('a');
  const after = await serveState(page);
  expect(after.player.x).toBeLessThan(before.x - 0.5);
  expect(after.player.y).toBeCloseTo(before.y, 3);
  expect(after.ball.x).toBeCloseTo(after.player.x, 3);
});

test('the first press tosses the ball and jumps without touching it', async ({ page }) => {
  await humanServe(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.ball.state === 'live', undefined, {
    timeout: 2000,
  });

  const s = await serveState(page);
  expect(s.jumping).toBe(true);
  // Tossed straight up, and nobody has played it yet.
  expect(s.toucher).toBeNull();
  await page.waitForFunction(() => window.__game!.state.ball.pos.z > 2.5, undefined, {
    timeout: 2000,
  });
});

test('the serve jump gets the same slow motion and trajectory preview', async ({ page }) => {
  await humanServe(page);
  await page.keyboard.press('q');

  // Read the preview in the same step that finds the slow motion. The aiming
  // window closes on its own after about a second, so waiting for it and then
  // asking for the path in a second round trip is a race that a loaded machine
  // loses - the window had already shut, and the test read null.
  const points = await page
    .waitForFunction(
      () => {
        const s = window.__game!.state;
        if (s.timeScale === 1) return null;
        const path = s.aimPreview();
        return path ? path.length : null;
      },
      undefined,
      { timeout: 3000 },
    )
    .then((handle) => handle.jsonValue());

  expect(points).toBeGreaterThan(15);
});

test('the second press serves the ball over the net, firing on contact', async ({ page }) => {
  await humanServe(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.player.jumpPhase === 'hanging', undefined, {
    timeout: 3000,
  });
  await page.keyboard.press('q');

  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 5000 },
  );
  const contact = (await page.evaluate(
    () => ({ ...window.__game!.debug.records.find((r) => r.kind === 'contact')! }),
  )) as unknown as { athlete: string; latencyMs: number; waitMs: number };
  expect(contact.athlete).toBe('player');
  // Same rule as everywhere else: the ball moves at the touch, not the press.
  expect(contact.latencyMs).toBe(0);

  // The interface goes back to the rally buttons the moment it is struck.
  // Serving from the keyboard hid the touch cluster entirely, so bring it
  // back first - otherwise this would only be re-testing the mode switch.
  await page.waitForFunction(() => !window.__game!.state.awaitingServe, undefined, {
    timeout: 2000,
  });
  await page.locator('#viewport').tap({ position: { x: 20, y: 20 } });
  await expect(page.locator('#serve-btn')).toBeHidden();
  await expect(page.locator('#jump-btn')).toBeVisible();

  // Watch the served ball itself cross, rather than waiting for the next
  // rally event. The opponents return a serve now, so the first event to
  // arrive is usually their reply landing somewhere - which says nothing about
  // where the serve went.
  const crossed = await page.evaluate(
    (netY) =>
      new Promise<boolean>((resolve) => {
        const g = window.__game!;
        const started = performance.now();
        const tick = () => {
          const { ball } = g.state;
          if (ball.lastToucher !== 'player') return resolve(false);
          if (ball.pos.y < netY) return resolve(true);
          if (g.state.lastEvent !== null || performance.now() - started > 5000) {
            return resolve(false);
          }
          requestAnimationFrame(tick);
        };
        tick();
      }),
    NET_Y,
  );
  expect(crossed).toBe(true);
});

test('a toss that is never struck is a serve fault', async ({ page }) => {
  await humanServe(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.ball.state === 'live');

  await page.waitForFunction(() => window.__game!.state.phase === 'point_scored', undefined, {
    timeout: 6000,
  });
  const s = await page.evaluate(() => ({
    fault: window.__game!.state.lastFault,
    score: { ...window.__game!.state.score },
    serving: window.__game!.state.servingTeam,
  }));
  expect(s.fault).toBe('serve_missed');
  expect(s.score.opponents).toBe(1);
  expect(s.serving).toBe('opponents');
});

test('only the team that wins the serve back rotates its server', async ({ page }) => {
  // Human team serving and winning the point: the same player serves again.
  const held = await page.evaluate(() => {
    const g = window.__game!;
    g.state.phase = 'rally';
    g.state.servingTeam = 'human';
    g.state.serverIndex = { human: 0, opponents: 0 };
    g.state.awardPoint({ winner: 'human', loser: 'opponents', reason: 'out' });
    return { ...g.state.serverIndex, serving: g.state.servingTeam };
  });
  expect(held.human).toBe(0);
  expect(held.serving).toBe('human');

  // Now the receiving side wins: they take the serve and rotate.
  const won = await page.evaluate(() => {
    const g = window.__game!;
    g.state.phase = 'rally';
    g.state.servingTeam = 'human';
    g.state.serverIndex = { human: 0, opponents: 0 };
    g.state.awardPoint({ winner: 'opponents', loser: 'human', reason: 'out' });
    return { ...g.state.serverIndex, serving: g.state.servingTeam };
  });
  expect(won.opponents).toBe(1);
  expect(won.serving).toBe('opponents');
});

test('an AI serve needs no interface and puts the ball in play by itself', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.servingTeam = 'opponents';
    g.state.serverIndex = { human: 0, opponents: 0 };
    g.state.beginRally();
  });
  await page.waitForFunction(() => window.__game!.state.awaitingServe);

  expect(await page.evaluate(() => window.__game!.state.humanIsServing)).toBe(false);
  await expect(page.locator('#serve-btn')).toBeHidden();
  await expect(page.locator('#jump-btn')).toBeVisible();

  // And it goes up on its own within the beat.
  await page.waitForFunction(() => !window.__game!.state.awaitingServe, undefined, {
    timeout: 4000,
  });
  const s = await serveState(page);
  expect(s.ballState).toBe('live');
  expect(s.toucher).toMatch(/^opponent/);
});

test('the human teammate serving also runs automatically', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.servingTeam = 'human';
    g.state.serverIndex = { human: 1, opponents: 0 };
    g.state.beginRally();
  });
  await page.waitForFunction(() => window.__game!.state.awaitingServe);
  expect(await page.evaluate(() => window.__game!.state.humanIsServing)).toBe(false);
  await expect(page.locator('#serve-btn')).toBeHidden();

  await page.waitForFunction(() => !window.__game!.state.awaitingServe, undefined, {
    timeout: 4000,
  });
  expect(await page.evaluate(() => window.__game!.state.ball.lastToucher)).toBe('teammate');
});
