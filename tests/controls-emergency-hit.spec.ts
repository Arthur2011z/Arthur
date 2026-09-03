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

async function teleportPlayer(page: Page, pos: { x: number; y: number }) {
  await page.evaluate((pos) => {
    const g = (window as any).__game;
    g.state.player.pos.x = pos.x;
    g.state.player.pos.y = pos.y;
  }, pos);
}

async function tapButton(page: Page, id: string) {
  const btn = page.locator(`#${id}`);
  const box = await btn.boundingBox();
  if (!box) throw new Error(`${id} not found`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

test.describe('Notfall-Schlag: small, no-jump, always-safe fallback', () => {
  test('sends the ball back over the net without jumping, from ordinary ground play', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await teleportPlayer(page, { x: 1, y: 15 });
    // A ball creeping along at the player's feet: the two hitboxes are
    // genuinely overlapping for the whole test, which is what contact now
    // requires. (The old setup sent the ball away on a 3m arc, so it was only
    // touching for the first few frames - fine under the previous "reach"
    // rule, never under a real touch.)
    await launchBall(page, { x: 1, y: 15 }, { x: 1, y: 15.1 }, 6, 0.08);

    await tapButton(page, 'hit-btn');

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 1000,
    });
    const after = await getState(page);
    expect(after.player.state).toBe('active'); // no jump involved
    expect(after.ball.target.y).toBeLessThan(8); // over the net
  });

  test('pressing it out of range does nothing', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    await tapButton(page, 'hit-btn');
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.ball.lastToucher).toBeNull();
  });

  test('may be pressed before the ball arrives - resolves the instant it comes into range', async ({ page }) => {
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
        g.ball.pos.y - g.player.pos.y,
        g.ball.height - g.player.height,
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
        g.player.update(0.016, { ...noInput, ['hit']: i === pressFrame }, g.ball, g.teammate.pos, false);
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

  test('a light assist walk pulls the player toward a ball inside ASSIST_RANGE while Notfall-Schlag is held', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);

    // Ball's flight stays entirely "above" the player (both endpoints closer
    // to the net) - its nearest point is the flight's own end (4, 9.8), 0.9m
    // from the player: inside ASSIST_RANGE (1.0m) but outside HIT_RANGE
    // (0.7m), so the assist walk (not the joystick) should visibly close
    // the gap, straight toward the net. That band is narrow by design - the
    // assist is a last-stride nudge now, not a way to travel.
    await teleportPlayer(page, { x: 4, y: 10.7 });
    await launchBall(page, { x: 4, y: 9 }, { x: 4, y: 9.8 }, 3);

    await tapButton(page, 'hit-btn');
    await page.waitForTimeout(200);

    const after = await getState(page);
    expect(after.player.pos.y).toBeLessThan(10.7); // moved toward the ball on its own
  });
});
