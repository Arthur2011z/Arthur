import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

async function prepare(page: Page) {
  await page.evaluate(() => {
    const g = window.__game!;
    g.state.autoServe = false;
    g.state.aiEnabled = false;
    g.state.awaitingServe = false;
    g.state.ball.reset();
    g.state.lastEvent = null;
    g.state.phase = 'rally';
    g.state.rally.lastToucher = 'teammate';
    g.state.rally.possession = 'human';
    g.state.rally.touches = 2;
    // Same clean slate a real new rally gets - without it a cooldown from the
    // previous attempt leaks into this one.
    g.state.player.resetForNewRally();
    g.debug.clear();
  });
}

/**
 * Puts the player at `netDistance` from the net and floats a ball down onto
 * their attacking position, so a jump timed straight away meets it.
 */
async function setUpAttack(page: Page, netDistance = 0.8) {
  await page.evaluate((netDistance) => {
    const g = window.__game!;
    const y = 8 + netDistance;
    g.state.player.pos = { x: 4, y };
    // Hangs above the attacker and drifts down into the strike zone.
    g.state.ball.strike({ x: 4, y, z: 4.6 }, { x: 0, y: 0, z: 0 }, 'teammate');
  }, netDistance);
}

/**
 * Waits until nothing is left over from a previous attempt: the player is back
 * on the sand and out of the jump cooldown, and the previous ball has finished
 * flying. The ball matters as much as the jump - a ball still in the air lands
 * a moment later, scores a point, and the resulting pause silently swallows
 * the next key press.
 */
async function settle(page: Page) {
  await page.waitForFunction(
    () => !window.__game!.state.player.jumping && window.__game!.state.ball.state !== 'live',
    undefined,
    { timeout: 8000 },
  );
  await page.waitForTimeout(350);
}

/** Jumps, waits for the hang phase, then swings. */
async function jumpAndSwing(page: Page, aimKey?: string) {
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.player.jumpPhase === 'hanging', undefined, {
    timeout: 2000,
  });
  if (aimKey) await page.keyboard.down(aimKey);
  await page.waitForTimeout(60);
  await page.keyboard.press('q');
  if (aimKey) {
    await page.waitForTimeout(120);
    await page.keyboard.up(aimKey);
  }
}

async function waitForLanding(page: Page) {
  await page.waitForFunction(
    () => window.__game!.state.lastEvent?.type === 'landed',
    undefined,
    { timeout: 8000 },
  );
  return page.evaluate(() => ({ ...window.__game!.state.lastEvent!.at }));
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
  await prepare(page);
});

test('the first press jumps and does not touch the ball', async ({ page }) => {
  await setUpAttack(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.player.jumping);

  const state = await page.evaluate(() => ({
    phase: window.__game!.state.player.jumpPhase,
    jump: window.__game!.state.player.jumpHeight,
    pose: window.__game!.state.player.pose,
    toucher: window.__game!.state.ball.lastToucher,
  }));
  expect(state.jump).toBeGreaterThan(0);
  expect(state.pose).toBe('jumping');
  // Leaving the ground is not a contact.
  expect(state.toucher).toBe('teammate');
});

test('slow motion engages at the top of the jump and only with a ball in reach', async ({
  page,
}) => {
  // No ball anywhere near: the jump must not stutter the game.
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 9 };
    window.__game!.state.ball.strike({ x: 1, y: 14, z: 1 }, { x: 0, y: 0, z: 0 }, 'teammate');
  });
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.player.jumpPhase === 'hanging');
  expect(await page.evaluate(() => window.__game!.state.timeScale)).toBe(1);
  await page.waitForFunction(() => !window.__game!.state.player.jumping);

  // Ball overhead: now it should slow down.
  await settle(page);
  await prepare(page);
  await setUpAttack(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.timeScale < 1, undefined, {
    timeout: 2000,
  });
  expect(await page.evaluate(() => window.__game!.state.player.jumpPhase)).toBe('hanging');
});

