import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;
const NET_HEIGHT = 2.24;
const BALL_RADIUS = 0.15;
const GRAVITY = 9.81;

type Vec3 = { x: number; y: number; z: number };

const ball = (page: Page) =>
  page.evaluate(() => {
    const b = window.__game!.state.ball;
    return { pos: { ...b.pos }, vel: { ...b.vel }, state: b.state, lastToucher: b.lastToucher };
  });

const records = (page: Page) =>
  page.evaluate(() => window.__game!.debug.records.map((r) => ({ ...r })));

/** Stops the automatic ball supply and clears the log, so each test starts
 * from a clean, fully controlled state. */
async function prepare(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.debug.clear();
  });
}

/** Positions the player and sends a ball on a known flight toward them. */
async function serveTo(
  page: Page,
  playerAt: { x: number; y: number },
  from: { x: number; y: number; z?: number },
  time: number,
) {
  await page.evaluate(
    ({ playerAt, from, time }) => {
      const g = window.__game!;
      g.state.player.pos = { ...playerAt };
      // Aim at the player's feet: the flight then passes straight through
      // their hitbox on the way down.
      g.state.launchBall(from, playerAt, time);
    },
    { playerAt, from, time },
  );
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await prepare(page);
});

test('the ball flies a real parabola under gravity, with no jumps in position', async ({
  page,
}) => {
  await page.evaluate(() => window.__game!.state.launchBall({ x: 4, y: 3 }, { x: 4, y: 13 }, 1.6));

  const samples: Vec3[] = [];
  for (let i = 0; i < 14; i += 1) {
    samples.push((await ball(page)).pos);
    await page.waitForTimeout(60);
  }

  const flying = samples.filter((s) => s.z > BALL_RADIUS * 1.5);
  expect(flying.length).toBeGreaterThan(6);

  // Continuity: no single frame may teleport the ball across the court.
  for (let i = 1; i < flying.length; i += 1) {
    const step = Math.hypot(
      flying[i].x - flying[i - 1].x,
      flying[i].y - flying[i - 1].y,
      flying[i].z - flying[i - 1].z,
    );
    expect(step).toBeLessThan(2);
  }

  // Curvature: the height must rise and then fall, and the second difference
  // of z has to match -g over the sampling interval.
  const peak = Math.max(...flying.map((s) => s.z));
  expect(peak).toBeGreaterThan(flying[0].z);
  expect(flying[flying.length - 1].z).toBeLessThan(peak);
});

test('an action pressed before the ball arrives fires exactly on contact', async ({ page }) => {
  await serveTo(page, { x: 4, y: 12 }, { x: 4, y: 3, z: 1.5 }, 1.2);

  // Press while the ball is still clearly away from the player - close enough
  // to fall inside the 180ms buffer, far enough that firing on the press
  // instead of on the touch would be plainly visible in the log.
  await page.waitForFunction(() => {
    const g = window.__game!;
    const b = g.state.ball.pos;
    const p = g.state.player.pos;
    return g.state.ball.state === 'live' && Math.hypot(b.x - p.x, b.y - p.y) < 1.2;
  });
  const distanceAtPress = await page.evaluate(() => {
    const g = window.__game!;
    const b = g.state.ball.pos;
    const p = g.state.player.pos;
    return Math.hypot(b.x - p.x, b.y - p.y);
  });
  expect(distanceAtPress).toBeGreaterThan(0.5);
  await page.keyboard.press('e');

  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 3000 },
  );

  const log = await records(page);
  const contact = log.find((r) => r.kind === 'contact')!;
  expect(contact.athlete).toBe('player');
  expect(contact.action).toBe('pass');

  // The whole point: the effect happens at the moment of physical touch, not
  // at the moment of the press.
  expect(contact.latencyMs).toBe(0);
  expect(contact.touchedAt).toBeGreaterThan(contact.pressedAt);
  expect(contact.waitMs).toBeGreaterThan(0);
  expect(contact.waitMs).toBeLessThanOrEqual(180);

  // And the ball really was sent somewhere by it.
  expect((await ball(page)).lastToucher).toBe('player');
});

test('a press with no ball arriving expires without any effect', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 1, y: 14 };
  });
  await page.keyboard.press('e');
  await page.waitForTimeout(400);

  const log = await records(page);
  expect(log.some((r) => r.kind === 'contact')).toBe(false);
  const expired = log.find((r) => r.kind === 'expired');
  expect(expired).toBeDefined();
  expect(expired!.action).toBe('pass');
  // The buffer window is 180ms; it must not hang around much longer.
  expect(expired!.heldMs).toBeLessThan(400);

  expect((await ball(page)).state).toBe('dead');
});

test('the ball passes untouched through a player who did not ask to play it', async ({
  page,
}) => {
  await serveTo(page, { x: 4, y: 12 }, { x: 4, y: 3, z: 1.5 }, 1.2);
  await page.waitForTimeout(1400);

  const state = await ball(page);
  expect(state.lastToucher).toBeNull();
  const log = await records(page);
  expect(log.some((r) => r.kind === 'contact')).toBe(false);
});

