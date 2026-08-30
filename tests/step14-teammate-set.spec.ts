import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

/**
 * The set the AI teammate plays to the human.
 *
 * The failure this covers is not "the ball goes somewhere odd" but "the AI
 * decides not to set at all". It used to refuse whenever the target landed
 * near itself - and because the target was derived from where the receiver
 * stood, a human waiting at the net to attack pulled the target onto the
 * setter and got no ball. So these tests read the *decision* out of the debug
 * log alongside the ball, and the case that matters most is the player
 * standing at the net.
 */
interface Reception {
  decision: string;
  from: { x: number; y: number };
  partner: { x: number; y: number };
  target: { x: number; y: number };
  /** Where the launched ball genuinely arrives, integrated from its velocity
   * rather than copied from the intent. */
  used: { x: number; y: number; z: number };
}

/**
 * One ball fed to the teammate, with the player standing (or running) where
 * the case needs them. `sideways` moves the player across the court while the
 * ball is in the air, which is what the target's lead is measured against.
 */
async function receive(
  page: Page,
  opts: { playerY: number; playerX?: number; sideways?: number },
): Promise<Reception | null> {
  return page.evaluate(async ({ playerY, playerX, sideways, netY }) => {
    const g = window.__game!;
    const s = g.state;
    s.autoServe = false;
    s.awaitingServe = false;
    s.aiEnabled = true;
    s.phase = 'rally';
    g.state.lastEvent = null;
    s.score = { human: 0, opponents: 0 };
    s.winner = null;
    s.player.resetForNewRally();
    for (const ai of s.aiAthletes) ai.resetForNewRally();
    g.debug.clear();

    // The teammate is clearly the closer one, so the ball is genuinely theirs.
    s.player.pos = { x: playerX ?? 4, y: playerY };
    s.teammate.pos = { x: 1.5, y: 13 };
    s.opponents[0].pos = { x: 4, y: netY - 3 };
    s.opponents[1].pos = { x: 4, y: netY - 6 };
    s.rally.possession = 'human';
    s.rally.touches = 0;
    s.rally.lastToucher = 'opponent1';
    s.ball.strike({ x: 1.5, y: 13, z: 4.5 }, { x: 0, y: 0, z: 0 }, 'opponent1');

    if (sideways) {
      const started = performance.now();
      const step = () => {
        if (performance.now() - started > 1200 || s.ball.lastToucher === 'teammate') return;
        s.player.pos = {
          x: Math.max(1, Math.min(7, s.player.pos.x + sideways * 0.05)),
          y: s.player.pos.y,
        };
        requestAnimationFrame(step);
      };
      step();
    }

    const struck = await new Promise<boolean>((resolve) => {
      const started = performance.now();
      const tick = () => {
        if (s.ball.lastToucher === 'teammate') return resolve(true);
        if (performance.now() - started > 5000) return resolve(false);
        requestAnimationFrame(tick);
      };
      tick();
    });
    if (!struck) return null;

    const rec = g.debug.records.find(
      (r): r is Extract<typeof r, { kind: 'set' }> => r.kind === 'set' && r.athlete === 'teammate',
    );
    if (!rec) return null;
    return {
      decision: rec.decision,
      from: { x: rec.fromX, y: rec.fromY },
      partner: { x: rec.partnerX, y: rec.partnerY },
      target: { x: rec.targetX, y: rec.targetY },
      used: { x: rec.usedX, y: rec.usedY, z: rec.usedZ },
    };
  }, { playerY: opts.playerY, playerX: opts.playerX, sideways: opts.sideways ?? 0, netY: NET_Y });
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
});

test('case 1: the set lands at the net near the player, computed and actual alike', async ({
  page,
}) => {
  const r = await receive(page, { playerY: 12 });
  expect(r).not.toBeNull();
  expect(r!.decision).toBe('set_to_partner');

  // Computed target: own half, at the net, on the player's line.
  expect(r!.target.y).toBeGreaterThan(NET_Y);
  expect(r!.target.y - NET_Y).toBeLessThanOrEqual(3);
  expect(Math.abs(r!.target.x - r!.partner.x)).toBeLessThan(1);

  // And the ball actually goes there - nothing lost between the two.
  expect(Math.hypot(r!.used.x - r!.target.x, r!.used.y - r!.target.y)).toBeLessThan(0.8);
  expect(r!.used.z).toBeGreaterThan(1.8);
});

test('case 2: the target leads the player instead of using a stale position', async ({ page }) => {
  const right = await receive(page, { playerY: 11.5, playerX: 4, sideways: 1 });
  const left = await receive(page, { playerY: 11.5, playerX: 4, sideways: -1 });
  expect(right).not.toBeNull();
  expect(left).not.toBeNull();

  // Running right puts the target right of the player, and the other way
  // round - so it is the movement being read, not the position.
  expect(right!.target.x).toBeGreaterThan(right!.partner.x + 0.3);
  expect(left!.target.x).toBeLessThan(left!.partner.x - 0.3);
});

test('case 3: at least 7 of 10 receptions land somewhere the player can attack', async ({
  page,
}) => {
  test.setTimeout(120_000);
  let spikeable = 0;
  const runs = 10;
  for (let i = 0; i < runs; i += 1) {
    const r = await receive(page, { playerY: 12 });
    expect(r).not.toBeNull();
    const netDistance = r!.used.y - NET_Y;
    const reach = Math.hypot(r!.used.x - r!.partner.x, r!.used.y - r!.partner.y);
    // Attackable means: their own side, close to the net, within a step of the
    // player, and still high enough to hit rather than dig.
    if (r!.used.y > NET_Y && netDistance <= 4 && reach <= 3 && r!.used.z >= 1.8) spikeable += 1;
  }
  expect(spikeable).toBeGreaterThanOrEqual(7);
});

test('the player waiting at the net still gets set to - the regression itself', async ({
  page,
}) => {
  // The exact case that used to fail: standing where the set would land made
  // the teammate give up on setting and attack over the net itself, so a
  // player who had done the right thing and gone up to attack was left with
  // nothing to hit.
  const r = await receive(page, { playerY: 9.5 });
  expect(r).not.toBeNull();
  expect(r!.decision).toBe('set_to_partner');
  expect(r!.used.y).toBeGreaterThan(NET_Y);
  expect(r!.used.y - NET_Y).toBeLessThanOrEqual(4);
  expect(r!.used.z).toBeGreaterThan(1.8);
});
