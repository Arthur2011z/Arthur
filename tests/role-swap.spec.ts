import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Role swap. The set-up works in both directions now:
 *
 *   teammate touches a rally ball  -> sets the PLAYER up near the net
 *   player passes to the teammate  -> sets the TEAMMATE up near the net,
 *                                     and the teammate attacks off it
 *
 * On that attacking touch the teammate picks its own shot - the hard spike or
 * the safer attacking hit - from its position, the ball's height, and a roll,
 * aiming at the gap the opponents' formation leaves open.
 */

const NET_Y = 8;
const SET_NET_APPROACH_Y = 9.5;
const SET_NET_BLEND = 0.7;

async function setup(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    for (const o of g.state.opponents) o.update = () => {};
  });
}

/** Runs one player-pass -> teammate-attack exchange deterministically and
 * reports the teammate's resulting shot. `roll` pins the spike/hit choice. */
async function passThenAttack(
  page: Page,
  opts: { teammateY: number; ballHeight: number; roll: number },
) {
  return page.evaluate(({ teammateY, ballHeight, roll }) => {
    const g = (window as any).__game;
    for (const o of g.state.opponents) o.update = () => {};
    (window as any).__setRandom(() => roll);

    // Put the teammate where the pass would have delivered it, and hand it a
    // ball the player has just passed - that is what marks it as a set-up.
    g.state.player.pos.x = 4;
    g.state.player.pos.y = 14;
    g.state.teammate.pos.x = 5;
    g.state.teammate.pos.y = teammateY;
    g.state.teammate.state = 'moving_to_ball';

    // A flight whose height at contact is what we want to test: launched from
    // just beside the teammate, so contact happens on the first update.
    g.state.ball.launch(
      { x: 5, y: teammateY - 0.1 },
      { x: 5, y: teammateY + 0.1 },
      { duration: 3, peakHeight: 0, toucher: 'player' },
    );
    g.state.ball.target.y = 12; // aimed into our own half => a pass to us
    g.state.ball.height = ballHeight;

    g.state.teammate.update(
      0.016,
      g.state.ball,
      { pos: g.state.player.pos, state: 'active', hasPendingContactInput: false },
      false,
      g.state.opponents.map((o: any) => ({ ...o.pos })),
    );

    return {
      toucher: g.state.ball.lastToucher,
      target: { ...g.state.ball.target },
      duration: g.state.ball.duration,
      peakHeight: g.state.ball.peakHeight,
    };
  }, opts);
}

