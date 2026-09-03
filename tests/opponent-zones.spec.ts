import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The opponent half is split into a net zone and a back zone, one defender
 * each (mirroring the human side's split). Each holds the centre of its own
 * zone, goes for the ball when it lands in that zone, and returns to that
 * base afterwards - so their movement always has a visible relationship to
 * where the ball is going, instead of whichever of the two happened to be
 * marginally nearer darting across the court on every ball.
 */

const NET_Y = 8;
const ZONE_SPLIT_Y = NET_Y / 2; // OPPONENT_ZONE_SPLIT_Y

async function stubHumanSide(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.state.player.update = () => {};
    g.state.teammate.update = () => {};
    (window as any).__setRandom(() => 0.99); // safe default return, never error/attack
  });
}

async function launch(page: Page, to: { x: number; y: number }, duration = 2) {
  await page.evaluate(
    ({ to, duration }) => {
      (window as any).__game.state.ball.launch({ x: 4, y: 8 }, to, { duration, peakHeight: 3, toucher: null });
    },
    { to, duration },
  );
}

async function opponents(page: Page) {
  return page.evaluate(() =>
    (window as any).__game.state.opponents.map((o: any) => ({
      zone: o.zone,
      state: o.state,
      pos: { ...o.pos },
      homePos: { ...o.homePos },
    })),
  );
}

test.describe('Gegner-KI: zone-based positioning', () => {
  test('the two opponents cover one zone each, resting at its centre', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const os = await opponents(page);
    expect(os.map((o: any) => o.zone).sort()).toEqual(['back', 'net']);

    const net = os.find((o: any) => o.zone === 'net');
    const back = os.find((o: any) => o.zone === 'back');

    // Each resting in its own zone, and inside the opponent half.
    expect(net.homePos.y).toBeGreaterThanOrEqual(ZONE_SPLIT_Y);
    expect(back.homePos.y).toBeLessThan(ZONE_SPLIT_Y);
    for (const o of os) {
      expect(o.homePos.y).toBeGreaterThan(0);
      expect(o.homePos.y).toBeLessThan(NET_Y);
      expect(o.pos).toEqual(o.homePos); // starts on its base
    }

    // Genuinely split by depth, not both standing at the same line.
    expect(net.homePos.y - back.homePos.y).toBeGreaterThan(2);
  });

  test('a ball landing deep is taken by the back defender; the net defender holds its zone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubHumanSide(page);

    await launch(page, { x: 2.5, y: 1.5 });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent2', undefined, {
      timeout: 3000,
    });

    const os = await opponents(page);
    const net = os.find((o: any) => o.zone === 'net');
    expect(net.state).toBe('home');
    expect(net.pos).toEqual(net.homePos); // never left its base
  });

  test('a ball landing at the net is taken by the net defender; the back defender holds its zone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubHumanSide(page);

    await launch(page, { x: 2.5, y: 6 });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent1', undefined, {
      timeout: 3000,
    });

    const os = await opponents(page);
    const back = os.find((o: any) => o.zone === 'back');
    expect(back.state).toBe('home');
    expect(back.pos).toEqual(back.homePos);
  });

  test('responsibility follows the zone line, not raw proximity', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    // Two landing spots 0.6m apart, straddling the zone line. Which defender
    // reacts must flip between them - that is the zone rule doing the work.
    for (const [y, expected] of [
      [ZONE_SPLIT_Y + 0.3, 'opponent1'],
      [ZONE_SPLIT_Y - 0.3, 'opponent2'],
    ] as [number, string][]) {
      await page.goto(distIndex);
      await stubHumanSide(page);
      await launch(page, { x: 4, y });
      await page.waitForFunction(
        (e) => (window as any).__game.state.ball.lastToucher === e,
        expected,
        { timeout: 3000 },
      );
    }
  });

  test('the override margin lets the wrong-zone defender take a ball it is standing right on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubHumanSide(page);

    // Lands just inside the NET zone - normally opponent1's - but with the
    // back defender parked right on the spot and the net defender pulled far
    // away. The margin (1.5m) must hand it to the back defender rather than
    // send the net defender on an absurd cross-court run.
    await page.evaluate(
      ({ y }) => {
        const g = (window as any).__game;
        const net = g.state.opponents.find((o: any) => o.zone === 'net');
        const back = g.state.opponents.find((o: any) => o.zone === 'back');
        net.pos.x = 7.5;
        net.pos.y = 7.5; // far corner, ~5m from the landing spot
        back.pos.x = 2.5;
        back.pos.y = y; // standing exactly on it
        g.state.ball.launch({ x: 4, y: 8 }, { x: 2.5, y }, { duration: 2, peakHeight: 3, toucher: null });
      },
      { y: ZONE_SPLIT_Y + 0.2 },
    );

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent2', undefined, {
      timeout: 3000,
    });
  });

  test('after playing the ball, the defender returns to its own zone base', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubHumanSide(page);

    await launch(page, { x: 1, y: 1.5 });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'opponent2', undefined, {
      timeout: 3000,
    });

    await page.waitForFunction(
      () => {
        const back = (window as any).__game.state.opponents.find((o: any) => o.zone === 'back');
        return back.state === 'home';
      },
      undefined,
      { timeout: 4000 },
    );

    const os = await opponents(page);
    const back = os.find((o: any) => o.zone === 'back');
    expect(back.pos).toEqual(back.homePos);
  });

  test('the chasing defender closes on the landing spot instead of wandering', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubHumanSide(page);

    // Deep corner, slow enough to sample the approach several times.
    await launch(page, { x: 1, y: 1 }, 3);

    const samples: number[] = [];
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(120);
      const d = await page.evaluate(() => {
        const g = (window as any).__game;
        const back = g.state.opponents.find((o: any) => o.zone === 'back');
        return Math.hypot(back.pos.x - g.state.ball.target.x, back.pos.y - g.state.ball.target.y);
      });
      samples.push(d);
    }

    // Distance to the landing spot only ever shrinks - never a step away
    // from where the ball is actually going.
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeLessThanOrEqual(samples[i - 1] + 1e-6);
    }
    expect(samples[samples.length - 1]).toBeLessThan(samples[0]);
  });
});