test('the aim preview is the flight the ball actually takes', async ({ page }) => {
  await setUpAttack(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.aimPreview() !== null, undefined, {
    timeout: 2000,
  });

  const preview = await page.evaluate(() => window.__game!.state.aimPreview()!.map((p) => ({ ...p })));
  expect(preview.length).toBeGreaterThan(15);

  // A real parabola: it bends. Compare the mid-point of the path against the
  // straight line between its ends - a straight shot would sit on it.
  const first = preview[0];
  const last = preview[preview.length - 1];
  const mid = preview[Math.floor(preview.length / 2)];
  const straightZ = (first.z + last.z) / 2;
  // Any sag at all proves gravity is in the preview rather than a straight
  // line being drawn toward a target. A spike hit hard from right at the net
  // is genuinely almost flat, so the margin here is small on purpose - the
  // deep, slow case below is where the arc is obvious.
  expect(Math.abs(mid.z - straightZ)).toBeGreaterThan(0.01);
  // And it ends on the ground, past the net.
  expect(last.z).toBeLessThan(0.3);
  expect(last.y).toBeLessThan(NET_Y);
});

test('a weak attack from deep previews a clearly arced flight', async ({ page }) => {
  await setUpAttack(page, 5);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.aimPreview() !== null, undefined, {
    timeout: 2000,
  });

  const preview = await page.evaluate(() =>
    window.__game!.state.aimPreview()!.map((p) => ({ ...p })),
  );
  const first = preview[0];
  const last = preview[preview.length - 1];
  const highest = Math.max(...preview.map((p) => p.z));
  // Far from the net the shot is slow, so it has to loft - the sag against a
  // straight line is unmistakable.
  const mid = preview[Math.floor(preview.length / 2)];
  expect(Math.abs(mid.z - (first.z + last.z) / 2)).toBeGreaterThan(0.2);
  expect(highest).toBeGreaterThan(first.z - 0.01);
});

test('the preview follows the aim as it changes', async ({ page }) => {
  await setUpAttack(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.aimPreview() !== null, undefined, {
    timeout: 2000,
  });

  await page.keyboard.down('a');
  await page.waitForTimeout(120);
  const left = await page.evaluate(() => {
    const p = window.__game!.state.aimPreview()!;
    return { ...p[p.length - 1] };
  });
  await page.keyboard.up('a');

  await page.keyboard.down('d');
  await page.waitForTimeout(120);
  const right = await page.evaluate(() => {
    const p = window.__game!.state.aimPreview()!;
    return { ...p[p.length - 1] };
  });
  await page.keyboard.up('d');

  expect(right.x).toBeGreaterThan(left.x + 1);
});

test('the second press spikes the ball over the net', async ({ page }) => {
  await setUpAttack(page);
  await jumpAndSwing(page);

  await page.waitForFunction(() => window.__game!.state.ball.lastToucher === 'player', undefined, {
    timeout: 4000,
  });
  const at = await waitForLanding(page);
  expect(at.y).toBeLessThan(NET_Y);
});

test('the spike fires on contact, not on the press', async ({ page }) => {
  await setUpAttack(page);
  await jumpAndSwing(page);

  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 4000 },
  );
  const contact = (await page.evaluate(
    () => ({ ...window.__game!.debug.records.find((r) => r.kind === 'contact')! }),
  )) as unknown as { action: string; latencyMs: number; waitMs: number };

  expect(contact.action).toBe('jump');
  expect(contact.latencyMs).toBe(0);
  expect(contact.waitMs).toBeGreaterThan(0);
});