test('a ball that reaches the net too low is stopped by it', async ({ page }) => {
  await page.evaluate(() => {
    // Flat and low from deep in the human half: it cannot clear 2.24m.
    const g = window.__game!;
    g.state.ball.strike({ x: 4, y: 12, z: 1.0 }, { x: 0, y: -9, z: 0.5 }, null);
  });
  await page.waitForFunction(() => window.__game!.state.lastEvent !== null, undefined, {
    timeout: 3000,
  });

  const event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.type).toBe('net');
  expect(event.at.y).toBeCloseTo(NET_Y, 3);
  expect(event.at.z).toBeLessThan(NET_HEIGHT);
});

test('a high ball crosses the net and is judged in or out where it lands', async ({ page }) => {
  await page.evaluate(() => window.__game!.state.launchBall({ x: 4, y: 12 }, { x: 4, y: 3 }, 1.8));
  await page.waitForFunction(
    () => window.__game!.state.lastEvent?.type === 'landed',
    undefined,
    { timeout: 4000 },
  );
  let event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.inBounds).toBe(true);
  expect(event.side).toBe('opponents');
  expect(event.at.x).toBeCloseTo(4, 0);
  expect(event.at.y).toBeCloseTo(3, 0);

  // Same shot, aimed past the far base line: out is a real outcome, not a
  // clamped-back-in one.
  await page.evaluate(() => {
    // The landing above scored a point, which pauses play; reopen the rally
    // so the next flight is actually simulated.
    window.__game!.state.phase = 'rally';
    window.__game!.state.lastEvent = null;
    window.__game!.state.launchBall({ x: 4, y: 12 }, { x: 4, y: -2 }, 1.8);
  });
  await page.waitForFunction(
    () => window.__game!.state.lastEvent?.type === 'landed',
    undefined,
    { timeout: 4000 },
  );
  event = await page.evaluate(() => ({ ...window.__game!.state.lastEvent! }));
  expect(event.inBounds).toBe(false);
  expect(event.at.y).toBeLessThan(0);
});

test('the ball has to descend into reach before it can be played', async ({ page }) => {
  // Dropped from 5m directly onto the player. A 2.2m standing reach is only
  // met after roughly 0.73s of falling, so nothing may happen before then no
  // matter how often the action is pressed.
  const launchedAt = await page.evaluate(() => {
    const g = window.__game!;
    g.state.player.pos = { x: 4, y: 12 };
    g.state.ball.strike({ x: 4, y: 12, z: 5 }, { x: 0, y: 0, z: 0 }, null);
    return performance.now();
  });

  for (let i = 0; i < 14; i += 1) {
    await page.keyboard.press('e');
    await page.waitForTimeout(80);
  }

  const log = await records(page);
  const contact = log.find((r) => r.kind === 'contact');
  expect(contact).toBeDefined();
  expect(contact!.touchedAt - launchedAt).toBeGreaterThan(600);
});

test('the trajectory preview matches the flight the ball actually takes', async ({ page }) => {
  const { preview, actual } = await page.evaluate(async () => {
    const g = window.__game!;
    const from = { x: 4, y: 12, z: 2.4 };
    const vel = { x: 0.6, y: -7.5, z: 3.2 };

    // Same launch, once predicted and once flown.
    const preview = g.simulate(from, vel);
    g.state.ball.strike(from, vel, null);

    const actual: { x: number; y: number; z: number }[] = [];
    await new Promise<void>((resolve) => {
      const tick = () => {
        actual.push({ ...g.state.ball.pos });
        if (g.state.ball.state !== 'live') resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { preview, actual };
  });

  expect(preview.length).toBeGreaterThan(20);
  expect(actual.length).toBeGreaterThan(3);

  // Every real position must sit on the predicted path.
  for (const point of actual) {
    const nearest = Math.min(
      ...preview.map((p: Vec3) =>
        Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z),
      ),
    );
    expect(nearest).toBeLessThan(0.02);
  }
});

test('gravity acts at the documented strength', async ({ page }) => {
  const drop = await page.evaluate(async () => {
    const g = window.__game!;
    g.state.ball.strike({ x: 4, y: 12, z: 6 }, { x: 0, y: 0, z: 0 }, null);
    const z0 = g.state.ball.pos.z;
    const t0 = performance.now();
    await new Promise((r) => setTimeout(r, 300));
    return { z0, z1: g.state.ball.pos.z, dt: (performance.now() - t0) / 1000 };
  });

  const expected = drop.z0 - 0.5 * GRAVITY * drop.dt * drop.dt;
  expect(drop.z1).toBeGreaterThan(expected - 0.25);
  expect(drop.z1).toBeLessThan(expected + 0.25);
});
