import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

async function prepare(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.aiEnabled = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.state.rally.lastToucher = null;
    g.state.rally.possession = 'human';
    g.state.rally.touches = 0;
    g.debug.clear();
  });
}

/** Drops a ball straight onto a point, so contact is guaranteed if the player
 * is standing there and asks for it. */
async function dropOn(page: Page, at: { x: number; y: number }, fromHeight = 4) {
  await page.evaluate(
    ({ at, fromHeight }) => {
      window.__game!.state.ball.strike(
        { x: at.x, y: at.y, z: fromHeight },
        { x: 0, y: 0, z: 0 },
        null,
      );
    },
    { at, fromHeight },
  );
}

async function waitForContact(page: Page) {
  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 4000 },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await prepare(page);
});

test('a pass is delivered to the partner near the net, not over it', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 2, y: 13 };
    g.state.teammate.pos = { x: 6, y: 11 };
  });
  await dropOn(page, { x: 2, y: 13 });

  // Press once the ball is nearly there, then let it land.
  await page.waitForFunction(() => window.__game!.state.ball.pos.z < 2.6);
  await page.keyboard.press('e');
  await waitForContact(page);

  await page.waitForFunction(
    () => window.__game!.state.lastEvent !== null,
    undefined,
    { timeout: 4000 },
  );
  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));

  // Stays on the human side, and arrives close to the net on the partner's
  // side of the court so they can attack it.
  expect(event.side).toBe('human');
  expect(event.at.y).toBeGreaterThan(NET_Y);
  expect(event.at.y).toBeLessThan(NET_Y + 4);
  expect(event.at.x).toBeGreaterThan(4);
});

test('the Notfall shot goes over the net from deep in the own half', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 14.5 };
  });
  await dropOn(page, { x: 4, y: 14.5 });

  await page.waitForFunction(() => window.__game!.state.ball.pos.z < 2.6);
  await page.keyboard.press('f');
  await waitForContact(page);

  await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
    timeout: 4000,
  });
  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.type).toBe('landed');
  expect(event.at.y).toBeLessThan(NET_Y);
});

test('holding a direction steers the Notfall shot short or deep', async ({ page }) => {
  /** Plays one Notfall shot with `key` held and reports where it landed. */
  async function shotWith(key: string | null) {
    await prepare(page);
    await page.evaluate(() => {
      window.__game!.state.player.pos = { x: 4, y: 12 };
    });
    await dropOn(page, { x: 4, y: 12 });
    await page.waitForFunction(() => window.__game!.state.ball.pos.z < 2.6);
    if (key) await page.keyboard.down(key);
    await page.keyboard.press('f');
    await waitForContact(page);
    if (key) await page.keyboard.up(key);
    await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
      timeout: 4000,
    });
    return page.evaluate(() => ({ ...window.__game!.state.lastEvent!.at }));
  }

  // W pushes toward the net (drop it short), S pulls back (send it deep).
  const short = await shotWith('w');
  const deep = await shotWith('s');
  expect(short.y).toBeGreaterThan(deep.y);
  expect(short.y).toBeGreaterThan(NET_Y - 4);
  expect(deep.y).toBeLessThan(NET_Y - 3);
});

test('shots scatter, so repeated identical attempts do not land on one spot', async ({
  page,
}) => {
  const landings: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i += 1) {
    await prepare(page);
    await page.evaluate(() => {
      window.__game!.state.player.pos = { x: 4, y: 12 };
    });
    await dropOn(page, { x: 4, y: 12 });
    await page.waitForFunction(() => window.__game!.state.ball.pos.z < 2.6);
    await page.keyboard.press('f');
    await waitForContact(page);
    await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
      timeout: 4000,
    });
    landings.push(await page.evaluate(() => ({ ...window.__game!.state.lastEvent!.at })));
  }

  const spreadX = Math.max(...landings.map((l) => l.x)) - Math.min(...landings.map((l) => l.x));
  const spreadY = Math.max(...landings.map((l) => l.y)) - Math.min(...landings.map((l) => l.y));
  // Noticeable, but nowhere near enough to make aiming pointless.
  expect(spreadX + spreadY).toBeGreaterThan(0.15);
  expect(spreadX).toBeLessThan(4);
});

test('pressing Pass boosts the player toward a ball they could not otherwise reach', async ({
  page,
}) => {
  /** Runs the same out-of-reach ball with and without pressing Pass. */
  async function attempt(press: boolean) {
    await prepare(page);
    await page.evaluate(() => {
      const g = window.__game!;
      g.state.player.pos = { x: 4, y: 12 };
      // Falls 2.2m to the player's side, out of reach of a standing player.
      g.state.ball.strike({ x: 6.2, y: 12, z: 3.2 }, { x: 0, y: 0, z: 0 }, null);
    });
    if (press) await page.keyboard.press('e');
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
      playerX: window.__game!.state.player.pos.x,
      touched: window.__game!.state.ball.lastToucher,
    }));
  }

  const idle = await attempt(false);
  expect(idle.playerX).toBeCloseTo(4, 1); // no input, no movement at all
  expect(idle.touched).toBeNull();

  const boosted = await attempt(true);
  expect(boosted.playerX).toBeGreaterThan(idle.playerX + 0.8);
});

test('the boost never drags a player back into a ball they already played', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 12 };
    g.state.teammate.pos = { x: 4, y: 11 };
  });
  await dropOn(page, { x: 4, y: 12 });
  await page.waitForFunction(() => window.__game!.state.ball.pos.z < 2.6);
  await page.keyboard.press('e');
  await waitForContact(page);

  const afterContact = await page.evaluate(() => ({ ...window.__game!.state.player.pos }));

  // Press again: the player has taken the contact, so no boost may start and
  // they must not be moved toward the ball at all.
  await page.keyboard.press('e');
  await page.waitForTimeout(250);
  const now = await page.evaluate(() => ({
    pos: { ...window.__game!.state.player.pos },
    boosting: window.__game!.state.player.boosting,
  }));

  expect(now.boosting).toBe(false);
  expect(Math.hypot(now.pos.x - afterContact.x, now.pos.y - afterContact.y)).toBeLessThan(0.05);
});

test('the boost expires by itself and the player stops dead', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 12 };
    // Far away, so the boost runs its full length without ever reaching it.
    g.state.ball.strike({ x: 1, y: 9, z: 3 }, { x: 0, y: 0, z: 0 }, null);
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(500);

  const settled = await page.evaluate(() => ({
    pos: { ...window.__game!.state.player.pos },
    boosting: window.__game!.state.player.boosting,
  }));
  expect(settled.boosting).toBe(false);

  await page.waitForTimeout(300);
  const later = await page.evaluate(() => ({ ...window.__game!.state.player.pos }));
  expect(later.x).toBeCloseTo(settled.pos.x, 5);
  expect(later.y).toBeCloseTo(settled.pos.y, 5);
});

test('the boost still does not guarantee a hit', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 1, y: 14 };
    // Way out of range: 0.4s of boosted running cannot cover this.
    g.state.ball.strike({ x: 7, y: 9, z: 2 }, { x: 0, y: 0, z: 0 }, null);
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(700);

  const log = await page.evaluate(() => window.__game!.debug.records.map((r) => ({ ...r })));
  expect(log.some((r) => r.kind === 'contact')).toBe(false);
  expect(log.some((r) => r.kind === 'expired')).toBe(true);
});