test('a swing in mid-air with no ball there simply misses', async ({ page }) => {
  await page.evaluate(() => {
    window.__game!.state.player.pos = { x: 4, y: 9 };
    window.__game!.state.ball.strike({ x: 1, y: 14, z: 3 }, { x: 0, y: 0, z: 0 }, 'teammate');
  });
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.player.jumpPhase === 'hanging');
  await page.keyboard.press('q');
  await page.waitForTimeout(600);

  const log = await page.evaluate(() => window.__game!.debug.records.map((r) => ({ ...r })));
  expect(log.some((r) => r.kind === 'contact')).toBe(false);
  expect(await page.evaluate(() => window.__game!.state.ball.lastToucher)).toBe('teammate');
});

test('taking off closer to the net hits harder', async ({ page }) => {
  /** Spikes once from `netDistance` and reports the ball's speed at contact. */
  async function speedFrom(netDistance: number) {
    await settle(page);
    await prepare(page);
    await setUpAttack(page, netDistance);
    await jumpAndSwing(page);
    await page.waitForFunction(
      () => window.__game!.state.ball.lastToucher === 'player',
      undefined,
      { timeout: 4000 },
    );
    return page.evaluate(() => {
      const v = window.__game!.state.ball.vel;
      return Math.hypot(v.x, v.y);
    });
  }

  const close = await speedFrom(0.6);
  const far = await speedFrom(4.5);
  expect(close).toBeGreaterThan(far * 1.3);
});

test('aim steers the spike, and the aimed edge can genuinely miss the court', async ({
  page,
}) => {
  /** Spikes with `aimKey` held and reports where it landed. */
  async function landingWith(aimKey?: string) {
    await settle(page);
    await prepare(page);
    await setUpAttack(page);
    await jumpAndSwing(page, aimKey);
    await page.waitForFunction(
      () => window.__game!.state.ball.lastToucher === 'player',
      undefined,
      { timeout: 4000 },
    );
    return waitForLanding(page);
  }

  const left = await landingWith('a');
  const right = await landingWith('d');
  expect(right.x).toBeGreaterThan(left.x + 1.5);

  // Aiming fully to one side from the middle of the court reaches past the
  // side line - so picking the very edge is a real risk, not a free win.
  expect(right.x > 8 || left.x < 0).toBe(true);
});

test('a spike from deep still crosses the net, just more readably', async ({ page }) => {
  await prepare(page);
  await setUpAttack(page, 5);
  await jumpAndSwing(page);
  await page.waitForFunction(() => window.__game!.state.ball.lastToucher === 'player', undefined, {
    timeout: 4000,
  });
  const at = await waitForLanding(page);
  // Still a real shot that crosses the net, just an easier one to read.
  expect(at.y).toBeLessThan(NET_Y);
});

test('the swing stays live for the whole descent, then still fires on contact', async ({
  page,
}) => {
  await setUpAttack(page);
  await page.keyboard.press('q');
  await page.waitForFunction(() => window.__game!.state.timeScale < 1, undefined, {
    timeout: 2000,
  });

  // Swing at the top, while the ball is still well above the player's reach.
  // A swing is a committed motion, not a 180ms press, so it waits for the ball
  // rather than expiring under it.
  await page.keyboard.press('q');
  // The press is processed on the next frame, not synchronously with the DOM
  // event, so poll rather than reading immediately.
  await page.waitForFunction(() => window.__game!.state.player.swinging, undefined, {
    timeout: 1000,
  });

  await page.waitForFunction(
    () => window.__game!.debug.records.some((r) => r.kind === 'contact'),
    undefined,
    { timeout: 4000 },
  );
  const contact = (await page.evaluate(
    () => ({ ...window.__game!.debug.records.find((r) => r.kind === 'contact')! }),
  )) as unknown as { action: string; waitMs: number; latencyMs: number };

  expect(contact.action).toBe('jump');
  // The rule that matters is unchanged: the ball moves at the touch, not at
  // the press - and here the press was hundreds of milliseconds earlier.
  expect(contact.latencyMs).toBe(0);
  expect(contact.waitMs).toBeGreaterThan(200);
});
