import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * REGRESSION: the Sprung-Schmetterschlag stopped playing the ball at all.
 *
 * Three separate causes, all from the contact-timing change:
 *
 *  1. The touch test measured the DRAWN positions. The renderer projects height
 *     into a y-offset, which collapses two independent axes: a ball high up the
 *     court projects onto a player it is nowhere near (false touch), while a
 *     ball genuinely above the player's head projects far away (missed touch).
 *     Now measured in 3D.
 *  2. A flight that completed during the slow-motion aim window ended the rally
 *     underneath it, with the strike silently dropped. The ball is now held a
 *     hair short of landing for as long as the window is open.
 *  3. The drift tolerance that decides "is this still the same ball" was sized
 *     for a 2D metric. In 3D a ball at the end of a high arc falls fast, and
 *     legitimate contacts were being thrown away.
 */

const TOUCH_DISTANCE = 0.5;
const NO_INPUT = {
  move: { x: 0, y: 0 }, aim: null, swipe: null,
  jump: false, spike: false, pass: false, block: false, hit: false, serve: false,
};

/** The AI teammate's real set: TEAMMATE_SET_DURATION 1.5, peak 3.5, aimed at
 * the player. This is what a smash is actually played off. */
const SET = { from: { x: 4, y: 12.5 }, to: { x: 4, y: 10 }, duration: 1.5, peakHeight: 3.5 };

function captureLog(page: Page, prefix: string): string[] {
  const lines: string[] = [];
  page.on('console', (m) => {
    if (m.text().startsWith(prefix)) lines.push(m.text());
  });
  return lines;
}

/**
 * One smash attempt off a real set, driven frame by frame in lockstep with
 * GameState's own rules (including holding the ball while the aim window is
 * open). `jumpMs` is when the jump is pressed; `aim` is the swipe held through
 * the window, or null for the default straight-ahead aim.
 */
async function smashAttempt(
  page: Page,
  jumpMs: number,
  aim: { dir: { x: number; y: number }; strength: number } | null = null,
) {
  return page.evaluate(
    ({ NO_INPUT, SET, jumpMs, aim, TOUCH_DISTANCE }) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      (window as any).__setRandom(() => 0.99); // never net-fault

      g.player.state = 'active';
      g.player.height = 0;
      g.player.pos.x = SET.to.x;
      g.player.pos.y = SET.to.y;
      g.ball.height = 0;
      g.ball.launch(SET.from, SET.to, {
        duration: SET.duration,
        peakHeight: SET.peakHeight,
        toucher: 'teammate',
      });

      const gap = () =>
        Math.hypot(
          g.ball.pos.x - g.player.pos.x,
          g.ball.pos.y - g.player.pos.y,
          g.ball.height - g.player.height,
        );

      const jumpFrame = Math.round(jumpMs / 16);
      let aimWindowAt: number | null = null;
      let gapAtTouch: number | null = null;
      let struckAt: number | null = null;
      let gapAtStrike: number | null = null;
      let previewTarget: { x: number; y: number } | null = null;
      let struckTarget: { x: number; y: number } | null = null;

      for (let i = 0; i < 200; i++) {
        const inAim = g.player.state === 'slowmo_aim';
        g.player.update(
          0.016,
          { ...NO_INPUT, jump: i === jumpFrame, aim: inAim ? aim : null },
          g.ball,
          g.teammate.pos,
          false,
        );
        if (aimWindowAt === null && g.player.state === 'slowmo_aim') {
          aimWindowAt = i * 16;
          gapAtTouch = gap();
        }
        if (g.player.aimPreview) previewTarget = { ...g.player.aimPreview.target };
        if (struckAt === null && g.ball.lastToucher === 'player') {
          struckAt = i * 16;
          gapAtStrike = gap();
          struckTarget = { ...g.ball.target };
        }
        // Exactly what GameState does, including holding the ball short of
        // landing while the aim window is open.
        g.ball.update(
          g.player.state === 'slowmo_aim'
            ? Math.min(0.016 * 0.18, Math.max(0, g.ball.timeRemaining - 1e-3))
            : 0.016,
        );
      }

      return {
        jumpMs,
        aimWindowAt,
        gapAtTouch,
        struckAt,
        gapAtStrike,
        previewTarget,
        struckTarget,
        toucher: g.ball.lastToucher,
        touchDistance: TOUCH_DISTANCE,
      };
    },
    { NO_INPUT, SET, jumpMs, aim, TOUCH_DISTANCE },
  );
}

