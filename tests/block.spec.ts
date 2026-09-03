import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Blocken - the move that replaced Hechten outright.
 *
 * 1. Hechten is gone from the game entirely: no dive button, no 'diving' or
 *    'recovering' state, no dash, no recovery pause. The Block button sits in
 *    exactly the slot the Hechten button occupied, and Space triggers it.
 * 2. The player blocks at the net without moving at all. An opponent attack
 *    passing through the wall rebounds hard and steep straight back down onto
 *    the attacker's side - clearly not a reception.
 * 3. The AI teammate reads a developing attack, goes to the net on its own and
 *    blocks, freeing the player to drop back into the defence.
 * 4. Block is cleanly separated from Pass, Jump-Smash and Notfall-Schlag.
 */

const NET_Y = 8;
const BLOCK_PEAK_HEIGHT = 0.85;
const BLOCK_RETURN_DEPTH = 1.6;

/** No input at all - the shape GameState/Player expect every frame. */
const NO_INPUT = {
  move: { x: 0, y: 0 }, aim: null, swipe: null,
  jump: false, spike: false, pass: false, block: false, hit: false, serve: false,
};

/** The opponents' real attack: OPPONENT_ATTACK_DURATION 0.6,
 * OPPONENT_ATTACK_PEAK_HEIGHT 1.1. */
const ATTACK = { duration: 0.6, peakHeight: 1.1 };
/** ...and their safe return: slow and high enough to clear any block. */
const LOB = { duration: 1.9, peakHeight: 2.7 };

/** Drives Player+Ball in lockstep (as GameState does), pressing Block once at
 * `pressAt`, and reports whether the incoming ball was blocked. */
async function blockAttempt(
  page: Page,
  opts: {
    playerX: number; playerY: number;
    from: { x: number; y: number }; to: { x: number; y: number };
    shot?: { duration: number; peakHeight: number };
    pressAt: number;
  },
) {
  return page.evaluate(({ NO_INPUT, opts, ATTACK }) => {
    const g = (window as any).__game.state;
    g.teammate.update = () => {};
    for (const o of g.opponents) o.update = () => {};
    g.awaitingServe = null;

    g.player.state = 'active';
    g.player.height = 0;
    g.player.pos.x = opts.playerX;
    g.player.pos.y = opts.playerY;
    const startPos = { ...g.player.pos };

    const shot = opts.shot ?? ATTACK;
    g.ball.launch(opts.from, opts.to, { ...shot, toucher: 'opponent1' });

    const states = new Set<string>();
    let blocked: any = null;
    let maxHeight = 0;
    for (let t = 0; t < 1.4; t += 0.016) {
      const press = Math.abs(t - opts.pressAt) < 0.008;
      g.player.update(0.016, { ...NO_INPUT, block: press }, g.ball, g.teammate.pos, false);
      g.ball.update(0.016);
      states.add(g.player.state);
      maxHeight = Math.max(maxHeight, g.player.height);
      if (!blocked && g.ball.lastToucher === 'player') {
        blocked = {
          t: +t.toFixed(3),
          target: { ...g.ball.target },
          duration: g.ball.duration,
          peakHeight: g.ball.peakHeight,
        };
      }
    }
    return {
      blocked,
      states: [...states],
      maxHeight,
      endState: g.player.state,
      moved: Math.hypot(g.player.pos.x - startPos.x, g.player.pos.y - startPos.y),
      finalToucher: g.ball.lastToucher,
    };
  }, { NO_INPUT, opts, ATTACK });
}

