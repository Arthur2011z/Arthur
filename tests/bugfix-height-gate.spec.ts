import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Regression coverage for: contact firing while the player/teammate/opponent
 * was not actually at the ball's live position AND height. Previously only
 * the ground-plane (x/y) distance to the ball was checked - the ball's
 * current flight height was never part of the condition at all, so a high
 * arc passing over an entity's ground position could be "caught" while still
 * meters overhead. Fixed by adding a CATCHABLE_HEIGHT check (see
 * constants.ts) alongside HIT_RANGE in Player.ballReachable(),
 * TeammateAI.updateMovingToBall() and OpponentAI.updateMovingToBall() - all
 * three gated on the ball's live ball.pos/ball.height, never ball.target
 * (the landing-point prediction).
 */

async function stubOtherEntities(page: Page, keep: 'player' | 'teammate' | 'opponent1') {
  await page.evaluate((keep) => {
    const g = (window as any).__game;
    if (keep !== 'player') g.state.player.update = () => {};
    if (keep !== 'teammate') g.state.teammate.update = () => {};
    if (keep !== 'opponent1') {
      g.state.opponents[0].update = () => {};
    } else {
      g.state.opponents[1].update = () => {};
    }
  }, keep);
}

async function tapButton(page: Page, id: string) {
  const btn = page.locator(`#${id}`);
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Bugfix 3: contact requires the ball to be at a catchable height, not just ground-plane distance', () => {
  test('player: standing exactly on the ball\'s ground track does not catch it while the ball is still high overhead', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubOtherEntities(page, 'player');

    await page.evaluate(() => {
      const g = (window as any).__game;
      // Vertical path x=4, y: 9 -> 15 - the player sits exactly on the
      // midpoint (4, 12), which is also where the parabola (peakHeight=3)
      // peaks - ground-plane distance is ~0 there, but the ball is ~3m up.
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 12;
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 15 }, { duration: 2, peakHeight: 3, toucher: null });
    });
    await tapButton(page, 'pass-btn');

    // Sample through the ball's closest ground-plane approach (around the
    // midpoint of the flight) while it's still high - must never catch here.
    await page.waitForTimeout(900);
    const midFlight = await page.evaluate(() => ({
      lastToucher: (window as any).__game.state.ball.lastToucher,
      height: (window as any).__game.state.ball.height,
    }));
    expect(midFlight.lastToucher).toBeNull();
    expect(midFlight.height).toBeGreaterThan(2); // sanity: this really is the "too high" moment

    // Let the rest of the flight play out - since nobody was ever actually
    // reachable in this configuration, it lands untouched at its target.
    await page.waitForFunction(() => (window as any).__game.state.ball.state === 'idle', undefined, {
      timeout: 2000,
    });
    const after = await page.evaluate(() => ({
      lastToucher: (window as any).__game.state.ball.lastToucher,
      target: { ...(window as any).__game.state.ball.target },
    }));
    expect(after.lastToucher).toBeNull();
    expect(after.target).toEqual({ x: 4, y: 15 });
  });

  test("player: parked at the ball's landing point (not its live position) does not catch it early", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubOtherEntities(page, 'player');

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 12; // exactly the ball's target below
      g.state.ball.launch({ x: 4, y: 9.2 }, { x: 4, y: 12 }, { duration: 3, peakHeight: 2.5, toucher: null });
    });
    await tapButton(page, 'pass-btn');

    // Early on, the ball is nowhere near the player's live position (they're
    // standing at the *target*, not the ball) - must not fire.
    await page.waitForTimeout(600);
    const early = await page.evaluate(() => ({
      lastToucher: (window as any).__game.state.ball.lastToucher,
      distance: Math.hypot(
        (window as any).__game.state.ball.pos.x - (window as any).__game.state.player.pos.x,
        (window as any).__game.state.ball.pos.y - (window as any).__game.state.player.pos.y,
      ),
    }));
    expect(early.lastToucher).toBeNull();
    expect(early.distance).toBeGreaterThan(1); // sanity: genuinely still far away

    // Ball geometry here (start 9.2, target/player at 12, HIT_RANGE 0.7) puts
    // the earliest possible catch around u=0.75 of the 3s flight (~2.25s) -
    // re-press right before that so the 1.2s Pass buffer is still fresh.
    await page.waitForTimeout(1300);
    await tapButton(page, 'pass-btn');
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 2500,
    });
  });

  test('teammate: never catches while the ball is above CATCHABLE_HEIGHT, even though it walks toward it the whole time', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubOtherEntities(page, 'teammate');

    // Unlike the stationary player above, the teammate actively walks toward
    // the ball's live position the whole flight, so it may well converge and
    // catch it *before* a fixed sample point - that's fine, the invariant
    // under test isn't "never catches by time X", it's "whenever it does
    // catch, the height at that exact moment was already <= CATCHABLE_HEIGHT"
    // - verified here via the same [BallContact] console log the fix adds at
    // the actual point of contact.
    const contactLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[BallContact]')) contactLogs.push(msg.text());
    });

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.pos.x = 4;
      g.state.teammate.pos.y = 12;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 15 }, { duration: 2, peakHeight: 3, toucher: null });
    });

    // A catch relaunches a new (still 'flying') shot in the same tick it's
    // detected, so "state !== 'flying'" would never observe it - wait for
    // either outcome instead: a touch, or landing untouched.
    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'teammate' || (window as any).__game.state.ball.state === 'idle',
      undefined,
      { timeout: 3000 },
    );

    expect(contactLogs.length).toBeGreaterThan(0); // sanity: it did catch this one eventually
    for (const line of contactLogs) {
      const heightMatch = line.match(/height: ([\d.]+)/);
      expect(heightMatch).not.toBeNull();
      expect(Number(heightMatch![1])).toBeLessThanOrEqual(2); // CATCHABLE_HEIGHT
    }
  });

  test('opponent: never catches while the ball is above CATCHABLE_HEIGHT, even though it walks toward it the whole time', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubOtherEntities(page, 'opponent1');

    const contactLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[BallContact]')) contactLogs.push(msg.text());
    });

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.opponents[0].pos.x = 4;
      g.state.opponents[0].pos.y = 4;
      g.state.opponents[0].state = 'moving_to_ball';
      g.state.ball.launch({ x: 4, y: 1 }, { x: 4, y: 7 }, { duration: 2, peakHeight: 3, toucher: null });
    });

    await page.waitForFunction(
      () => (window as any).__game.state.ball.lastToucher === 'opponent1' || (window as any).__game.state.ball.state === 'idle',
      undefined,
      { timeout: 3000 },
    );

    expect(contactLogs.length).toBeGreaterThan(0);
    for (const line of contactLogs) {
      const heightMatch = line.match(/height: ([\d.]+)/);
      expect(heightMatch).not.toBeNull();
      expect(Number(heightMatch![1])).toBeLessThanOrEqual(2);
    }
  });

  test('normal catch still resolves correctly once distance and height are both actually satisfied', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubOtherEntities(page, 'player');

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 12;
      // Low, slow flight - stays within CATCHABLE_HEIGHT for most of it.
      g.state.ball.launch({ x: 4, y: 9 }, { x: 4, y: 12 }, { duration: 1.5, peakHeight: 1, toucher: null });
    });
    await tapButton(page, 'pass-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 3000,
    });
  });
});
