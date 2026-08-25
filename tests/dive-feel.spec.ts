import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The dive is defined by its SPEED, not by a fixed duration.
 *
 * It used to run for a flat 0.22s no matter how far it went, so the dash speed
 * fell away with the distance covered: a 0.8m dive crawled at 3.6 m/s - slower
 * than simply walking there (PLAYER_SPEED 4.5) - and a 0.3m one at 1.4 m/s.
 * Since most dives are short, the move almost always felt limp.
 *
 * Now: constant DIVE_SPEED, a cubic ease-out so the motion is front-loaded
 * into a sharp launch, and a low visual hop so it reads as leaving the ground.
 */

const PLAYER_SPEED = 4.5; // mirror src/game/constants.ts

/** Runs a dive of `gap` metres to completion and reports its dynamics. The
 * ball's flight PATH passes `gap` metres in front of the player (so the dive
 * target sits exactly that far away) while its live position stays 40m off to
 * the side - so the dash runs its full course without ever making contact,
 * which is what these measurements are about. */
async function diveDynamics(page: Page, gap: number) {
  return page.evaluate((gap) => {
    const g = (window as any).__game;
    g.state.teammate.update = () => {};
    for (const o of g.state.opponents) o.update = () => {};
    const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, dive: false, hit: false };
    const step = (i = noInput) => {
      g.state.player.update(0.016, i, g.state.ball, g.state.teammate.pos, false);
      g.state.ball.update(0.016);
    };

    const startY = 12;
    g.state.player.pos.x = 4;
    g.state.player.pos.y = startY;
    g.state.player.state = 'active';
    g.state.ball.launch(
      { x: -40, y: startY - gap },
      { x: 40, y: startY - gap },
      { duration: 600, peakHeight: 1, toucher: null },
    );

    step({ ...noInput, dive: true });

    const travelled: number[] = [];
    let frames = 0;
    let peakSpeed = 0;
    let maxHeight = 0;
    let prevY = g.state.player.pos.y;
    while (g.state.player.state === 'diving' && frames < 200) {
      step();
      frames++;
      const y = g.state.player.pos.y;
      peakSpeed = Math.max(peakSpeed, (prevY - y) / 0.016);
      maxHeight = Math.max(maxHeight, g.state.player.height);
      travelled.push(startY - y);
      prevY = y;
    }

    const total = startY - g.state.player.pos.y;
    const quarter = travelled[Math.max(0, Math.floor(travelled.length / 4) - 1)];
    return {
      total,
      duration: frames * 0.016,
      peakSpeed,
      maxHeight,
      firstQuarterFraction: quarter / total,
      endHeight: g.state.player.height,
      endState: g.state.player.state,
    };
  }, gap);
}

test.describe('Hechten: a sharp lunge, not a slide', () => {
  test('a dive is much faster than running, at every realistic distance', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    for (const gap of [0.8, 1.2, 1.8]) {
      const d = await diveDynamics(page, gap);
      expect(d.total).toBeCloseTo(gap, 1); // it did arrive
      // The old fixed-duration dive peaked at 3.6 / 5.5 / 8.2 m/s for these.
      expect(d.peakSpeed).toBeGreaterThan(PLAYER_SPEED * 3);
    }
  });

  test('short dives are no longer slower than walking - the old failure case', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A 0.8m dive used to average 3.6 m/s, i.e. below PLAYER_SPEED: diving was
    // literally slower than walking over. That is what made it feel limp.
    const d = await diveDynamics(page, 0.8);
    expect(d.total / d.duration).toBeGreaterThan(PLAYER_SPEED);
  });

  test('the motion is front-loaded - a launch, not an even glide', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Linear interpolation covers 25% of the way in the first quarter of the
    // time. The cubic ease-out covers well over half.
    for (const gap of [1.2, 1.8]) {
      const d = await diveDynamics(page, gap);
      expect(d.firstQuarterFraction).toBeGreaterThan(0.4);
    }
  });

  test('a dive leaves the ground and lands again', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const d = await diveDynamics(page, 1.2);
    expect(d.maxHeight).toBeGreaterThan(0.2); // a visible hop
    expect(d.endHeight).toBe(0); // back on the ground when it ends
    expect(d.endState).toBe('recovering'); // and into the recovery pause
  });

  test('longer dives take longer, because the speed is what is fixed', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const short = await diveDynamics(page, 1.2);
    const long = await diveDynamics(page, 1.8);
    expect(long.duration).toBeGreaterThan(short.duration);
    // ...but both stay brief - this is an impulse, not a journey.
    expect(long.duration).toBeLessThan(0.35);
  });

  test('the hop is purely visual and never affects contact', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Mid-dive, at the top of the hop, a ball in range must still be played -
    // the player's own height is not part of any contact condition.
    const result = await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.teammate.update = () => {};
      for (const o of g.state.opponents) o.update = () => {};
      const noInput = { move: { x: 0, y: 0 }, swipe: null, jump: false, spike: false, pass: false, dive: false, hit: false };
      const step = (i = noInput) => {
        g.state.player.update(0.016, i, g.state.ball, g.state.teammate.pos, false);
        g.state.ball.update(0.016);
      };

      g.state.player.pos.x = 4;
      g.state.player.pos.y = 11.5;
      g.state.player.state = 'active';
      // Ball sitting right on the dive's path, low.
      g.state.ball.launch({ x: 4, y: 10.6 }, { x: 4, y: 10.6 }, { duration: 30, peakHeight: 0.3, toucher: null });

      step({ ...noInput, dive: true });
      let airborneAtContact = 0;
      for (let i = 0; i < 40; i++) {
        const h = g.state.player.height;
        step();
        if (g.state.ball.lastToucher === 'player') {
          airborneAtContact = h;
          break;
        }
      }
      return { toucher: g.state.ball.lastToucher, airborneAtContact };
    });

    expect(result.toucher).toBe('player'); // contact happened mid-hop
    expect(result.airborneAtContact).toBeGreaterThan(0); // and the player was off the ground
  });
});
