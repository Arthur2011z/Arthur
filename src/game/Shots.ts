import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Vec2, Vec3, clamp, dot } from '../utils/math';
import {
  BLOCK_DAMPING,
  BLOCK_DOWNWARD,
  BLOCK_LATERAL_KEEP,
  BLOCK_MIN_SPEED,
  COURT_LENGTH,
  COURT_WIDTH,
  EMERGENCY_DEEP_DEPTH,
  EMERGENCY_LATERAL,
  EMERGENCY_SHORT_DEPTH,
  EMERGENCY_SPEED_JITTER,
  EMERGENCY_SPREAD_RAD,
  NET_HEIGHT,
  NET_Y,
  PASS_ARRIVAL_HEIGHT,
  PASS_LEAD,
  PASS_MAX_DEPTH,
  PASS_MIN_DEPTH,
  PASS_SPEED_JITTER,
  PASS_SPREAD_RAD,
  PASS_TIME,
  SPIKE_DEEP_DEPTH,
  SPIKE_LATERAL,
  SPIKE_POWER_RANGE,
  SPIKE_SHORT_DEPTH,
  SPIKE_SPEED_JITTER,
  SPIKE_SPEED_MAX,
  SPIKE_SPEED_MIN,
  SPIKE_SPREAD_RAD,
  SPIKE_SWIPE_INFLUENCE,
} from './constants';
import {
  applySpread,
  velocityOverNet,
  velocityToAirTarget,
  velocityToTarget,
} from './Physics';

/** Unit vector from an athlete's own half toward the net, in court space. */
export const towardNet = (athlete: Athlete): Vec2 =>
  athlete.team === 'human' ? { x: 0, y: -1 } : { x: 0, y: 1 };

/**
 * The y coordinate `depth` meters into this athlete's *own* half, and the same
 * `depth` into the half they are attacking.
 *
 * Both sides mirror around the net, and getting that sign wrong produces a
 * target on the wrong side of the court - which is easy to do and hard to see.
 * Naming the two directions once removes the trap.
 */
export const ownHalfY = (athlete: Athlete, depth: number): number =>
  athlete.team === 'human' ? NET_Y + depth : NET_Y - depth;

export const farHalfY = (athlete: Athlete, depth: number): number =>
  athlete.team === 'human' ? NET_Y - depth : NET_Y + depth;

/**
 * Where a set is aimed: the partner's own position, led toward the net so they
 * can attack from it.
 *
 * Anchoring it to where the partner actually stands is the point. A fixed
 * depth would work for a back-court player setting forward and be useless for
 * anyone already standing at the net - their "set" would land on top of them,
 * which is precisely how the net player's shots used to die on their own side.
 */
export function passTarget(passer: Athlete, partner: Athlete): Vec2 {
  const depth = clamp(partner.distanceToNet - PASS_LEAD, PASS_MIN_DEPTH, PASS_MAX_DEPTH);
  return {
    x: clamp(partner.pos.x, 1, COURT_WIDTH - 1),
    y: ownHalfY(passer, depth),
  };
}

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
  const ground = passTarget(passer, partner);
  const target: Vec3 = { x: ground.x, y: ground.y, z: PASS_ARRIVAL_HEIGHT };
  const velocity = velocityToAirTarget(ball.pos, target, PASS_TIME);
  return applySpread(velocity, PASS_SPREAD_RAD, PASS_SPEED_JITTER);
}

/**
 * An attack aimed at an explicit point, for the AI.
 *
 * The AI thinks in landing spots, so it hands one over directly instead of
 * encoding it as a direction. Going through the human's directional aim would
 * lose the distinction entirely: there a direction pointing at the net means
 * "drop it short", so every AI attack came back out re-aimed to the shortest
 * depth on the court no matter where it had meant to hit.
 *
 * A spike is only chosen when the ball is high enough above the tape for one
 * to clear it; otherwise the ball goes over on an arc that is guaranteed to.
 * Neither path corrects the target, so a sloppy aim still lands out.
 */
export function aiAttackShot(
  attacker: Athlete,
  ball: Ball,
  target: Vec2,
  spike: boolean,
  scatter: number,
): Vec3 {
  const velocity = spike
    ? spikeVelocity(ball.pos, target, spikePower(attacker.distanceToNet, null))
    : velocityOverNet(ball.pos, target, 0.35);
  return applySpread(velocity, SPIKE_SPREAD_RAD * scatter, SPIKE_SPEED_JITTER * scatter);
}

