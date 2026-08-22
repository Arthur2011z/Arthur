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
 * in the opponent half - geometrically outside HIT_RANGE of both opponents'
 * homes the whole flight (same proven-safe centerline trick as step6). */
async function winRallyForHuman(page: Page) {
  await launchBall(page, { x: 4, y: 8 }, { x: 4, y: 0.3 }, 0.5);
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

async function tapAttack(page: Page) {
  const btn = page.locator('#attack-btn');
  const box = await btn.boundingBox();
  if (!box) throw new Error('attack button not found');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Refine 5: real serve system', () => {
  test('holding human serve: the ball follows the player until Schlag sends it over', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await winRallyForHuman(page);

    const held = await getState(page);
    expect(held.ball.state).toBe('idle');
    expect(held.ball.pos).toEqual(held.player.pos);

    // Free movement still works, and the ball follows.
    await dragJoystick(page, 40, 0, 300);
    const afterMove = await getState(page);
    expect(afterMove.player.pos.x).toBeGreaterThan(held.player.pos.x);
    expect(afterMove.ball.pos).toEqual(afterMove.player.pos);

    await tapAttack(page);
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
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

    await page.waitForFunction(() => (window as any).__game.state.awaitingServe === null, undefined, {
      timeout: 8000,
    });
    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    expect(after.ball.lastToucher).toBe('player');
  });

  test('the opponent (bootstrap) serve visibly originates from an opponent, not the net center', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    const opponent1Home = before.opponents[0];

    await page.waitForFunction(() => (window as any).__game.state.ball.state === 'flying', undefined, {
      timeout: 3000,
    });
    const after = await getState(page);

    const dist = Math.hypot(after.ball.pos.x - opponent1Home.x, after.ball.pos.y - opponent1Home.y);
    expect(dist).toBeLessThan(1);
  });
});
