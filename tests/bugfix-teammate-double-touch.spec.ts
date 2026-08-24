import { test, expect, Page } from '@playwright/test';
import { distIndex } from './helpers';

/**
 * Regression coverage for: the AI teammate touching the same ball more than
 * once in a row within a single rally exchange. Root cause was
 * shouldReact() having no memory of "I just hit this ball" - playBall()
 * transitions synchronously to 'returning', but if the teammate was already
 * standing right at (or very near) its target base at the moment of
 * contact, updateReturning() could snap it straight back to 'home' within a
 * frame or two, at which point the ball it JUST launched was still flying
 * right next to it (well inside TEAMMATE_REACT_RADIUS) - so shouldReact()
 * fired again and sent it straight back into 'moving_to_ball' to re-catch
 * its own shot, sometimes repeatedly. Fixed by excluding
 * ball.lastToucher === 'teammate' in both shouldReact() and (defensively)
 * updateMovingToBall()'s own contact condition.
 */

async function stubNonTeammateEntities(page: Page) {
  await page.evaluate(() => {
    const g = (window as any).__game;
    g.state.player.update = () => {};
    for (const o of g.state.opponents) o.update = () => {};
  });
}

test.describe('Bugfix 4: AI teammate never re-catches the very ball it just launched', () => {
  test('a ball arriving exactly at the teammate\'s own base produces exactly one teammate touch', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubNonTeammateEntities(page);

    const contactLogs: string[] = [];
    page.on('console', (msg) => {
      if (msg.text().includes('[BallContact] teammate')) contactLogs.push(msg.text());
    });

    await page.evaluate(() => {
      const g = (window as any).__game;
      // Park the teammate exactly at its own current base and fire a ball
      // that arrives exactly there, low and slow - the scenario most likely
      // to snap it straight back to 'home' within a frame or two of
      // catching it, which is what used to trigger the immediate re-catch.
      const home = { ...g.state.teammate.homePos };
      g.state.teammate.pos.x = home.x;
      g.state.teammate.pos.y = home.y;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: home.x, y: home.y - 2 }, { x: home.x, y: home.y }, { duration: 1, peakHeight: 1, toucher: null });
    });

    // Wait for the teammate's own follow-up shot (set/emergency-set,
    // duration <= 1.5s) to fully play out too, so a spurious second touch
    // on this same rally would have had time to happen.
    await page.waitForTimeout(3000);

    expect(contactLogs.length).toBe(1);
  });

  test('the teammate does not oscillate moving_to_ball -> returning -> home -> moving_to_ball after its own hit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(distIndex);
    await stubNonTeammateEntities(page);

    await page.evaluate(() => {
      const g = (window as any).__game;
      const home = { ...g.state.teammate.homePos };
      g.state.teammate.pos.x = home.x;
      g.state.teammate.pos.y = home.y;
      g.state.teammate.state = 'home';
      g.state.ball.launch({ x: home.x, y: home.y - 2 }, { x: home.x, y: home.y }, { duration: 1, peakHeight: 1, toucher: null });
    });

    // Once the teammate has touched the ball (lastToucher flips to
    // 'teammate'), it must never re-enter 'moving_to_ball' again for this
    // same still-flying shot.
    await page.waitForFunction(() => (window as any).__game.state.ball.lastToucher === 'teammate', undefined, {
      timeout: 2000,
    });

    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(50);
      const s = await page.evaluate(() => ({
        teammateState: (window as any).__game.state.teammate.state,
        ballLastToucher: (window as any).__game.state.ball.lastToucher,
        ballState: (window as any).__game.state.ball.state,
      }));
      if (s.ballLastToucher === 'teammate' && s.ballState === 'flying') {
        expect(s.teammateState).not.toBe('moving_to_ball');
      }
    }
  });
});
