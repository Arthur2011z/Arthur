import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Regression coverage for: the AI teammate racing in and taking a ball the
 * human player was already handling or was clearly better placed for -
 * "stealing" it out from under them.
 *
 * The teammate used to decide purely on its own proximity to the ball
 * (TEAMMATE_REACT_RADIUS around its position or the ball's target), with no
 * notion of the player's own claim at all. Fixed by adding an explicit
 * priority check (playerHasPriority in TeammateAI.ts), consulted both when
 * entering 'moving_to_ball' and every frame while already in it:
 *
 *   1. player mid-Hechten-dive -> unconditional player priority
 *   2. player has Pass/Notfall-Schlag pressed AND is within ASSIST_RANGE of
 *      the ball -> player priority
 *   3. otherwise -> whoever is currently closer to the ball's live position
 */

/** Counts every [BallContact] line, tagged by which entity fired it. */
function collectContacts(page: Page): string[] {
  const logs: string[] = [];
  page.on('console', (msg) => {
    const t = msg.text();
    if (t.includes('[BallContact]')) logs.push(t);
  });
  return logs;
}

test.describe('Bugfix 5: the AI teammate yields to the player instead of stealing the ball', () => {
  test('does not take a ball the player is closer to by a clear margin', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      for (const o of g.state.opponents) o.update = () => {};

      // Player parked right where the ball will arrive. The teammate is
      // close enough that its own TEAMMATE_REACT_RADIUS check on the ball's
      // target fires (2.26m, inside 2.5m - which is what used to send it in),
      // but the player leads it by 1.9-2.3m for the whole flight, clearing
      // TEAMMATE_YIELD_MARGIN (1.5m) at every frame.
      g.state.player.pos.x = 5.6;
      g.state.player.pos.y = 11.2;
      g.state.teammate.pos.x = 7.2;
      g.state.teammate.pos.y = 12.8;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: 5.6, y: 9.0 }, { x: 5.6, y: 11.2 }, { duration: 1.6, peakHeight: 1, toucher: null });
    });

    await page.waitForTimeout(2500);

    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(0);
    const after = await page.evaluate(() => (window as any).__game.state.ball.lastToucher);
    expect(after).not.toBe('teammate');
  });

  test('tolerance: still takes a near-tie ball the player is only marginally closer to', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      // Player stubbed idle: nothing pressed, not diving - so only the
      // proximity rule is in play, which is exactly what the margin governs.
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};

      // Player IS nearer the ball the whole flight, but only by 0.2-0.8m -
      // inside TEAMMATE_YIELD_MARGIN (1.5m). Mere proximity says nothing
      // about intent, so the teammate must still play it rather than stand
      // by and let it drop.
      g.state.player.pos.x = 5.3;
      g.state.player.pos.y = 11.2;
      g.state.teammate.pos.x = 6.9;
      g.state.teammate.pos.y = 11.2;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: 5.7, y: 8.0 }, { x: 5.7, y: 11.2 }, { duration: 1.6, peakHeight: 1, toucher: null });
    });

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 3000,
    });

    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(1);
  });

  test('an active claim beats the margin: a pressed Pass wins even at a near-tie distance', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    // Press Pass BEFORE launching, so the click's network round-trip is not
    // racing the flight: INPUT_BUFFER_WINDOW (1.2s) then comfortably covers
    // the player's contact at t=0.83s of the 1.0s flight below.
    const btn = page.locator('#pass-btn');
    const box = await btn.boundingBox();
    if (!box) throw new Error('pass button not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.evaluate(() => {
      const g = (window as any).__game;
      for (const o of g.state.opponents) o.update = () => {};
      // Near-tie geometry: the player leads by only 0.3-1.1m the whole way,
      // inside TEAMMATE_YIELD_MARGIN (1.5m), so the proximity rule alone
      // would hand this ball to the teammate. The difference here is the
      // player's active claim (buffered Pass), which wins outright once the
      // ball is inside ASSIST_RANGE - at t=0.32s, comfortably before the
      // teammate could have closed its own 2.2m gap (>=0.52s at
      // TEAMMATE_SPEED), so it backs off without ever making contact.
      g.state.player.pos.x = 5.3;
      g.state.player.pos.y = 11.2;
      g.state.teammate.pos.x = 7.2;
      g.state.teammate.pos.y = 11.2;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: 5.7, y: 8.0 }, { x: 5.7, y: 11.2 }, { duration: 1.0, peakHeight: 1, toucher: null });
    });

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 3000,
    });

    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(0);
  });

  test('does not take a ball while the player is mid-Hechten-dive, even standing much closer to it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      // Player.update is stubbed so 'diving' stays pinned for the whole
      // flight: a real dive only lasts DIVE_DASH_DURATION (0.22s), far
      // shorter than any observable flight, so pinning it is the only way to
      // isolate the priority decision actually under test here.
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};

      g.state.player.pos.x = 4.5;
      g.state.player.pos.y = 12.5;
      g.state.player.state = 'diving';

      // Ball aimed squarely at the teammate's own base - it is by far the
      // closer of the two, and would certainly have taken this before.
      const home = { ...g.state.teammate.homePos };
      g.state.teammate.pos.x = home.x;
      g.state.teammate.pos.y = home.y;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: home.x, y: home.y - 2 }, { x: home.x, y: home.y }, { duration: 1.6, peakHeight: 1, toucher: null });
    });

    await page.waitForTimeout(2500);

    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(0);
  });

  test('control: still takes a ball that is genuinely its own (player far away, idle)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};

      // Player in the far corner, nothing pressed, not diving - this ball is
      // unambiguously the teammate's to play.
      g.state.player.pos.x = 1;
      g.state.player.pos.y = 15;
      const home = { ...g.state.teammate.homePos };
      g.state.teammate.pos.x = home.x;
      g.state.teammate.pos.y = home.y;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: home.x, y: home.y - 2 }, { x: home.x, y: home.y }, { duration: 1.6, peakHeight: 1, toucher: null });
    });

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 3000,
    });

    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(1);
  });

  test('backs off mid-approach when the player takes over after it already committed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    const contacts = collectContacts(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};

      // Start with the ball unambiguously the teammate's, and commit it.
      g.state.player.pos.x = 1;
      g.state.player.pos.y = 15;
      g.state.player.state = 'active';
      const home = { ...g.state.teammate.homePos };
      g.state.teammate.pos.x = home.x;
      g.state.teammate.pos.y = home.y;
      g.state.teammate.state = 'moving_to_ball';
      g.state.ball.launch({ x: home.x, y: home.y - 3 }, { x: home.x, y: home.y }, { duration: 2.5, peakHeight: 1, toucher: null });
    });

    // Let it actually get moving toward the ball first.
    await page.waitForTimeout(300);
    const committed = await page.evaluate(() => (window as any).__game.state.teammate.state);
    expect(committed).toBe('moving_to_ball'); // sanity: it really did commit

    // Now the player dives for it - the teammate must abandon its approach.
    await page.evaluate(() => {
      (window as any).__game.state.player.state = 'diving';
    });

    await page.waitForFunction(() => (window as any).__game.state.teammate.state !== 'moving_to_ball', undefined, {
      timeout: 1000,
    });

    await page.waitForTimeout(2500);
    expect(contacts.filter((l) => l.includes('teammate')).length).toBe(0);
  });
});