/**
 * Where a spike is aimed, given a direction and the attacker.
 *
 * Sideways aim moves it cross-court; pushing toward the net drops it short,
 * pulling back sends it deep. The result is deliberately *not* clamped to the
 * court: aiming at the very edge has to be able to miss, or aiming would carry
 * no risk and picking a corner would be free.
 */
export function spikeTarget(attacker: Athlete, from: Vec3, aim: Vec2 | null): Vec2 {
  const forward = towardNet(attacker);
  const push = aim ? clamp(dot(aim, forward), -1, 1) : 0;
  const depth = SPIKE_SHORT_DEPTH + ((1 - push) / 2) * (SPIKE_DEEP_DEPTH - SPIKE_SHORT_DEPTH);
  const lateral = aim ? clamp(aim.x, -1, 1) : 0;

  return {
    x: from.x + lateral * SPIKE_LATERAL,
    y: NET_Y + forward.y * depth,
  };
}

/**
 * How hard a spike is hit. The dominant term is how close to the net the
 * attacker took off - close in is a dangerous, fast ball, from deep it is
 * something the defence has time to read. On touch, the length of the swipe
 * trims it a little either way.
 */
export function spikePower(netDistanceAtTakeoff: number, swipeStrength: number | null): number {
  const closeness = clamp(1 - netDistanceAtTakeoff / SPIKE_POWER_RANGE, 0, 1);
  const base = SPIKE_SPEED_MIN + closeness * (SPIKE_SPEED_MAX - SPIKE_SPEED_MIN);
  if (swipeStrength === null) return base;
  return base * (1 + (swipeStrength - 0.5) * SPIKE_SWIPE_INFLUENCE);
}

/**
 * The spike itself: it travels to `target` at the speed the power dictates,
 * and the flight time follows from those two rather than being chosen. Aim
 * decides where, power decides how quickly it gets there - which is exactly
 * how little time the defence has to react.
 *
 * A weak shot aimed deep therefore arcs; a hard one aimed short is driven
 * almost straight down. Both are real projectile flights, and neither is
 * corrected afterwards.
 */
export function spikeVelocity(from: Vec3, target: Vec2, speed: number): Vec3 {
  const distance = Math.hypot(target.x - from.x, target.y - from.y);
  const time = Math.max(0.12, distance / Math.max(1, speed));
  return velocityToTarget(from, target, time);
}

/**
 * A spike, aimed and scattered, ready to hand to Ball.strike().
 *
 * `scatter` scales the randomness: the aiming preview passes 0 to draw the
 * intended flight, since the scatter is not knowable before the swing, and
 * everything else leaves it at 1.
 */
export function spikeShot(
  attacker: Athlete,
  ball: Ball,
  aim: Vec2 | null,
  netDistanceAtTakeoff: number,
  swipeStrength: number | null,
  scatter = 1,
): Vec3 {
  const target = spikeTarget(attacker, ball.pos, aim);
  const speed = spikePower(netDistanceAtTakeoff, swipeStrength);
  const velocity = spikeVelocity(ball.pos, target, speed);
  return applySpread(velocity, SPIKE_SPREAD_RAD * scatter, SPIKE_SPEED_JITTER * scatter);
}

/**
 * Block: the ball is rejected rather than played. It goes straight back the
 * way it came, driven downward, and reads nothing like a normal dig.
 *
 * How hard it is driven down depends on how far above the tape it was caught.
 * A ball met barely at net height is pushed back gently, because hammering it
 * downward from there would only bury it in the net; one met well above the
 * tape is put straight into the sand. That keeps the block rewarding when it
 * is well timed without turning a marginal one into a self-inflicted fault.
 */
export function blockShot(blocker: Athlete, ball: Ball): Vec3 {
  const forward = towardNet(blocker);
  const incoming = Math.hypot(ball.vel.x, ball.vel.y);
  const rebound = Math.max(BLOCK_MIN_SPEED, incoming * BLOCK_DAMPING);
  const clearance = Math.max(0, ball.pos.z - NET_HEIGHT);

  return {
    x: ball.vel.x * BLOCK_LATERAL_KEEP,
    y: forward.y * rebound,
    z: -Math.min(BLOCK_DOWNWARD, 1 + clearance * 12),
  };
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
