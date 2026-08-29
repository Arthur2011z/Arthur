import { Page, expect, test } from '@playwright/test';
import { distIndex } from './helpers';

const NET_Y = 8;

interface Outcome {
  /** Where the ball went after the net AI played it. */
  crossed: boolean;
  /** Reached the partner's side of the court rather than dying on the spot. */
  setToPartner: boolean;
  /** Straight up and back down within a metre of where it was struck: the
   * failure this test exists for. */
  wentNowhere: boolean;
  /** Landed in the human half *and* inside the lines: a genuinely good attack.
   * A ball flying past the side line still crosses the net, so counting every
   * crossing as good would hide exactly the misses this measures. */
  landedGood: boolean;
}

/**
 * Feeds one ball to the opponent standing at the net and reports what it did
 * with it. `touches` is how many contacts the opponents have already used, so
 * the same helper covers "still has options" and "must cross now".
 */
async function feedNetAi(page: Page, touches: number): Promise<Outcome | null> {
  return page.evaluate(async ({ touches, netY }) => {
    const g = window.__game!;
    const s = g.state;

    s.autoServe = false;
    s.awaitingServe = false;
    s.phase = 'rally';
    // Cleared through a closure so TypeScript does not narrow s.lastEvent to
    // null for the rest of this function - the game fills it in again while we
    // are awaiting below.
    const clearEvent = () => {
      g.state.lastEvent = null;
    };
    clearEvent();
    s.score = { human: 0, opponents: 0 };
    s.winner = null;
    s.player.resetForNewRally();
    for (const ai of s.aiAthletes) ai.resetForNewRally();

    // opponent1 at the net, opponent2 back.
    s.opponents[0].pos = { x: 4, y: netY - 1.8 };
    s.opponents[1].pos = { x: 4.5, y: netY - 5.5 };
    // The human side genuinely stays out of it. Standing them at the back is
    // not enough - the teammate reaches six metres and digs a crossing attack,
    // and a dug ball never lands, so every working attack would come back
    // unmeasured. Taking its reach away lets the ball finish its flight.
    s.player.pos = { x: 0.5, y: 15.5 };
    s.teammate.pos = { x: 7.5, y: 15.5 };
    s.teammate.profile.defenceReach = 0;
    s.teammate.profile.blockChance = 0;

    s.rally.possession = 'opponents';
    s.rally.touches = touches;
    s.rally.lastToucher = touches === 0 ? 'player' : 'opponent2';

    // Drop a ball onto the net player.
    const struckFrom = { x: 4, y: netY - 1.8 };
    s.ball.strike({ x: struckFrom.x, y: struckFrom.y, z: 4.2 }, { x: 0, y: 0, z: 0 }, s.rally.lastToucher);

    const waitFor = (test: () => boolean, ms: number) =>
      new Promise<boolean>((resolve) => {
        const started = performance.now();
        const tick = () => {
          if (test()) return resolve(true);
          if (performance.now() - started > ms) return resolve(false);
          requestAnimationFrame(tick);
        };
        tick();
      });

    // Wait for the net player to actually touch it.
    const touched = await waitFor(() => s.ball.lastToucher === 'opponent1', 4000);
    if (!touched) return null;

    // Then let the flight finish - either it lands, or somebody else plays it.
    await waitFor(() => s.lastEvent !== null || s.ball.lastToucher !== 'opponent1', 6000);

    const event = s.lastEvent;
    const landed = event === null ? null : { ...event.at };
    const inBounds = event !== null && event.type === 'landed' && event.inBounds;
    const takenOver = s.ball.lastToucher !== 'opponent1';

    // "Went nowhere": nobody else ever got to play it and it came down on their
    // own side, within a couple of metres of where it was struck.
    //
    // Deliberately measured from where the ball ended up, not from how fast it
    // left. A correct set is a soft, high, floating ball - measured at about
    // 1.1 m/s horizontally - so any speed threshold high enough to catch the
    // bug would count every good set as the bug.
    const travelled = landed
      ? Math.hypot(landed.x - struckFrom.x, landed.y - struckFrom.y)
      : Infinity;

    return {
      crossed: landed ? landed.y > netY : takenOver && s.ball.pos.y > netY,
      setToPartner: takenOver && s.ball.lastToucher === 'opponent2',
      wentNowhere: !takenOver && landed !== null && landed.y < netY && travelled < 2,
      landedGood: inBounds && landed !== null && landed.y > netY,
    };
  }, { touches, netY: NET_Y });
}

test.beforeEach(async ({ page }) => {
  await page.goto(distIndex);
  await page.waitForFunction(() => window.__game !== undefined);
});

test('the net opponent plays 21 balls sensibly instead of straight up', async ({ page }) => {
  // Twenty-one complete ball flights, one after another, do not fit in the
  // default timeout.
  test.setTimeout(120_000);
  const outcomes: Outcome[] = [];
  // Alternate "has contacts left" and "must cross", so both branches of the
  // decision are covered across the run.
  for (let i = 0; i < 21; i += 1) {
    const outcome = await feedNetAi(page, i % 2 === 0 ? 0 : 2);
    expect(outcome).not.toBeNull();
    outcomes.push(outcome!);
  }

  const nowhere = outcomes.filter((o) => o.wentNowhere).length;
  const useful = outcomes.filter((o) => o.crossed || o.setToPartner).length;

  // The bug this covers: the net player used to lob almost every ball straight
  // up and let it die on its own side.
  expect(nowhere).toBeLessThanOrEqual(2);
  expect(useful).toBeGreaterThanOrEqual(16);
});

test('with contacts left it reaches its partner rather than itself', async ({ page }) => {
  let reached = 0;
  const runs = 12;
  for (let i = 0; i < runs; i += 1) {
    const o = await feedNetAi(page, 0);
    expect(o).not.toBeNull();
    if (o!.setToPartner || o!.crossed) reached += 1;
  }
  expect(reached).toBeGreaterThanOrEqual(9);
});

test('on its last contact it puts the ball over the net', async ({ page }) => {
  let crossed = 0;
  const runs = 12;
  for (let i = 0; i < runs; i += 1) {
    const o = await feedNetAi(page, 2);
    expect(o).not.toBeNull();
    if (o!.crossed) crossed += 1;
  }
  // Most attacks cross. Some still miss - that is the intended weakness, and
  // the next test holds it in place.
  expect(crossed).toBeGreaterThanOrEqual(8);
});

test('its attacks stay fallible - it is fixed, not made unbeatable', async ({ page }) => {
  test.setTimeout(120_000);
  let good = 0;
  const runs = 20;
  for (let i = 0; i < runs; i += 1) {
    const o = await feedNetAi(page, 2);
    expect(o).not.toBeNull();
    if (o!.landedGood) good += 1;
  }
  // Measured over 100 undefended attacks: about 70% land in, the rest go out,
  // into the net, or short. Comfortably short of perfect - the player has to be
  // able to win points off the opponents' own mistakes - and comfortably short
  // of useless, which is the bug this file exists for.
  expect(good / runs).toBeLessThanOrEqual(0.9);
  expect(good / runs).toBeGreaterThanOrEqual(0.4);
});
