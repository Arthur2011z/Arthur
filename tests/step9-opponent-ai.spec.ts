import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

/** Puts the game into a running rally with nothing scripted in the air. */
async function openRally(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.state.score = { human: 0, opponents: 0 };
    g.state.winner = null;
    g.state.player.resetForNewRally();
    for (const ai of g.state.aiAthletes) ai.resetForNewRally();
    g.debug.clear();
  });
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await openRally(page);
});

test('the opponents dig a hard spike reliably', async ({ page }) => {
  /** Fires one hard attack into the far half and reports whether it came back. */
  async function attempt(): Promise<boolean> {
    await openRally(page);
    await page.evaluate(() => {
      const g = window.__game!;
      g.state.rally.possession = 'opponents';
      g.state.rally.touches = 0;
      g.state.rally.lastToucher = 'player';
      g.state.opponents[0].pos = { x: 4, y: 6.2 };
      g.state.opponents[1].pos = { x: 4, y: 2.5 };
      // A real spike: fast, flat, from just over the net.
      g.state.ball.strike({ x: 4, y: 7.4, z: 2.9 }, { x: 0.6, y: -13, z: -3.2 }, 'player');
    });
    await page.waitForFunction(
      () => {
        const g = window.__game!;
        return g.state.ball.lastToucher !== 'player' || g.state.ball.state !== 'live';
      },
      undefined,
      { timeout: 4000 },
    );
    return page.evaluate(() => window.__game!.state.ball.lastToucher !== 'player');
  }

  let dug = 0;
  const runs = 12;
  for (let i = 0; i < runs; i += 1) if (await attempt()) dug += 1;

  // Defence is meant to be good: most hard balls come back up.
  expect(dug / runs).toBeGreaterThanOrEqual(0.75);
});

test('the opponents attack fallibly, and that is independent of their defence', async ({
  page,
}) => {
  /** Lets an opponent take a third-contact attack and reports whether it was
   * good (landed in the human half) or a fault. */
  async function attack(): Promise<boolean> {
    await openRally(page);
    await page.evaluate(() => {
      const g = window.__game!;
      g.state.rally.possession = 'opponents';
      g.state.rally.touches = 2;
      g.state.rally.lastToucher = 'opponent2';
      g.state.opponents[0].pos = { x: 4, y: 6.4 };
      g.state.opponents[1].pos = { x: 6, y: 3 };
      // The human side has to stay out of it. Now that the attacks genuinely
      // cross, the teammate digs them and the rally simply carries on - there
      // is no landing to read, and waiting for one measures the defence rather
      // than the attack. Parking the pair in the back corners and taking the
      // teammate's reach away leaves the ball to land where it was aimed.
      g.state.player.pos = { x: 0.5, y: 15.5 };
      g.state.teammate.pos = { x: 7.5, y: 15.5 };
      g.state.teammate.profile.defenceReach = 0;
      g.state.teammate.profile.blockChance = 0;
      // Set up in front of opponent1, ready to be attacked.
      g.state.ball.strike({ x: 4, y: 6.4, z: 4.2 }, { x: 0, y: 0, z: 0 }, 'opponent2');
    });
    await page.waitForFunction(
      () => window.__game!.state.lastEvent !== null,
      undefined,
      { timeout: 6000 },
    );
    return page.evaluate(() => {
      const e = window.__game!.state.lastEvent!;
      return e.type === 'landed' && e.inBounds && e.at.y > 8;
    });
  }

  test.setTimeout(120_000);
  let good = 0;
  const runs = 20;
  for (let i = 0; i < runs; i += 1) if (await attack()) good += 1;

  // Measured over 100 attempts with nobody defending: 70 in, 24 out, 5 into
  // the net, 1 short. Twenty attempts cannot pin that rate down to a few
  // percent, so these bounds are deliberately wide: they catch the structural
  // breaks - an attack that always works, or one that never does - and leave
  // the actual balance to the hundred-attempt measurement above.
  expect(good / runs).toBeLessThanOrEqual(0.95);
  expect(good / runs).toBeGreaterThanOrEqual(0.35);
});

