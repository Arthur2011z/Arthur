import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos } },
      ball: {
        pos: { ...g.state.ball.pos },
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
      phase: g.state.phase,
      awaitingServe: g.state.awaitingServe,
      opponents: g.state.opponents.map((o: any) => ({ ...o.pos })),
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

/** Wins a rally for the human team via a trajectory that lands untouched deep
 * in the opponent half. Aimed at the far baseline corner: that is the back
 * defender's zone, but its base (5.2, 2) is ~4.9m away and this flight is over
 * in 0.5s, so it cannot possibly get there - whereas the old centreline target
 * (4, 0.3) sits only ~2.1m from that base and IS now reachable. */
async function winRallyForHuman(page: Page) {
  await launchBall(page, { x: 4, y: 8 }, { x: 0.5, y: 0.5 }, 0.5);
  await page.waitForFunction(() => (window as any).__game.state.awaitingServe === 'human', undefined, {
    timeout: 3000,
  });
}

async function dragJoystick(page: Page, dx: number, dy: number, holdMs: number) {
  const zone = page.locator('#joystick-hitzone');
  const box = await zone.boundingBox();
  if (!box) throw new Error('joystick hit-zone not found');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 5 });
  await page.waitForTimeout(holdMs);
  await page.mouse.up();
}

async function tapServe(page: Page) {
  const btn = page.locator('#serve-btn');
  const box = await btn.boundingBox();
  if (!box) throw new Error('serve button not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Refine 5: real serve system', () => {
  test('holding human serve: the ball follows the player until the Aufschlag button sends it over', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await winRallyForHuman(page);

    const held = await getState(page);
    expect(held.ball.state).toBe('idle');
    expect(held.ball.pos).toEqual(held.player.pos);

    // Sideways movement along the baseline still works, and the ball follows.
    // (Forward movement no longer does - see serve-system.spec.ts.)
    await dragJoystick(page, 40, 0, 300);
    const afterMove = await getState(page);
    expect(afterMove.player.pos.x).toBeGreaterThan(held.player.pos.x);
    expect(afterMove.ball.pos).toEqual(afterMove.player.pos);

    // The serve is now its own routine - toss, jump, aim window, strike - so
    // the press starts it rather than launching the ball outright.
    await tapServe(page);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 5000,
    });
    const afterServe = await getState(page);
    expect(afterServe.awaitingServe).toBeNull();
    expect(afterServe.ball.state).toBe('flying');
    expect(afterServe.ball.target.y).toBeLessThan(8); // headed toward the opponent half
  });

  test('an un-served human serve auto-fires after the fallback timeout', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await winRallyForHuman(page);

    // The fallback now starts the routine exactly as a press would, so the
    // strike lands ~1.7s after the 5s timeout rather than instantly.
    await page.waitForFunction(() => (window as any).__game.state.awaitingServe === null, undefined, {
      timeout: 12000,
    });
    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    expect(after.ball.lastToucher).toBe('player');
  });

  test('the opponent (bootstrap) serve visibly originates from an opponent, not the net center', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Served by the back-zone defender - the one actually standing deep -
    // rather than whoever happens to be holding the net.
    const before = await getState(page);
    const serverHome = before.opponents[1];

    await page.waitForFunction(() => (window as any).__game.state.ball.state === 'flying', undefined, {
      timeout: 3000,
    });
    const after = await getState(page);

    const dist = Math.hypot(after.ball.pos.x - serverHome.x, after.ball.pos.y - serverHome.y);
    expect(dist).toBeLessThan(1);
  });
});
