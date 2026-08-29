import { expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const COURT_WIDTH = 8;
const NET_Y = 8;

/**
 * The plainest thing a player does: open the page and expect to be able to
 * play. Every other test in this suite sets up its own rally first, which is
 * exactly why none of them noticed when nothing opened the first one and the
 * ball simply sat on the halfway line forever.
 */
test('the game is playable straight after loading, with no input at all', async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);

  // Give it a moment, then look: something has to be in play.
  await page.waitForFunction(
    () => {
      const g = window.__game!;
      return g.state.awaitingServe || g.state.ball.state !== 'dead';
    },
    undefined,
    { timeout: 3000 },
  );

  const s = await page.evaluate(() => ({
    ball: { ...window.__game!.state.ball.pos },
    ballState: window.__game!.state.ball.state,
    awaitingServe: window.__game!.state.awaitingServe,
    phase: window.__game!.state.phase,
  }));

  expect(s.phase).toBe('rally');
  expect(s.ballState).not.toBe('dead');
  // Specifically not parked on its reset position in the middle of the court.
  const atCentre = Math.abs(s.ball.x - COURT_WIDTH / 2) < 0.05 && Math.abs(s.ball.y - NET_Y) < 0.05;
  expect(atCentre).toBe(false);
});

test('play keeps going by itself after a point, without input', async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);

  // Nobody touches anything. Points still have to be decided and new rallies
  // opened, or the game would stall the first time a ball hits the sand.
  await page.waitForFunction(
    () => window.__game!.state.score.human + window.__game!.state.score.opponents >= 1,
    undefined,
    { timeout: 20000 },
  );
  await page.waitForFunction(
    () => window.__game!.state.score.human + window.__game!.state.score.opponents >= 2,
    undefined,
    { timeout: 20000 },
  );

  const s = await page.evaluate(() => ({
    ballState: window.__game!.state.ball.state,
    awaitingServe: window.__game!.state.awaitingServe,
    phase: window.__game!.state.phase,
  }));
  expect(['rally', 'point_scored']).toContain(s.phase);
  // And it is not left sitting dead with nobody about to serve.
  expect(s.awaitingServe || s.ballState !== 'dead' || s.phase === 'point_scored').toBe(true);
});
