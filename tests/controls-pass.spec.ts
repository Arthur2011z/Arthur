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
    // Ball right next to the player, well inside HIT_RANGE - no Sprung/Hecht
    // needed at all, this is plain in-range contact.
    await launchBall(page, { x: 1, y: 14.7 }, { x: 1, y: 4 }, 5);

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
    expect(after.player.state).toBe('active'); // Pass doesn't require or trigger a jump/dive
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

    // Far corner (see the test above for why - keeps the teammate from
    // racing in first).
    await teleportPlayer(page, { x: 1, y: 15 });
    // Ball starts deep behind the player and drifts slowly down through
    // their position toward the opponent half - it only enters HIT_RANGE
    // roughly a second in, giving the "too early" check below a comfortable
    // margin against round-trip timing. Low peakHeight (1m, vs. the helper's
    // 3m default) so the ball is actually near ground level - and so within
    // CATCHABLE_HEIGHT - at the moment it passes through the player, instead
    // of sailing overhead at ~2.7m right as it crosses their position.
    await launchBall(page, { x: 1, y: 21 }, { x: 1, y: 4 }, 4, 1);

    await tapButton(page, 'pass-btn');
    const rightAfterPress = await getState(page);
    expect(rightAfterPress.ball.lastToucher).toBeNull(); // still far away, too early

    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'player', undefined, {
      timeout: 3000,
    });
    // Same caveat as the test above: the teammate moves as soon as the pass is
    // played, so compare against the target's own geometry rather than a
    // position read after the fact. The pass must stay on our own side and be
    // pulled toward the net relative to where it was aimed.
    const after = await getState(page);
    expect(after.ball.target.y).toBeGreaterThan(8); // still our own half
    expect(after.ball.target.y).toBeLessThan(13); // and pulled up toward the net
  });
});
