import { Ball } from '../entities/Ball';
import { Vec2, clamp } from '../utils/math';
import {
  BLOCK_DURATION,
  BLOCK_FALL_DURATION,
  BLOCK_HALF_WIDTH,
  BLOCK_MAX_HEIGHT,
  BLOCK_MIN_HEIGHT,
  BLOCK_NET_BAND,
  BLOCK_PEAK_HEIGHT,
  BLOCK_RETURN_DEPTH,
  BLOCK_RETURN_MARGIN,
  BLOCK_RISE_DURATION,
  COURT_WIDTH,
  NET_Y,
} from './constants';

/**
 * The block, shared by the human player and the AI teammate so the two can
 * never drift apart: one definition of what the wall covers, one definition of
 * how a blocked ball rebounds, one definition of the animation.
 *
 * Both blockers are on the human side, so "the attacker's side" is always the
 * opponent half - the direction never has to be parameterised.
 */

/** Whether the ball is, right now, passing through the wall a blocker standing
 * at `blockerPos` has up. Four conditions, all measured against the ball's
 * LIVE position and height (never ball.target, the landing prediction):
 *
 * - it is an opponent's ball on its way into our half. Our own shots, and a
 *   ball the opponents have faulted onto their own side, are not blockable.
 * - it is at the net, within BLOCK_NET_BAND of the net line.
 * - it is within BLOCK_HALF_WIDTH of the blocker laterally - the wall has a
 *   width, and a ball down the opposite line goes past it.
 * - it is inside the height band the raised block covers: under it a dink
 *   slips beneath, over it a lob sails past.
 */
export function ballIsBlockable(ball: Ball, blockerPos: Vec2): boolean {
  if (ball.state !== 'flying') return false;
  if (ball.lastToucher !== 'opponent1' && ball.lastToucher !== 'opponent2') return false;
  if (ball.target.y <= NET_Y) return false;
  if (Math.abs(ball.pos.y - NET_Y) > BLOCK_NET_BAND) return false;
  if (Math.abs(ball.pos.x - blockerPos.x) > BLOCK_HALF_WIDTH) return false;
  return ball.height >= BLOCK_MIN_HEIGHT && ball.height <= BLOCK_MAX_HEIGHT;
}

/** Where a blocked ball goes: straight back down onto the attacker's own side,
 * just past the net and in the column it came through. Deliberately nothing
 * like a normal reception, which is aimed at a teammate or at a generous spot
 * across the court - this is a rebound off a wall. */
export function blockReboundTarget(ball: Ball): Vec2 {
  return {
    x: clamp(ball.pos.x, BLOCK_RETURN_MARGIN, COURT_WIDTH - BLOCK_RETURN_MARGIN),
    y: NET_Y - BLOCK_RETURN_DEPTH,
  };
}

/** The block's visual lift over its lifetime: up fast, held at full height for
 * the bulk of the move, then down. A trapezoid rather than an arc because the
 * hold is the point - the wall has to actually stand there for a while. */
export function blockHeightAt(t: number): number {
  if (t <= 0) return 0;
  if (t < BLOCK_RISE_DURATION) return BLOCK_PEAK_HEIGHT * (t / BLOCK_RISE_DURATION);
  const fallStart = BLOCK_DURATION - BLOCK_FALL_DURATION;
  if (t >= BLOCK_DURATION) return 0;
  if (t > fallStart) return BLOCK_PEAK_HEIGHT * ((BLOCK_DURATION - t) / BLOCK_FALL_DURATION);
  return BLOCK_PEAK_HEIGHT;
}