test.describe('Rollentausch: player sets, teammate attacks', () => {
  test('the player\'s Pass is aimed near the net, not at the teammate\'s feet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await setup(page);

    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      g.state.player.pos.x = 1;
      g.state.player.pos.y = 15;
      g.state.teammate.pos.x = 5.6;
      g.state.teammate.pos.y = 13;
      g.state.player.state = 'active';
      g.state.ball.launch({ x: 1, y: 14.8 }, { x: 1, y: 4 }, { duration: 5, peakHeight: 0.3, toucher: null });
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, block: false, hit: false };
      for (let i = 0; i < 5 && g.state.ball.lastToucher !== 'player'; i++) {
        g.state.player.update(0.016, { ...noInput, pass: true }, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(0.016);
      }
      return { target: { ...g.state.ball.target }, teammate: { ...g.state.teammate.pos }, toucher: g.state.ball.lastToucher };
    });

    expect(r.toucher).toBe('player');
    // Same column as the teammate - a pass never asks them to sprint sideways.
    expect(r.target.x).toBeCloseTo(r.teammate.x, 1);
    // ...but pulled toward the net, into an attacking position.
    const expectedY = r.teammate.y + (SET_NET_APPROACH_Y - r.teammate.y) * SET_NET_BLEND;
    expect(r.target.y).toBeCloseTo(expectedY, 1);
    expect(r.target.y).toBeLessThan(r.teammate.y);
    expect(r.target.y).toBeGreaterThan(NET_Y); // still our own side - it is a pass, not a hit
  });

  test('the teammate attacks off a player pass instead of setting back', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await passThenAttack(page, { teammateY: 9.5, ballHeight: 1.2, roll: 0.99 });
    expect(r.toucher).toBe('teammate');
    expect(r.target.y).toBeLessThan(NET_Y); // over the net - an attack, not a set
  });

  test('near the net with a high ball it spikes; the same ball low is only hit', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Roll below TEAMMATE_SPIKE_CHANCE (0.6) - so a spike whenever it is viable.
    const spiked = await passThenAttack(page, { teammateY: 9.5, ballHeight: 1.5, roll: 0.1 });
    // Struck 1.5m from the net => full-power spike parameters.
    expect(spiked.duration).toBeCloseTo(0.5, 2);
    expect(spiked.peakHeight).toBeCloseTo(1.2, 2);

    // Same spot, same roll, but the ball is too low to hit down on.
    const tooLow = await passThenAttack(page, { teammateY: 9.5, ballHeight: 0.3, roll: 0.1 });
    expect(tooLow.duration).toBeCloseTo(1.2, 2); // the safer attacking hit
    expect(tooLow.target.y).toBeLessThan(NET_Y); // still an attack over the net
  });

  test('too far from the net it never spikes, however lucky the roll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // 5m out - beyond TEAMMATE_SPIKE_MAX_NET_DISTANCE (3m).
    const r = await passThenAttack(page, { teammateY: 13, ballHeight: 1.5, roll: 0 });
    expect(r.duration).toBeCloseTo(1.2, 2); // attacking hit, not a spike
  });

  test('the shot choice is genuinely a roll - the same situation gives both', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const lucky = await passThenAttack(page, { teammateY: 9.5, ballHeight: 1.5, roll: 0.1 });
    const unlucky = await passThenAttack(page, { teammateY: 9.5, ballHeight: 1.5, roll: 0.9 });
    expect(lucky.duration).not.toBeCloseTo(unlucky.duration, 2);
  });

  test('the teammate\'s spike obeys the same distance-power rule as the player\'s', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // At the net (1m out): full power. Further back (3m, still spike range):
    // measurably weaker - the same ramp the human player's smash uses.
    const atNet = await passThenAttack(page, { teammateY: 9, ballHeight: 1.5, roll: 0.1 });
    const deeper = await passThenAttack(page, { teammateY: 11, ballHeight: 1.5, roll: 0.1 });

    expect(atNet.duration).toBeCloseTo(0.5, 2);
    expect(deeper.duration).toBeGreaterThan(atNet.duration);
  });

  test('the attack aims at the gap the opponents leave, not at a fixed spot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Crowd both opponents onto one side; the attack must go to the other.
    const aimLeft = await page.evaluate(() => {
      const g = (window as any).__game;
      (window as any).__setRandom(() => 0.99);
      g.state.opponents[0].pos.x = 7;
      g.state.opponents[0].pos.y = 6;
      g.state.opponents[1].pos.x = 7;
      g.state.opponents[1].pos.y = 2;
      g.state.teammate.pos.x = 4;
      g.state.teammate.pos.y = 9.5;
      g.state.teammate.state = 'moving_to_ball';
      g.state.ball.launch({ x: 4, y: 9.4 }, { x: 4, y: 9.6 }, { duration: 3, peakHeight: 0, toucher: 'player' });
      g.state.ball.target.y = 12;
      g.state.ball.height = 1.2;
      g.state.teammate.update(
        0.016,
        g.state.ball,
        { pos: { x: 4, y: 14 }, state: 'active', hasPendingContactInput: false },
        false,
        g.state.opponents.map((o: any) => ({ ...o.pos })),
      );
      return { ...g.state.ball.target };
    });
    expect(aimLeft.x).toBeLessThan(4); // away from the crowded right side

    // Mirror the formation; the attack must switch sides.
    const aimRight = await page.evaluate(() => {
      const g = (window as any).__game;
      (window as any).__setRandom(() => 0.99);
      g.state.opponents[0].pos.x = 1;
      g.state.opponents[0].pos.y = 6;
      g.state.opponents[1].pos.x = 1;
      g.state.opponents[1].pos.y = 2;
      g.state.teammate.pos.x = 4;
      g.state.teammate.pos.y = 9.5;
      g.state.teammate.state = 'moving_to_ball';
      g.state.ball.launch({ x: 4, y: 9.4 }, { x: 4, y: 9.6 }, { duration: 3, peakHeight: 0, toucher: 'player' });
      g.state.ball.target.y = 12;
      g.state.ball.height = 1.2;
      g.state.teammate.update(
        0.016,
        g.state.ball,
        { pos: { x: 4, y: 14 }, state: 'active', hasPendingContactInput: false },
        false,
        g.state.opponents.map((o: any) => ({ ...o.pos })),
      );
      return { ...g.state.ball.target };
    });
    expect(aimRight.x).toBeGreaterThan(4);
  });

  test('a ball that is NOT a player pass is still set to the player, not attacked', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // The other direction of the swap, unchanged: an ordinary rally ball
    // (from the opponents) is set up for the player to attack.
    const r = await page.evaluate(() => {
      const g = (window as any).__game;
      for (const o of g.state.opponents) o.update = () => {};
      (window as any).__setRandom(() => 0.99);
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 14;
      g.state.teammate.pos.x = 5;
      g.state.teammate.pos.y = 11;
      g.state.teammate.state = 'moving_to_ball';
      g.state.ball.launch({ x: 5, y: 10.9 }, { x: 5, y: 11.1 }, { duration: 3, peakHeight: 0, toucher: 'opponent1' });
      g.state.ball.height = 1.2;
      g.state.teammate.update(
        0.016,
        g.state.ball,
        { pos: g.state.player.pos, state: 'active', hasPendingContactInput: false },
        false,
        g.state.opponents.map((o: any) => ({ ...o.pos })),
      );
      return { target: { ...g.state.ball.target }, toucher: g.state.ball.lastToucher, player: { ...g.state.player.pos } };
    });

    expect(r.toucher).toBe('teammate');
    expect(r.target.y).toBeGreaterThan(NET_Y); // stayed on our side - a set
    expect(r.target.x).toBeCloseTo(r.player.x, 1); // toward the player
    const expectedY = r.player.y + (SET_NET_APPROACH_Y - r.player.y) * SET_NET_BLEND;
    expect(r.target.y).toBeCloseTo(expectedY, 1);
  });
});
