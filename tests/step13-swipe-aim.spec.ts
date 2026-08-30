import { CDPSession, Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * The touch aiming gesture, driven with real touch events.
 *
 * This path had no coverage at all and had rotted: every other spike test
 * presses keys, and on the keyboard the *second* Q swings. On touch the only
 * thing that swings is the release of the aiming swipe, so once the gesture
 * stopped arriving, touch players lost the attack entirely - with no failing
 * test anywhere. These drive the browser the way a thumb does: CDP touch
 * events, on the real built page, reading the same debug log the game writes
 * for a human player.
 */

declare global {
  interface Window {
    /** Ball velocity captured the instant the player struck it. */
    __hitVel: { x: number; y: number; z: number } | null;
    __hitWatch: number;
  }
}

/** A fresh touch id per gesture: reusing one makes the browser treat the next
 * touchStart as a continuation of the previous gesture. */
let nextTouchId = 1;

async function gesture(
  cdp: CDPSession,
  page: Page,
  from: { x: number; y: number },
  dragPx: number,
): Promise<void> {
  const id = (nextTouchId += 1);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', y: number) =>
    cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: from.x, y, id }],
    });
  await send('touchStart', from.y);
  for (let d = 20; d <= dragPx; d += 20) {
    await send('touchMove', from.y - d);
    await page.waitForTimeout(25);
  }
  await send('touchEnd', from.y - dragPx);
}

/** Ball hanging above the player, ready to be attacked, nothing else moving. */
async function prepare(page: Page): Promise<void> {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.awaitingServe = false;
    g.state.aiEnabled = false;
    g.state.phase = 'rally';
    g.state.lastEvent = null;
    g.state.player.resetForNewRally();
    g.state.player.pos = { x: 4, y: 11 };
    g.state.rally.possession = 'human';
    g.state.rally.touches = 0;
    g.state.rally.lastToucher = 'teammate';
    g.state.ball.strike({ x: 4, y: 11, z: 5.2 }, { x: 0, y: 0, z: 0 }, 'teammate');
    g.debug.clear();

    // Snapshot the ball the instant it is struck. Reading its velocity after
    // the flight would measure a ball lying in the sand, which is how the
    // first version of this test managed to compare 0 against 0.
    window.__hitVel = null;
    window.clearInterval(window.__hitWatch);
    window.__hitWatch = window.setInterval(() => {
      if (window.__hitVel === null && g.state.ball.lastToucher === 'player') {
        window.__hitVel = { ...g.state.ball.vel };
      }
    }, 4);
  });
}

interface Attempt {
  stages: string[];
  contacts: { athlete: string; latencyMs: number }[];
  /** Ball speed the moment after it was struck. */
  speed: number;
  /** Court-space direction the ball left in. */
  vel: { x: number; y: number; z: number };
  aim: { dirX: number; dirY: number; strength?: number } | null;
}

async function spike(page: Page, cdp: CDPSession, dragPx: number, onButton = false): Promise<Attempt> {
  await prepare(page);

  const btn = (await page.locator('#jump-btn').boundingBox())!;
  const centre = { x: btn.x + btn.width / 2, y: btn.y + btn.height / 2 };
  await gesture(cdp, page, centre, 0); // tap to jump
  await page.waitForFunction(() => window.__game!.state.player.jumping, undefined, {
    timeout: 2000,
  });

  if (dragPx > 0 || onButton) {
    await gesture(cdp, page, onButton ? centre : { x: 210, y: 420 }, dragPx);
  }

  // Let the swing meet the ball, or not.
  await page.waitForTimeout(1500);

  return page.evaluate(() => {
    const recs = window.__game!.debug.records;
    const aims = recs
      .filter((r): r is Extract<typeof r, { kind: 'aim' }> => r.kind === 'aim')
      .filter((r) => r.stage === 'aim_applied');
    const last = aims.length ? aims[aims.length - 1] : null;
    const vel = window.__hitVel ?? { x: 0, y: 0, z: 0 };
    window.clearInterval(window.__hitWatch);
    return {
      stages: [
        ...new Set(
          recs
            .filter((r): r is Extract<typeof r, { kind: 'aim' }> => r.kind === 'aim')
            .map((r) => r.stage),
        ),
      ],
      contacts: recs
        .filter((r) => r.kind === 'contact')
        .map((r) => ({ athlete: r.athlete, latencyMs: r.latencyMs })),
      speed: Math.hypot(vel.x, vel.y, vel.z),
      vel,
      aim:
        last && last.dirX !== undefined
          ? { dirX: last.dirX, dirY: last.dirY ?? 0, strength: last.strength }
          : null,
    };
  });
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 860 });
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
});

test('case 1: a short swipe forward aims, previews and hits', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const a = await spike(page, cdp, 40);

  // Every link in the chain, in order.
  for (const stage of [
    'swipe_down',
    'swipe_move',
    'aim_applied',
    'aim_phase_started',
    'trajectory_computed',
    'preview_drawn',
    'swipe_up',
    'swing_started',
  ]) {
    expect(a.stages, `missing stage ${stage}`).toContain(stage);
  }

  expect(a.contacts).toHaveLength(1);
  expect(a.contacts[0].athlete).toBe('player');
  // The contact rule is untouched by any of this: the ball still only moves in
  // the substep the hitboxes overlap.
  expect(a.contacts[0].latencyMs).toBe(0);

  // Swiped up the screen, which in portrait is toward the net: the human half
  // is y > 8, so the ball has to leave with a negative y velocity.
  expect(a.aim).not.toBeNull();
  expect(a.aim!.dirY).toBeLessThan(-0.5);
  expect(a.vel.y).toBeLessThan(0);
});

test('case 2: a long swipe hits harder than a short one', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);

  // Averaged over three attempts each: the shot carries a small random speed
  // jitter, and one sample either side would be comparing noise.
  const speeds = async (dragPx: number) => {
    const runs: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const a = await spike(page, cdp, dragPx);
      expect(a.contacts).toHaveLength(1);
      runs.push(a.speed);
    }
    return runs.reduce((x, y) => x + y, 0) / runs.length;
  };

  const short = await speeds(40);
  const long = await speeds(160);
  expect(long).toBeGreaterThan(short);
});

test('case 3: jumping without swiping never touches the ball', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const a = await spike(page, cdp, 0);

  // The aiming window opens - that part is not conditional on the gesture.
  expect(a.stages).toContain('aim_phase_started');
  // But nothing swings and nothing is touched.
  expect(a.stages).not.toContain('swing_started');
  expect(a.contacts).toHaveLength(0);
});

test('the gesture may start on the Schmettern button itself', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const a = await spike(page, cdp, 80, true);

  // The regression this file exists for: the button used to swallow the
  // gesture on its own pointerdown, so the swipe never reached the surface.
  expect(a.stages).toContain('swipe_down');
  expect(a.stages).toContain('swing_started');
  expect(a.contacts).toHaveLength(1);
  expect(a.contacts[0].latencyMs).toBe(0);
});
