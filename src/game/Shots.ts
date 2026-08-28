import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Vec2, Vec3, clamp, dot } from '../utils/math';
import {
  COURT_LENGTH,
  COURT_WIDTH,
  EMERGENCY_DEEP_DEPTH,
  EMERGENCY_LATERAL,
  EMERGENCY_SHORT_DEPTH,
  EMERGENCY_SPEED_JITTER,
  EMERGENCY_SPREAD_RAD,
  NET_Y,
  PASS_ARRIVAL_HEIGHT,
  PASS_NET_DEPTH,
  PASS_SPEED_JITTER,
  PASS_SPREAD_RAD,
  PASS_TIME,
} from './constants';
import { applySpread, velocityOverNet, velocityToAirTarget } from './Physics';

/** Unit vector from an athlete's own half toward the net, in court space. */
export const towardNet = (athlete: Athlete): Vec2 =>
  athlete.team === 'human' ? { x: 0, y: -1 } : { x: 0, y: 1 };

/**
 * Pass: a set delivered to the partner, aimed at the air above their side of
 * the court close to the net rather than at their feet.
 *
 * The spec asks for a pass played "into the partner's run toward the net", and
 * this is what that means concretely: the ball is put where an attack can be
 * launched from, and the partner comes to meet it - instead of the ball being
 * dropped wherever they happen to be standing right now.
 */
export function passShot(passer: Athlete, ball: Ball, partner: Athlete): Vec3 {
  const forward = towardNet(passer);
  const target: Vec3 = {
    x: clamp(partner.pos.x, 1, COURT_WIDTH - 1),
    y: NET_Y + forward.y * -PASS_NET_DEPTH,
    z: PASS_ARRIVAL_HEIGHT,
  };
  const velocity = velocityToAirTarget(ball.pos, target, PASS_TIME);
  return applySpread(velocity, PASS_SPREAD_RAD, PASS_SPEED_JITTER);
}

/**
 * Notfall: a plain shot over the net, playable from anywhere on the court.
 *
 * The held direction steers it: sideways moves it cross-court, pushing toward
 * the net drops it short, pulling back sends it deep. With nothing held it
 * goes straight ahead into the middle of the far half.
 *
 * The aimed target is kept inside the lines - that is what the player meant -
 * but the shot itself is scattered afterwards and never corrected, so a
 * mis-hit can and does land out.
 */
export function emergencyShot(hitter: Athlete, ball: Ball, aim: Vec2 | null): Vec3 {
  const forward = towardNet(hitter);

  // -1 = pulled fully back (deep), +1 = pushed fully toward the net (short).
  const push = aim ? clamp(dot(aim, forward), -1, 1) : 0;
  const depth = EMERGENCY_SHORT_DEPTH + ((1 - push) / 2) * (EMERGENCY_DEEP_DEPTH - EMERGENCY_SHORT_DEPTH);

  // Lateral aim is the component across the court, independent of which way
  // this team is facing.
  const lateral = aim ? clamp(aim.x, -1, 1) : 0;

  const target: Vec2 = {
    x: clamp(ball.pos.x + lateral * EMERGENCY_LATERAL, 0.4, COURT_WIDTH - 0.4),
    y: clamp(NET_Y + forward.y * depth, 0.4, COURT_LENGTH - 0.4),
  };

  const velocity = velocityOverNet(ball.pos, target, 0.35);
  return applySpread(velocity, EMERGENCY_SPREAD_RAD, EMERGENCY_SPEED_JITTER);
}
