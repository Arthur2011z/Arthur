import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The opponents defend better - and ONLY defend better.
 *
 *   OPPONENT_DEFENSIVE_SPEED    5.5 m/s scramble for hard incoming balls
 *                               (cruising OPPONENT_SPEED 3.8 otherwise)
 *   OPPONENT_HARD_BALL_DURATION 1.2s - what counts as hard
 *   OPPONENT_READY_SHADE        0.6 - shade toward a developing attack
 *
 * Their attack is deliberately untouched: same error rate, same attack rate,
 * same shot parameters, so they stay just as beatable when they are the ones
 * hitting. The last test here pins that down.
 */

const NET_Y = 8;
const DT = 0.016;
const OPPONENT_SPEED = 3.8;
const OPPONENT_DEFENSIVE_SPEED = 5.5;

/** One frame of chase against a ball of the given flight duration, returning
 * how far the defender moved. The ball is kept well out of reach so the frame
 * is pure movement, not a contact. */
async function chaseStep(page: Page, ballDuration: number): Promise<number> {
  return page.evaluate(
    ({ ballDuration, DT }) => {
      const g = (window as any).__game;
      const o = g.state.opponents[0];
      o.pos.x = 4;
      o.pos.y = 6;
      o.state = 'moving_to_ball';
      // Target 3m away in their own half; the ball itself is far off and high,
      // so no contact can fire on this frame.
      g.state.ball.launch({ x: 4, y: 7.9 }, { x: 4, y: 3 }, { duration: ballDuration, peakHeight: 3, toucher: 'player' });
      const before = { ...o.pos };
      o.update(DT, g.state.ball, true);
      return Math.hypot(o.pos.x - before.x, o.pos.y - before.y);
    },
    { ballDuration, DT },
  );
}