test('only one opponent goes after a given ball', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.rally.possession = 'opponents';
    g.state.rally.touches = 0;
    g.state.rally.lastToucher = 'player';
    g.state.opponents[0].pos = { x: 2, y: 5 };
    g.state.opponents[1].pos = { x: 6, y: 5 };
    // Dropping clearly on opponent1's side of the court.
    g.state.ball.strike({ x: 1.6, y: 4.6, z: 4.5 }, { x: 0, y: 0, z: 0 }, 'player');
  });
  await page.waitForTimeout(500);

  const committed = await page.evaluate(() =>
    window.__game!.state.opponents.map((o) => o.committed),
  );
  expect(committed.filter(Boolean)).toHaveLength(1);
  expect(committed[0]).toBe(true);
});

test('the opponents hold two different zones and come back to them', async ({ page }) => {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.opponents[0].pos = { x: 1, y: 1 };
    g.state.opponents[1].pos = { x: 7, y: 1 };
    g.state.ball.reset();
  });
  await page.waitForTimeout(2500);

  const [a, b] = await page.evaluate(() =>
    window.__game!.state.opponents.map((o) => ({ ...o.pos })),
  );
  // Both back on their own half, and split front/back rather than stacked.
  expect(a.y).toBeLessThan(NET_Y);
  expect(b.y).toBeLessThan(NET_Y);
  expect(Math.abs(a.y - b.y)).toBeGreaterThan(1.5);
});

test('the game plays itself without getting stuck', async ({ page }) => {
  test.setTimeout(120_000);
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = true;
    g.state.aiEnabled = true;
    g.state.score = { human: 0, opponents: 0 };
    g.state.winner = null;
    g.state.servingTeam = 'opponents';
    // The teammate serves for the human side, so nothing waits on a keypress.
    g.state.serverIndex = { human: 1, opponents: 0 };
    g.state.beginRally();
    g.debug.clear();
  });

  // Let it run with a human who is at least trying. Two things matter here:
  // without any input the teammate correctly defers to the player on every
  // ball aimed at them and nothing ever comes back, and pressing only Pass
  // would never send anything over the net - a pass deliberately stays on the
  // own side. Alternating Pass and Notfall is what an actual rally looks like.
  //
  // Run until play has actually happened rather than for a fixed stretch of
  // wall clock. Rallies here average around ten contacts, so how much fits
  // into a fixed twenty seconds depends on how loaded the machine is - and a
  // slow machine seeing one long rally is not the game seizing up.
  const read = () =>
    page.evaluate(() => ({
      score: { ...window.__game!.state.score },
      phase: window.__game!.state.phase,
      contacts: window.__game!.debug.records.filter((r) => r.kind === 'contact').length,
      touchers: [
        ...new Set(
          window.__game!.debug.records
            .filter((r) => r.kind === 'contact')
            .map((r) => r.athlete),
        ),
      ],
    }));

  const satisfied = (x: Awaited<ReturnType<typeof read>>) =>
    x.score.human + x.score.opponents >= 1 &&
    x.contacts >= 3 &&
    x.touchers.some((a) => a === 'player' || a === 'teammate') &&
    x.touchers.some((a) => a.startsWith('opponent'));

  let s = await read();
  for (let i = 0; i < 200 && !satisfied(s); i += 1) {
    await page.keyboard.press(i % 2 === 0 ? 'e' : 'f');
    await page.waitForTimeout(280);
    if (i % 4 === 3) s = await read();
  }
  s = await read();

  // Rallies started and finished rather than the game seizing up.
  expect(s.score.human + s.score.opponents).toBeGreaterThanOrEqual(1);
  expect(s.contacts).toBeGreaterThanOrEqual(3);
  expect(['rally', 'point_scored', 'game_over']).toContain(s.phase);

  // The telling one: both sides touched the ball, so it really did cross the
  // net and come back rather than every rally dying on the first contact.
  expect(s.touchers.some((a) => a === 'player' || a === 'teammate')).toBe(true);
  expect(s.touchers.some((a) => a.startsWith('opponent'))).toBe(true);
});