test.describe('Schmetterschlag: spielt den Ball wieder', () => {
  // ------------------------------------------------------- Pflicht-Testfall 1
  test('Testfall 1: jumped on time with a swipe, the ball is struck along the previewed line', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const spikeLog = captureLog(page, '[Spike]');
    await page.goto(distIndex);

    const r = await smashAttempt(page, 1040, { dir: { x: 0.6, y: -0.8 }, strength: 0.9 });

    // The whole chain ran: jump -> touch -> aim window -> strike.
    expect(r.aimWindowAt).not.toBeNull();
    expect(r.struckAt).not.toBeNull();
    expect(r.toucher).toBe('player');
    // The CONTACT - the moment the aim window opened - happened with the
    // hitboxes genuinely overlapping. The strike itself resolves at the end of
    // the window, by which point the ball has crept on; that drift is bounded
    // by SLOWMO_CONTACT_TOLERANCE, not by the touch distance.
    expect(r.gapAtTouch!).toBeLessThanOrEqual(TOUCH_DISTANCE);
    expect(r.gapAtStrike!).toBeLessThanOrEqual(1.4); // SLOWMO_CONTACT_TOLERANCE

    // The ball goes where the preview said it would - the swipe is honoured,
    // up to the deliberate scatter (SPIKE_SCATTER_RADIUS 0.55).
    expect(r.previewTarget).not.toBeNull();
    const off = Math.hypot(
      r.struckTarget!.x - r.previewTarget!.x,
      r.struckTarget!.y - r.previewTarget!.y,
    );
    expect(off).toBeLessThanOrEqual(0.55 + 1e-6);
    expect(r.struckTarget!.y).toBeLessThan(8); // over the net
    expect(r.struckTarget!.x).toBeGreaterThan(SET.to.x); // and to the right, as swiped

    // The diagnostic trail shows each stage.
    const joined = spikeLog.join('\n');
    expect(joined).toContain('trigger:jump');
    expect(joined).toContain('contact:aim-window-opens');
    expect(joined).toContain('outcome:STRUCK');
    expect(joined).not.toContain('outcome:ABANDONED');
    expect(joined).not.toContain('LANDED EMPTY');
  });

  // ------------------------------------------------------- Pflicht-Testfall 2
  test('Testfall 2: jumped far too early, nothing is played at all', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const spikeLog = captureLog(page, '[Spike]');
    await page.goto(distIndex);

    // The jump lasts JUMP_RISE_DURATION + JUMP_FALL_DURATION = 0.65s. Pressed
    // 640ms in, the player is back on the ground long before the ball arrives
    // at 1500ms.
    const early = await smashAttempt(page, 320);
    expect(early.aimWindowAt).toBeNull(); // never even touched it
    expect(early.struckAt).toBeNull();
    expect(early.toucher).toBe('teammate'); // the ball flew on untouched

    const joined = spikeLog.join('\n');
    expect(joined).toContain('trigger:jump');
    expect(joined).toContain('LANDED EMPTY');
    expect(joined).not.toContain('outcome:STRUCK');
  });

  test('Testfall 2b: a jump that never gets near the ball plays nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Standing 3m off the set's landing spot (still inside the side lines, so
    // nothing is clamped) - far outside JUMP_ASSIST_RANGE, so the drift cannot
    // rescue it either.
    const r = await page.evaluate(({ NO_INPUT, SET }) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.height = 0;
      g.player.pos.x = SET.to.x + 3;
      g.player.pos.y = SET.to.y;
      g.ball.height = 0;
      g.ball.launch(SET.from, SET.to, { duration: SET.duration, peakHeight: SET.peakHeight, toucher: 'teammate' });
      for (let i = 0; i < 200; i++) {
        g.player.update(0.016, { ...NO_INPUT, jump: i === 65 }, g.ball, g.teammate.pos, false);
        g.ball.update(
          g.player.state === 'slowmo_aim'
            ? Math.min(0.016 * 0.18, Math.max(0, g.ball.timeRemaining - 1e-3))
            : 0.016,
        );
      }
      return { toucher: g.ball.lastToucher, playerX: g.player.pos.x };
    }, { NO_INPUT, SET });

    expect(r.toucher).toBe('teammate');
    expect(r.playerX).toBeCloseTo(SET.to.x + 3, 5); // the drift never engaged
  });

  // ------------------------------------------------------- Pflicht-Testfall 3
  test('Testfall 3: the smash works repeatedly, across the whole timing window', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Every press from 800ms to 1360ms of the 1500ms set has to connect. That
    // band is the practical timing window, and it must not be a knife edge:
    // before the fix only a 240ms slice of it worked, and even inside that
    // slice three of eight attempts were dropped by the aim window.
    const results = [];
    for (const jumpMs of [800, 960, 1040, 1120, 1200, 1280, 1360]) {
      results.push(await smashAttempt(page, jumpMs));
    }

    for (const r of results) {
      expect(r.aimWindowAt, `jump @${r.jumpMs}ms`).not.toBeNull();
      expect(r.struckAt, `jump @${r.jumpMs}ms`).not.toBeNull();
      expect(r.toucher, `jump @${r.jumpMs}ms`).toBe('player');
      expect(r.gapAtTouch!, `jump @${r.jumpMs}ms`).toBeLessThanOrEqual(TOUCH_DISTANCE);
      expect(r.gapAtStrike!, `jump @${r.jumpMs}ms`).toBeLessThanOrEqual(1.4);
      expect(r.struckTarget!.y, `jump @${r.jumpMs}ms`).toBeLessThan(8); // over the net
    }
  });

  test('the smash comes off in a real rally, through the full game loop', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.restart();
      g.awaitingServe = null;
      (window as any).__setRandom(() => 0.99);

      let jumped = false;
      let smashed: { ms: number; target: { x: number; y: number } } | null = null;
      for (let i = 0; i < 900; i++) {
        const isSetForUs = g.ball.lastToucher === 'teammate' && g.ball.target.y > 8;
        const toBall = Math.hypot(g.ball.pos.x - g.player.pos.x, g.ball.pos.y - g.player.pos.y);
        const aimPt = toBall < 2.5 ? g.ball.pos : g.ball.target;
        const dx = aimPt.x - g.player.pos.x;
        const dy = aimPt.y - g.player.pos.y;
        const len = Math.hypot(dx, dy) || 1;
        // Jump the way a person does: when the ball is genuinely coming down.
        const dist3D = Math.hypot(
          g.ball.pos.x - g.player.pos.x,
          g.ball.pos.y - g.player.pos.y,
          g.ball.height,
        );
        const wantJump =
          !jumped && isSetForUs && dist3D < 2.2 && g.ball.height < 2.2 && g.player.state === 'active';
        if (wantJump) jumped = true;

        g.update(0.016, {
          ...NO_INPUT,
          move: { x: dx / len, y: dy / len },
          pass: !isSetForUs && g.ball.state === 'flying' && g.ball.target.y > 8 && i % 5 === 0,
          jump: wantJump,
        });

        if (jumped && !smashed && g.ball.lastToucher === 'player') {
          smashed = { ms: i * 16, target: { ...g.ball.target } };
        }
        if (smashed) break;
      }
      return { jumped, smashed };
    }, NO_INPUT);

    expect(r.jumped).toBe(true); // sanity: a set really did come
    expect(r.smashed).not.toBeNull();
    expect(r.smashed!.target.y).toBeLessThan(8); // struck over the net
  });

  // ------------------------------- the projection hole that caused all of this
  test('height is never folded into y: a high, distant ball is not a touch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const contactLog = captureLog(page, '[BallContact]');
    await page.goto(distIndex);

    const r = await page.evaluate(({ NO_INPUT, SET }) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.height = 0;
      g.player.pos.x = SET.to.x;
      g.player.pos.y = SET.to.y;
      g.ball.height = 0;
      g.ball.launch(SET.from, SET.to, { duration: SET.duration, peakHeight: SET.peakHeight, toucher: 'teammate' });

      // Somewhere early in this arc the ball's DRAWN position (pos.y - height)
      // passes exactly over the player while the ball is metres away and metres
      // up. Hold Pass across the whole of it: nothing may fire until the ball
      // is genuinely there.
      let firstContact: { ms: number; ground: number; height: number; true3D: number } | null = null;
      let drawnOverlapSeen = false;
      for (let i = 0; i < 100; i++) {
        const ground = Math.hypot(g.ball.pos.x - g.player.pos.x, g.ball.pos.y - g.player.pos.y);
        const drawn = Math.hypot(
          g.ball.pos.x - g.player.pos.x,
          g.ball.pos.y - g.ball.height - (g.player.pos.y - g.player.height),
        );
        if (drawn <= 0.5 && ground > 1) drawnOverlapSeen = true;
        const before = g.ball.lastToucher;
        g.player.update(0.016, { ...NO_INPUT, pass: true }, g.ball, g.teammate.pos, false);
        if (before !== 'player' && g.ball.lastToucher === 'player' && !firstContact) {
          firstContact = {
            ms: i * 16,
            ground,
            height: g.ball.height,
            true3D: Math.hypot(ground, g.ball.height - g.player.height),
          };
        }
        g.ball.update(0.016);
      }
      return { drawnOverlapSeen, firstContact };
    }, { NO_INPUT, SET });

    // The projection really does line up during this arc - that is the trap.
    expect(r.drawnOverlapSeen).toBe(true);
    // ...and it must not have produced a contact. Either nothing fired, or it
    // fired only once the ball was genuinely within reach in 3D.
    if (r.firstContact) {
      expect(r.firstContact.true3D).toBeLessThanOrEqual(TOUCH_DISTANCE);
    }
    for (const line of contactLog) {
      const m = line.match(/gap=([\d.]+)m/);
      if (m) expect(Number(m[1])).toBeLessThanOrEqual(TOUCH_DISTANCE);
    }
  });
});
