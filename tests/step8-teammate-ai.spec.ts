import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

/** A rally in progress with the ball under the human team's control. */
async function openRally(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.state.rally.possession = 'human';
    g.state.rally.touches = 0;
    g.state.rally.lastToucher = 'opponent1';
    g.state.player.resetForNewRally();
    for (const ai of g.state.aiAthletes) ai.resetForNewRally();
    g.debug.clear();
  });
}

const teammate = (page: Page) =>
  page.evaluate(() => ({
    pos: { ...window.__game!.state.teammate.pos },
    state: window.__game!.state.teammate.state,
    blocking: window.__game!.state.teammate.blocking,
    committed: window.__game!.state.teammate.committed,
  }));

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await openRally(page);
});

test('the teammate covers whichever zone the human is not in', async ({ page }) => {
  // Human at the net: the partner has to take the back of the court.
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.7 };
    window.__game!.state.teammate.pos = { x: 4, y: 8.7 };
  });
  await page.waitForTimeout(1400);
  const behind = await teammate(page);
  expect(behind.pos.y).toBeGreaterThan(NET_Y + 4);

  // Human drops back: the partner moves up to the net instead.
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 14.5 };
  });
  await page.waitForTimeout(1800);
  const forward = await teammate(page);
  expect(forward.pos.y).toBeLessThan(NET_Y + 3);
});

test('an early contact is set to the human, staying on their own side', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 6.5, y: 12 };
    g.state.teammate.pos = { x: 2, y: 11 };
    g.state.rally.touches = 0;
    // A ball dropping onto the teammate.
    g.state.ball.strike({ x: 2, y: 11, z: 4 }, { x: 0, y: 0, z: 0 }, 'opponent1');
  });

  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'teammate',
    undefined,
    { timeout: 4000 },
  );
  await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
    timeout: 5000,
  });
  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));

  // A set, not an attack: it stays on the human side and arrives near the net,
  // where an attack can be launched from.
  expect(event.at.y).toBeGreaterThan(NET_Y);
  expect(event.at.y).toBeLessThan(NET_Y + 4.5);
});

test('the third contact has to cross the net', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 6.5, y: 13 };
    g.state.teammate.pos = { x: 3, y: 10 };
    g.state.rally.touches = 2;
    g.state.rally.lastToucher = 'player';
    g.state.ball.strike({ x: 3, y: 10, z: 4 }, { x: 0, y: 0, z: 0 }, 'player');
  });

  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'teammate',
    undefined,
    { timeout: 4000 },
  );
  const vel = await page.evaluate(() => ({ ...window.__game!.state.ball.vel }));
  // Sent toward the far side.
  expect(vel.y).toBeLessThan(0);
});

test('the teammate never chases a ball it just played', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 7, y: 14 };
    g.state.teammate.pos = { x: 3, y: 11 };
    g.state.rally.touches = 0;
    g.state.ball.strike({ x: 3, y: 11, z: 4 }, { x: 0, y: 0, z: 0 }, 'opponent1');
  });
  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'teammate',
    undefined,
    { timeout: 4000 },
  );

  // From here the ball is its own set - it must not go after it again.
  await page.waitForTimeout(900);
  const after = await teammate(page);
  expect(after.committed).toBe(false);

  const contacts = await page.evaluate(() =>
    window.__game!.debug.records.filter(
      (r) => r.kind === 'contact' && r.athlete === 'teammate',
    ).length,
  );
  expect(contacts).toBe(1);
});

test('the human has priority when they are closer to the ball', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    // Ball dropping right on the human, with the partner clearly further off.
    g.state.player.pos = { x: 4, y: 12 };
    g.state.teammate.pos = { x: 4, y: 14 };
    g.state.ball.strike({ x: 4, y: 12, z: 4 }, { x: 0, y: 0, z: 0 }, 'opponent1');
  });

  // Long enough for a committed chase to be obvious.
  await page.waitForTimeout(700);
  const held = await teammate(page);
  expect(held.committed).toBe(false);
  expect(held.state).not.toBe('chasing');
  // And it never takes the ball off the player.
  expect(await page.evaluate(() => window.__game!.state.ball.lastToucher)).toBe('opponent1');
});

test('the teammate goes up to block an attack it can read', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 14 };
    g.state.teammate.pos = { x: 3, y: 8.8 };
    // An opponent airborne right at the net, about to hit.
    g.state.opponents[0].pos = { x: 3, y: 7.3 };
    g.state.opponents[0].jumpHeight = 0.9;
    g.state.ball.strike({ x: 3, y: 7.3, z: 2.9 }, { x: 0, y: 0, z: 0 }, 'opponent2');
  });

  await page.waitForFunction(() => window.__game!.state.teammate.blocking, undefined, {
    timeout: 3000,
  });
  const up = await teammate(page);
  expect(up.blocking).toBe(true);
  expect(up.pos.y).toBeLessThan(NET_Y + 1.4);
});