test.describe('Blocken (ersetzt Hechten vollständig)', () => {
  // ---------------------------------------------------------------- point 1
  test('Hechten is gone: no dive button, no dive states, and Block sits in its slot', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const ui = await page.evaluate(() => {
      const box = (id: string) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { text: el.textContent, x: Math.round(r.x), y: Math.round(r.y),
                 w: Math.round(r.width), h: Math.round(r.height) };
      };
      return {
        dive: box('dive-btn'),
        block: box('block-btn'),
        hit: box('hit-btn'),
        pass: box('pass-btn'),
        html: document.body.innerHTML,
      };
    });

    expect(ui.dive).toBeNull(); // the old button does not exist at all
    expect(ui.block).not.toBeNull();
    expect(ui.block!.text).toBe('Block');
    expect(ui.html).not.toContain('Hechten');

    // Same slot as the old Hechten button: 68x68, upper row sitting on the
    // same baseline as Notfall (both are anchored by their bottom edge, which
    // is why their centres differ - they are different sizes), horizontally
    // centred over Pass.
    expect(ui.block!.w).toBe(68);
    expect(ui.block!.h).toBe(68);
    expect(ui.block!.y + ui.block!.h).toBeCloseTo(ui.hit!.y + ui.hit!.h, 0);
    expect(ui.block!.x + ui.block!.w / 2).toBeCloseTo(ui.pass!.x + ui.pass!.w / 2, 0);
    expect(ui.block!.y + ui.block!.h).toBeLessThan(ui.pass!.y); // genuinely the row above
  });

  test('the dive mechanic is gone from the code, not just the UI', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const probe = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;

      // A ball 1.5m away - squarely inside the old REACH_RANGE of 2m, i.e.
      // exactly the situation the dive used to dash for.
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 12;
      const start = { ...g.player.pos };
      g.ball.launch({ x: 4, y: 10.5 }, { x: 4.05, y: 10.5 },
        { duration: 8, peakHeight: 0.4, toucher: 'opponent1' });

      const states = new Set<string>();
      for (let t = 0; t < 1.5; t += 0.016) {
        g.player.update(0.016, { ...NO_INPUT, block: t < 0.008 }, g.ball, g.teammate.pos, false);
        g.ball.update(0.016);
        states.add(g.player.state);
      }
      return {
        states: [...states],
        travelled: Math.hypot(g.player.pos.x - start.x, g.player.pos.y - start.y),
        toucher: g.ball.lastToucher,
        methods: ['tryButtonDive', 'updateDiving', 'endDive'].filter(
          (m) => typeof (g.player as any)[m] === 'function',
        ),
      };
    }, NO_INPUT);

    expect(probe.methods).toEqual([]); // no leftover dive methods
    expect(probe.states).not.toContain('diving');
    expect(probe.states).not.toContain('recovering');
    expect(probe.states).toContain('blocking');
    // The defining difference: the dive dashed to the ball, the block does not
    // move the player at all - so this ball is simply never reached.
    expect(probe.travelled).toBe(0);
    expect(probe.toucher).toBe('opponent1');
  });

  // ---------------------------------------------------------------- point 2
  test('a block at the net turns an opponent attack straight back down onto their side', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await blockAttempt(page, {
      playerX: 4, playerY: 8.4,
      from: { x: 4, y: 4 }, to: { x: 4, y: 12 },
      pressAt: 0.016,
    });

    expect(r.blocked).not.toBeNull();
    // Back onto the attacker's own side, just past the net...
    expect(r.blocked!.target.y).toBeCloseTo(NET_Y - BLOCK_RETURN_DEPTH, 5);
    expect(r.blocked!.target.y).toBeLessThan(NET_Y);
    // ...hard and steep. Nothing else in the game flies this flat: the
    // flattest normal shot is the full-power spike at peakHeight 1.2, and a
    // reception (pass 2.5 / set 3.5 / hit 2.2) is several times higher.
    expect(r.blocked!.peakHeight).toBeCloseTo(0.3, 5);
    expect(r.blocked!.duration).toBeCloseTo(0.45, 5);

    // The move itself: up, and back down, without moving an inch.
    expect(r.maxHeight).toBeCloseTo(BLOCK_PEAK_HEIGHT, 5);
    expect(r.moved).toBe(0);
    expect(r.endState).toBe('active'); // no recovery pause - straight back in play
  });

  test('the block has a real timing window: too late and the attack goes past', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const attack = { playerX: 4, playerY: 8.4, from: { x: 4, y: 4 }, to: { x: 4, y: 12 } };
    // The attack crosses the net around t=0.2s of its 0.6s flight, and the
    // wall stays up for BLOCK_DURATION (0.55s).
    for (const pressAt of [0, 0.1, 0.2, 0.3]) {
      const r = await blockAttempt(page, { ...attack, pressAt });
      expect(r.blocked, `press at ${pressAt}s should block`).not.toBeNull();
    }
    // Pressed after the ball has already gone by: nothing to block.
    const late = await blockAttempt(page, { ...attack, pressAt: 0.45 });
    expect(late.blocked).toBeNull();
    expect(late.finalToucher).toBe('opponent1');
  });

  test('the wall has edges: off the line, out of the net zone, or under a lob it does nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const line = { from: { x: 4, y: 4 }, to: { x: 4, y: 12 }, pressAt: 0.016 };

    // Laterally: BLOCK_HALF_WIDTH is 1.1m, so 2.5m off the attack line is past
    // the edge of the wall.
    expect((await blockAttempt(page, { ...line, playerX: 6.5, playerY: 8.4 })).blocked).toBeNull();
    // ...but standing on the line it works.
    expect((await blockAttempt(page, { ...line, playerX: 4.8, playerY: 8.4 })).blocked).not.toBeNull();

    // Along the court: BLOCK_NET_DISTANCE is 1.5m, so a block from mid-court
    // intercepts nothing - this is the "you have to be at the net" rule.
    expect((await blockAttempt(page, { ...line, playerX: 4, playerY: 11.5 })).blocked).toBeNull();

    // Vertically: a slow, high return sails over the block (it peaks at 2.7,
    // the wall covers up to BLOCK_MAX_HEIGHT 2.4).
    const overTheTop = await blockAttempt(page, {
      ...line, playerX: 4, playerY: 8.4, shot: LOB, pressAt: 0.35,
    });
    expect(overTheTop.blocked).toBeNull();
  });

  test('our own ball on its way over is never blockable - only the opponents\' attack is', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 8.4;
      // Our own teammate's attack, heading the other way through the same
      // patch of net.
      g.ball.launch({ x: 4, y: 12 }, { x: 4, y: 4 }, { duration: 0.6, peakHeight: 1.1, toucher: 'teammate' });

      for (let t = 0; t < 1; t += 0.016) {
        g.player.update(0.016, { ...NO_INPUT, block: t < 0.008 }, g.ball, g.teammate.pos, false);
        g.ball.update(0.016);
      }
      return { toucher: g.ball.lastToucher, target: { ...g.ball.target } };
    }, NO_INPUT);

    expect(r.toucher).toBe('teammate'); // untouched by the block
    expect(r.target.y).toBe(4);
  });

  // ---------------------------------------------------------------- point 3
  test('the AI teammate goes to the net on its own and blocks the attack', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      // Force every opponent touch to be an attack (roll 0.3 sits inside
      // [OPPONENT_ERROR_CHANCE 0.15, +OPPONENT_ATTACK_CHANCE 0.25)).
      (window as any).__setRandom(() => 0.3);
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 12; // player back in the defence - nothing is pressed
      const tmStart = { ...g.teammate.pos };

      let wentToNet = false;
      let atNetAt: number | null = null;
      let struckAt: number | null = null;
      let blockedAt: any = null;
      for (let t = 0; t < 3; t += 0.016) {
        if (t < 0.008) {
          // Our team has just put the ball over: the attack is being built.
          g.ball.launch({ x: 4, y: 9 }, { x: 5, y: 3 }, { duration: 1.2, peakHeight: 2, toucher: 'player' });
        }
        g.update(0.016, NO_INPUT);
        if (g.teammate.state === 'to_net') wentToNet = true;
        if (atNetAt === null && g.teammate.pos.y <= 8.6) atNetAt = +t.toFixed(2);
        if (struckAt === null && (g.ball.lastToucher === 'opponent1' || g.ball.lastToucher === 'opponent2')) {
          struckAt = +t.toFixed(2);
        }
        if (struckAt !== null && !blockedAt && g.ball.lastToucher === 'teammate') {
          blockedAt = { t: +t.toFixed(2), target: { ...g.ball.target },
                        duration: g.ball.duration, peakHeight: g.ball.peakHeight };
        }
      }
      return { wentToNet, atNetAt, struckAt, blockedAt, tmStart,
               playerState: g.player.state, playerY: g.player.pos.y };
    }, NO_INPUT);

    // It left its zone base for the net entirely on its own initiative...
    expect(r.wentToNet).toBe(true);
    expect(r.tmStart.y).toBeGreaterThan(9); // it really did start back in the court
    expect(r.atNetAt).not.toBeNull();
    // ...and got there well before the opponents even struck the ball.
    expect(r.struckAt).not.toBeNull();
    expect(r.atNetAt!).toBeLessThan(r.struckAt!);

    // Then blocked the attack, with the same rebound the player's block makes.
    expect(r.blockedAt).not.toBeNull();
    expect(r.blockedAt.target.y).toBeCloseTo(NET_Y - BLOCK_RETURN_DEPTH, 5);
    expect(r.blockedAt.peakHeight).toBeCloseTo(0.3, 5);

    // ...with nothing pressed, and the player left free in the back court.
    expect(r.playerState).toBe('active');
    expect(r.playerY).toBe(12);
  });

  test('the AI teammate blocks a hard attack but digs a lob instead of jumping at it', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const run = (roll: number) =>
      page.evaluate(({ NO_INPUT, roll }) => {
        const g = (window as any).__game.state;
        (window as any).__setRandom(() => roll);
        g.awaitingServe = null;
        g.player.state = 'active';
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        g.ball.launch({ x: 4, y: 9 }, { x: 5, y: 3 }, { duration: 1.2, peakHeight: 2, toucher: 'player' });

        let everBlocked = false;
        let incomingDuration: number | null = null;
        for (let t = 0; t < 3.5; t += 0.016) {
          g.update(0.016, NO_INPUT);
          if (g.teammate.state === 'blocking') everBlocked = true;
          if (incomingDuration === null &&
              (g.ball.lastToucher === 'opponent1' || g.ball.lastToucher === 'opponent2')) {
            incomingDuration = g.ball.duration;
          }
        }
        return { everBlocked, incomingDuration };
      }, { NO_INPUT, roll });

    // 0.3 -> attack (fast, 0.6s). 0.9 -> the safe default return (slow, 1.9s).
    const hard = await run(0.3);
    expect(hard.incomingDuration).toBeLessThanOrEqual(1.2);
    expect(hard.everBlocked).toBe(true);

    const soft = await run(0.9);
    expect(soft.incomingDuration).toBeGreaterThan(1.2);
    expect(soft.everBlocked).toBe(false); // stood down and dug it instead
  });

  test('never two blockers at once - the court behind the net is never left empty', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 8.5;
      g.ball.launch({ x: 4, y: 9 }, { x: 5, y: 3 }, { duration: 1.2, peakHeight: 2, toucher: 'player' });

      let both = 0;
      let playerFrames = 0;
      for (let t = 0; t < 20; t += 0.016) {
        // The human mashes Block every 10 frames - the worst case for the rule.
        g.update(0.016, { ...NO_INPUT, block: Math.round(t * 1000) % 160 === 0 });
        const pb = g.player.state === 'blocking';
        const tb = g.teammate.state === 'blocking';
        if (pb) playerFrames++;
        if (pb && tb) both++;
      }
      return { both, playerFrames };
    }, NO_INPUT);

    expect(r.playerFrames).toBeGreaterThan(0); // sanity: the player really was blocking
    expect(r.both).toBe(0);
  });

  // ---------------------------------------------------------------- point 4
  test('Block is separate from Pass: pressed together, the block wins and the pass is dropped', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 8.6;
      // A ball sitting right on the player at a catchable height: a Pass on
      // its own would grab this instantly.
      g.ball.launch({ x: 4, y: 8.6 }, { x: 4.02, y: 8.62 },
        { duration: 4, peakHeight: 0.2, toucher: 'opponent1' });

      g.player.update(0.016, { ...NO_INPUT, pass: true, block: true }, g.ball, g.teammate.pos, false);
      const immediately = g.player.state;

      const states = new Set<string>();
      for (let t = 0; t < 1.5; t += 0.016) {
        g.player.update(0.016, NO_INPUT, g.ball, g.teammate.pos, false);
        g.ball.update(0.016);
        states.add(g.player.state);
      }
      return { immediately, states: [...states], toucher: g.ball.lastToucher, duration: g.ball.duration };
    }, NO_INPUT);

    expect(r.immediately).toBe('blocking'); // the block took the frame outright
    // ...and the buffered pass never fired afterwards: the ball is still on
    // its original flight, untouched by us. (It also sits below
    // BLOCK_MIN_HEIGHT, so the block correctly does not take it either -
    // a ball under the block goes under it.)
    expect(r.toucher).toBe('opponent1');
    expect(r.duration).toBe(4);
    expect(r.states).toEqual(expect.arrayContaining(['blocking', 'active']));
  });

  test('no other action is reachable while blocking - jump and Notfall are locked out', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const r = await page.evaluate((NO_INPUT) => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      g.player.state = 'active';
      g.player.pos.x = 4;
      g.player.pos.y = 8.6;
      g.ball.launch({ x: 4, y: 8.6 }, { x: 4.02, y: 8.62 },
        { duration: 4, peakHeight: 1, toucher: 'opponent1' });

      g.player.update(0.016, { ...NO_INPUT, block: true }, g.ball, g.teammate.pos, false);

      // Hammer jump and Notfall for the whole block. Neither may do anything
      // until the block is over.
      const duringBlock = new Set<string>();
      for (let t = 0; t < 0.5; t += 0.016) {
        g.player.update(0.016, { ...NO_INPUT, jump: true, hit: true, spike: true },
          g.ball, g.teammate.pos, false);
        g.ball.update(0.016);
        duringBlock.add(g.player.state);
      }
      return { duringBlock: [...duringBlock] };
    }, NO_INPUT);

    expect(r.duringBlock).toEqual(['blocking']); // nothing else ever got in
  });
});
