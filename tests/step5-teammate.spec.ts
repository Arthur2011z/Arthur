import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos } },
      teammate: { pos: { ...g.state.teammate.pos }, home: { ...g.state.teammate.homePos }, state: g.state.teammate.state },
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
    };
  });
}

async function launchBall(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, duration: number) {
  await page.evaluate(
    ({ from, to, duration }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight: 3, toucher: null });
    },
    { from, to, duration },
  );
}

async function teleportPlayer(page: Page, pos: { x: number; y: number }) {
  await page.evaluate((pos) => {
    const g = (window as any).__game;
    g.state.player.pos.x = pos.x;
    g.state.player.pos.y = pos.y;
  }, pos);
}

test.describe('Step 5: AI teammate home/base logic', () => {
  test('stays home while the ball is far away and unrelated', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    // Well outside TEAMMATE_REACT_RADIUS (2.5m) of the teammate's home the whole flight.
    await launchBall(page, { x: 1, y: 15 }, { x: 1.5, y: 14 }, 1);
    await page.waitForTimeout(1200);

    const after = await getState(page);
    expect(after.teammate.state).toBe('home');
    expect(after.teammate.pos).toEqual(before.teammate.home);
  });

  test('intercepts a slow ball passing near home and sets it up high to the player', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    const home = before.teammate.home;
    // A slow, straight flight passing directly through the teammate's home
    // position at its midpoint - reached with plenty of time still remaining,
    // so this should NOT trigger the emergency-save branch.
    await launchBall(page, { x: home.x, y: home.y - 6 }, { x: home.x, y: home.y + 6 }, 3);

    await page.waitForFunction(() => (window as any).__game.state.teammate.state === 'moving_to_ball', undefined, {
      timeout: 3000,
    });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 3000,
    });

    const afterContact = await getState(page);
    expect(afterContact.ball.state).toBe('flying');
    // Sets toward the human player, not a low emergency save over the net -
    // but (see Problem 2 fix) blended toward the net rather than landing
    // exactly on the player's own position, so the x stays put while y is
    // pulled some of the way toward TEAMMATE_SET_NET_APPROACH_Y.
    const expectedY = before.player.pos.y + (9.5 - before.player.pos.y) * 0.7; // TEAMMATE_SET_NET_APPROACH_Y / TEAMMATE_SET_NET_BLEND
    expect(afterContact.ball.target.x).toBeCloseTo(before.player.pos.x, 0);
    expect(afterContact.ball.target.y).toBeCloseTo(expectedY, 1);
    expect(afterContact.ball.target.y).toBeLessThan(before.player.pos.y); // pulled toward the net, not left where the player stood
  });

  test('self-sets an emergency save when the ball arrives too fast/direct', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    const home = before.teammate.home;
    // Fired directly at the teammate's exact position, fast - contact happens
    // with very little flight time left.
    await launchBall(page, { x: home.x, y: home.y - 3 }, { x: home.x, y: home.y }, 0.6);

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 2000,
    });

    const afterContact = await getState(page);
    expect(afterContact.ball.state).toBe('flying');
    // Emergency save always goes over the net into the opponent half.
    expect(afterContact.ball.target.y).toBeLessThan(8);

    // And afterwards it heads for the NET, not back to base: it has just put
    // the ball over, so by definition an attack is now being built against us
    // and the teammate goes to block it (see TeammateAI's 'to_net').
    await page.waitForFunction(() => (window as any).__game.state.teammate.state === 'to_net', undefined, {
      timeout: 3000,
    });
    await page.waitForFunction(() => (window as any).__game.state.teammate.pos.y <= 8.6, undefined, {
      timeout: 3000,
    });
    const afterSave = await getState(page);
    expect(afterSave.teammate.pos.y).toBeLessThan(home.y); // genuinely moved up
  });

  test('bugfix: a normal-paced pass from across the court is never misread as an emergency', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // A real Pass button press from a realistic distance away from the
    // teammate: PASS_DURATION (0.7s) is a routine, un-hurried touch by the
    // ball's own speed, but because the flight is aimed squarely at the
    // teammate's position, contact used to happen right as it arrived - low
    // timeRemaining at that instant, which the old timeRemaining-based check
    // misread as "arrived too fast" purely because of the travel distance,
    // not the ball's actual speed. Set()-ing to the player must still be the
    // outcome regardless of how far the pass had to travel.
    await page.evaluate(() => {
      const g = (window as any).__game;
      g.state.player.pos.x = 4;
      g.state.player.pos.y = 15;
      g.state.teammate.pos.x = 4;
      g.state.teammate.pos.y = 10; // 5m from the player - well beyond a short pass
      g.state.teammate.state = 'home';
      // A ball at the player's feet rather than one leaving on a 3m arc:
      // contact now needs the two hitboxes to actually overlap, and an arc
      // lifts the ball out of the player's hitbox within a few frames - long
      // before a real button click lands.
      g.state.ball.height = 0;
      g.state.ball.launch({ x: 4, y: 15 }, { x: 4, y: 15.1 }, { duration: 6, peakHeight: 0.08, toucher: null });
      // Pin the shot choice to the safe attacking hit, so this test is about
      // the emergency misread and not about the spike/hit roll.
      (window as any).__setRandom(() => 0.99);
    });

    const passBtn = page.locator('#pass-btn');
    const box = await passBtn.boundingBox();
    if (!box) throw new Error('pass button not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 3000,
    });

    // The player set the teammate up, so the teammate now ATTACKS off it
    // (role swap) rather than setting straight back. What this test still
    // guards is the original bug: a long-but-normal-paced pass must not be
    // misread as "arrived too fast" and thrown away as an emergency save.
    const after = await page.evaluate(() => {
      const g = (window as any).__game;
      return { target: { ...g.state.ball.target }, duration: g.state.ball.duration };
    });
    expect(after.target.y).toBeLessThan(8); // a real attack over the net
    expect(after.duration).toBeCloseTo(1.2, 2); // TEAMMATE_ATTACK_HIT_DURATION...
    expect(after.duration).not.toBeCloseTo(0.8, 2); // ...not the emergency save (0.8s)
  });

  test('dynamically covers the back zone when the player is up at the net', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 4, y: 9 }); // right at the net
    await page.waitForTimeout(1500); // plenty of time to drift to the new base

    const after = await getState(page);
    expect(after.teammate.state).toBe('home');
    expect(after.teammate.home.y).toBeGreaterThan(12); // back zone (y >= ZONE_SPLIT_Y)
    expect(after.teammate.pos).toEqual(after.teammate.home);
  });

  test('dynamically covers the net zone when the player is pulled back deep', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 4, y: 15 }); // deep baseline
    await page.waitForTimeout(1500);

    const after = await getState(page);
    expect(after.teammate.state).toBe('home');
    expect(after.teammate.home.y).toBeLessThan(12); // net zone (y < ZONE_SPLIT_Y)
    expect(after.teammate.pos).toEqual(after.teammate.home);
  });
});