test.describe('Gegner-KI: better defence, unchanged attack', () => {
  test('a hard incoming ball is scrambled for, not cruised at', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A spike at the net (0.5s) and a fully-weakened one (1.1s) are both hard.
    for (const duration of [0.5, 1.1]) {
      const moved = await chaseStep(page, duration);
      expect(moved).toBeCloseTo(OPPONENT_DEFENSIVE_SPEED * DT, 4);
    }
  });

  test('a normal-paced ball is still covered at cruising speed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A normal return (1.9s) and a serve (2.2s) are not scrambles.
    for (const duration of [1.9, 2.2]) {
      const moved = await chaseStep(page, duration);
      expect(moved).toBeCloseTo(OPPONENT_SPEED * DT, 4);
    }
  });

  test('defenders shade toward a developing attack, and return to the zone centre after', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      const net = g.state.opponents.find((o: any) => o.zone === 'net');
      const home = { ...net.homePos };

      // Ball live on the HUMAN side, far to the right: an attack is building.
      net.pos.x = home.x;
      net.pos.y = home.y;
      net.state = 'home';
      g.state.ball.launch({ x: 7.5, y: 12 }, { x: 7.5, y: 10 }, { duration: 2, peakHeight: 2, toucher: 'teammate' });
      for (let i = 0; i < 60; i++) net.update(0.016, g.state.ball, false);
      const shaded = { ...net.pos };

      // Ball dead: back to the zone centre.
      g.state.ball.state = 'idle';
      for (let i = 0; i < 120; i++) net.update(0.016, g.state.ball, false);
      const settled = { ...net.pos };

      return { home, shaded, settled };
    });

    expect(r.shaded.x).toBeGreaterThan(r.home.x); // moved toward the attack
    expect(r.shaded.y).toBeCloseTo(r.home.y, 3); // ...but only sideways - the zone split is intact
    expect(r.settled.x).toBeCloseTo(r.home.x, 1); // and back home afterwards
  });

  test('a hard spike into the deep corner is now dug up', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // (2.5, 1) at full spike pace used to land untouched for a point; with the
    // scramble speed and the anticipatory shading it is reached.
    const returned = await page.evaluate(() => {
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      g.state.teammate.update = () => {};
      g.state.player.update = () => {};
      (window as any).__setRandom(() => 0.5); // opponents play a plain return
      g.state.awaitingServe = null;
      g.state.phase = 'playing';

      // Set-up phase on the human side, so the defenders can read the attack.
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.ball.launch({ x: 4, y: 12 }, { x: 4, y: 9.2 }, { duration: 1, peakHeight: 2.5, toucher: 'teammate' });
      for (let i = 0; i < 62; i++) g.state.update(0.016, noInput);

      // Full-power spike into the deep corner.
      g.state.ball.launch({ x: 4, y: 8.6 }, { x: 2.5, y: 1 }, { duration: 0.5, peakHeight: 1.2, toucher: 'player' });
      for (let i = 0; i < 300; i++) {
        g.state.update(0.016, noInput);
        if (String(g.state.ball.lastToucher).startsWith('opponent')) return true;
        if (g.state.ball.state === 'idle') return false;
      }
      return false;
    });

    expect(returned).toBe(true);
  });

  test('a well-placed hard spike can still beat them - defence is better, not a wall', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // The extreme corner remains a genuine winner, so the spike stays worth
    // playing. If this ever starts passing as "returned", the defence has been
    // pushed too far.
    const returned = await page.evaluate(() => {
      const g = (window as any).__game;
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      g.state.teammate.update = () => {};
      g.state.player.update = () => {};
      (window as any).__setRandom(() => 0.5);
      g.state.awaitingServe = null;
      g.state.phase = 'playing';

      g.state.player.pos.x = 4;
      g.state.player.pos.y = 9;
      g.state.ball.launch({ x: 4, y: 12 }, { x: 4, y: 9.2 }, { duration: 1, peakHeight: 2.5, toucher: 'teammate' });
      for (let i = 0; i < 62; i++) g.state.update(0.016, noInput);

      g.state.ball.launch({ x: 4, y: 8.6 }, { x: 1, y: 1 }, { duration: 0.5, peakHeight: 1.2, toucher: 'player' });
      for (let i = 0; i < 300; i++) {
        g.state.update(0.016, noInput);
        if (String(g.state.ball.lastToucher).startsWith('opponent')) return true;
        if (g.state.ball.state === 'idle') return false;
      }
      return false;
    });

    expect(returned).toBe(false);
  });

  test('their ATTACK is untouched: same three branches, same shot parameters', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const shot = (roll: number) =>
      page.evaluate((roll) => {
        const g = (window as any).__game;
        (window as any).__setRandom(() => roll);
        const o = g.state.opponents[0];
        o.pos.x = 4;
        o.pos.y = 4;
        o.state = 'moving_to_ball';
        g.state.ball.launch({ x: 4, y: 3.95 }, { x: 4, y: 4.05 }, { duration: 3, peakHeight: 0, toucher: 'player' });
        g.state.ball.height = 0.5;
        o.update(0.016, g.state.ball, true);
        return { duration: g.state.ball.duration, target: { ...g.state.ball.target } };
      }, roll);

    // Below OPPONENT_ERROR_CHANCE (0.15): the mechanical error that nets out
    // on their own side. Still there - they stay error-prone.
    const errored = await shot(0);
    expect(errored.duration).toBeCloseTo(0.22, 3);
    expect(errored.target.y).toBeLessThan(NET_Y);

    // Between error and error+attack (0.40): the aggressive attack, unchanged
    // pace.
    const attacked = await shot(0.2);
    expect(attacked.duration).toBeCloseTo(0.6, 3);
    expect(attacked.target.y).toBeGreaterThan(NET_Y);

    // Above that: the safe default return, unchanged pace.
    const normal = await shot(0.99);
    expect(normal.duration).toBeCloseTo(1.9, 3);
    expect(normal.target.y).toBeGreaterThan(NET_Y);
  });
});
