import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

async function getState(page: Page) {
  return page.evaluate(() => {
    const g = (window as any).__game;
    return {
      player: { pos: { ...g.state.player.pos }, state: g.state.player.state },
      ball: {
        target: { ...g.state.ball.target },
        state: g.state.ball.state,
        lastToucher: g.state.ball.lastToucher,
      },
      teammate: { ...g.state.teammate.pos },
      opponents: g.state.opponents.map((o: any) => ({ ...o.pos })),
    };
  });
}

async function launchBall(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  duration: number,
  peakHeight = 3,
) {
  await page.evaluate(
    ({ from, to, duration, peakHeight }) => {
      (window as any).__game.state.ball.launch(from, to, { duration, peakHeight, toucher: null });
    },
    { from, to, duration, peakHeight },
  );
}

async function tapButton(page: Page, id: string) {
  const btn = page.locator(`#${id}`);
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function teleportPlayer(page: Page, pos: { x: number; y: number }) {
  await page.evaluate((pos) => {
    const g = (window as any).__game;
    g.state.player.pos.x = pos.x;
    g.state.player.pos.y = pos.y;
  }, pos);
}

test.describe('Pass button: controlled touch straight to the teammate', () => {
  test('opponents render statically at their home positions', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    await page.waitForTimeout(300);
    const after = await getState(page);

    expect(after.opponents).toEqual(before.opponents);
    for (const pos of after.opponents) {
      expect(pos.y).toBeLessThan(8);
    }
  });

  test('pressing Pass within range sends the ball straight to the teammate, from ordinary ground play', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Far corner, well outside the teammate's TEAMMATE_REACT_RADIUS (2.5m
    // from its home at (5.6, 11)) - otherwise the teammate itself would race
    // in and catch a ball this close to the player's own position first.
    await teleportPlayer(page, { x: 1, y: 15 });
    // A ball creeping along at the player's feet: the two hitboxes are
    // genuinely overlapping for the whole test, which is what contact now
    // requires. (The old setup sent the ball away on a 3m arc, so it was only
    // touching for the first few frames - fine under the previous "reach"
    // rule, never under a real touch.)
    await launchBall(page, { x: 1, y: 15 }, { x: 1, y: 15.1 }, 6, 0.08);

    // The pass is aimed relative to where the teammate is AT THE MOMENT OF
    // CONTACT - and it starts moving to receive the pass the instant it is
    // played, so its position has to be sampled per frame and frozen at
    // contact, not read afterwards. (Sampling must not block: the button is
    // only tapped once this is armed.)
    await page.evaluate(() => {
      const g = (window as any).__game;
      const w = window as any;
      w.__tmAtContact = null;
      let last = { ...g.state.teammate.pos };
      const sample = () => {
        if (w.__tmAtContact === null) {
          if (g.state.ball.lastToucher === 'player') w.__tmAtContact = last;
          else last = { ...g.state.teammate.pos };
        }
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });

    await tapButton(page, 'pass-btn');

    await page.waitForFunction(() => (window as any).__tmAtContact !== null, undefined, { timeout: 2000 });
    const contactPos: { x: number; y: number } = await page.evaluate(() => (window as any).__tmAtContact);

    const after = await getState(page);
    expect(after.ball.state).toBe('flying');
    expect(after.player.state).toBe('active'); // Pass doesn't require or trigger a jump/block
    // Aimed at the teammate's own column, but pulled toward the net so they
    // receive it in an attacking position (SET_NET_*) - the same set-up the
    // teammate gives the player, mirrored.
    expect(after.ball.target.x).toBeCloseTo(contactPos.x, 0);
    const expectedY = contactPos.y + (9.5 - contactPos.y) * 0.7;
    expect(after.ball.target.y).toBeCloseTo(expectedY, 1);
    expect(after.ball.target.y).toBeLessThan(contactPos.y); // pulled netward
    expect(after.ball.target.y).toBeGreaterThan(8); // but still on our own side
  });

  test('pressing Pass out of range does nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    const before = await getState(page);
    expect(before.ball.state).toBe('idle'); // ball sits at court center, far from the player

    await tapButton(page, 'pass-btn');
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
    expect(after.ball.state).toBe('idle');
  });

  test('Pass may be pressed before the ball arrives - it resolves the instant it comes into range', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Driven frame-by-frame inside the page. With INPUT_BUFFER_WINDOW now
    // 180ms, a real button click's own round-trip is the same order of
    // magnitude as the whole buffer, so the press has to be placed on an exact
    // frame relative to the touch - which is the entire point of this test.
    const r = await page.evaluate(() => {
      const g = (window as any).__game.state;
      g.teammate.update = () => {};
      for (const o of g.opponents) o.update = () => {};
      g.awaitingServe = null;
      const TOUCH = 0.5; // PLAYER_RADIUS + BALL_RADIUS
      const noInput = {
        move: { x: 0, y: 0 }, aim: null, swipe: null,
        jump: false, spike: false, pass: false, block: false, hit: false, serve: false,
      };
      const setUp = () => {
        g.player.state = 'active';
        g.player.height = 0;
        g.player.pos.x = 4;
        g.player.pos.y = 12;
        // Flat and slow, straight through the player's position.
        g.ball.launch({ x: 4, y: 15 }, { x: 4, y: 9 }, { duration: 3, peakHeight: 0.14, toucher: 'opponent1' });
      };
      const gap = () => Math.hypot(
        g.ball.pos.x - g.player.pos.x,
        g.ball.pos.y - g.ball.height - (g.player.pos.y - g.player.height),
      );

      // Dry run: which frame do the hitboxes first actually overlap on?
      setUp();
      let touchFrame = -1;
      for (let i = 0; i < 200 && touchFrame < 0; i++) {
        if (gap() <= TOUCH) touchFrame = i;
        g.player.update(0.016, noInput, g.ball, g.teammate.pos, false);
        g.ball.update(0.016);
      }

      // Real run: press 96ms (6 frames) BEFORE that.
      setUp();
      const pressFrame = touchFrame - 6;
      let contactFrame = -1;
      let touchedFrame = -1;
      for (let i = 0; i < 200; i++) {
        const before = g.ball.lastToucher;
        if (touchedFrame < 0 && gap() <= TOUCH) touchedFrame = i;
        g.player.update(0.016, { ...noInput, ['pass']: i === pressFrame }, g.ball, g.teammate.pos, false);
        if (before !== 'player' && g.ball.lastToucher === 'player' && contactFrame < 0) contactFrame = i;
        g.ball.update(0.016);
      }
      return { pressFrame, touchedFrame, contactFrame, toucher: g.ball.lastToucher };
    });

    // The press came first, but the contact waited for the ball.
    expect(r.contactFrame).toBeGreaterThan(r.pressFrame);
    expect(r.contactFrame).toBe(r.touchedFrame);
    expect(r.toucher).toBe('player');
  });
});
