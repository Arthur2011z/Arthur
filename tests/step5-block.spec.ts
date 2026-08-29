import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;
const NET_HEIGHT = 2.24;

async function prepare(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.state.rally.lastToucher = 'opponent1';
    g.state.rally.possession = 'opponents';
    g.state.rally.touches = 1;
    g.debug.clear();
  });
}

/** Sends a hard attack from the far side, flat and just over the tape, at the
 * player's x - the shot a block exists to stop. */
async function incomingSpike(page: Page, atX = 4, height = 2.6) {
  await page.evaluate(
    ({ atX, height, netY }) => {
      window.__game!.state.ball.strike(
        { x: atX, y: netY - 1.2, z: height },
        { x: 0, y: 7.5, z: -0.4 },
        'opponent1',
      );
    },
    { atX, height, netY: NET_Y },
  );
}

const ballState = (page: Page) =>
  page.evaluate(() => {
    const b = window.__game!.state.ball;
    return { pos: { ...b.pos }, vel: { ...b.vel }, state: b.state, lastToucher: b.lastToucher };
  });

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await prepare(page);
});

test('a block only engages near the net', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 13 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  expect(await page.evaluate(() => window.__game!.state.player.blocking)).toBe(false);

  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.6 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  const up = await page.evaluate(() => ({
    blocking: window.__game!.state.player.blocking,
    pose: window.__game!.state.player.pose,
    jump: window.__game!.state.player.jumpHeight,
  }));
  expect(up.blocking).toBe(true);
  expect(up.pose).toBe('blocking');
  expect(up.jump).toBeGreaterThan(0);
});

test('the raised block reaches above the tape and across the net', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.6 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(140);

  const box = await page.evaluate(() => {
    const b = window.__game!.state.player.hitbox;
    return { center: { ...b.center }, radius: b.radius, floor: b.floor, ceiling: b.ceiling };
  });
  // Starts at the tape - a block is played over the net, not under it.
  expect(box.floor).toBeCloseTo(NET_HEIGHT, 2);
  expect(box.ceiling).toBeGreaterThan(NET_HEIGHT + 0.5);
  // And reaches toward (here, right up to) the net line.
  expect(box.center.y).toBeLessThan(8.6);
});

test('a spike coming through the zone is rejected back over the net', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.55 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(130);
  await incomingSpike(page);

  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'player',
    undefined,
    { timeout: 2000 },
  );
  const after = await ballState(page);

  // Sent back toward the far side (negative y) and driven downward.
  expect(after.vel.y).toBeLessThan(0);
  expect(after.vel.z).toBeLessThan(0);

  await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
    timeout: 3000,
  });
  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.type).toBe('landed');
  expect(event.at.y).toBeLessThan(NET_Y);
});

test('a block is logged like every other action, firing on contact', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.55 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(130);
  await incomingSpike(page);

  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 2000 },
  );
  const record = await page.evaluate(
    () => ({ ...window.__game!.debug.records.find((r) => r.kind === 'contact')! }) as never,
  );
  const contact = record as unknown as {
    action: string;
    latencyMs: number;
    waitMs: number;
  };
  expect(contact.action).toBe('block');
  // Same rule as every other action: the effect lands on the touch, not on
  // the press - and here the press was well over 100ms earlier.
  expect(contact.latencyMs).toBe(0);
  expect(contact.waitMs).toBeGreaterThan(100);
});

test('a block costs the team no touch', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 8.55 };
    g.state.rally.possession = 'human';
    g.state.rally.touches = 2;
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(130);
  await incomingSpike(page);

  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'player',
    undefined,
    { timeout: 2000 },
  );
  const rally = await page.evaluate(() => ({
    touches: window.__game!.state.rally.touches,
    lastToucher: window.__game!.state.rally.lastToucher,
  }));
  expect(rally.touches).toBe(0);
  // And the lock is released, so the blocker may play the very next ball.
  expect(rally.lastToucher).toBeNull();
});

test('a ball passing below the tape is not blocked', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.55 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(130);
  // Well under the net height: nothing for a block to reach.
  await incomingSpike(page, 4, 1.2);
  await page.waitForTimeout(400);

  expect((await ballState(page)).lastToucher).toBe('opponent1');
});

test('the block window closes by itself and cannot be spammed', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.6 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(700); // longer than the 0.55s window

  expect(await page.evaluate(() => window.__game!.state.player.blocking)).toBe(false);
  expect(await page.evaluate(() => window.__game!.state.player.jumpHeight)).toBe(0);

  // Straight after the window there is a cooldown, so the arms cannot simply
  // stay up forever.
  await page.keyboard.press('Space');
  await page.waitForTimeout(30);
  expect(await page.evaluate(() => window.__game!.state.player.blocking)).toBe(false);
});

test('a block met barely at the tape is returned gently enough to clear it', async ({
  page,
}) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 8.5 };
  });
  await page.keyboard.press('Space');
  await page.waitForTimeout(130);
  // Right at net height: hammering this one down would only bury it.
  await incomingSpike(page, 4, NET_HEIGHT + 0.05);

  await page.waitForFunction(
    () => window.__game!.state.ball.lastToucher === 'player',
    undefined,
    { timeout: 2000 },
  );
  await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
    timeout: 3000,
  });
  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.type).toBe('landed');
  expect(event.at.y).toBeLessThan(NET_Y);
});
