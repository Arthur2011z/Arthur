import { Athlete, TeamId } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Vec2, Vec3 } from '../utils/math';
import { ballTouches } from './Contact';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  GRAVITY,
  MAX_FLIGHT_TIME,
  NET_HEIGHT,
  NET_Y,
  PHYSICS_SUBSTEP,
} from './constants';

/** Why a flight ended. Both end the rally; the rule engine decides the point. */
export interface BallEvent {
  type: 'landed' | 'net';
  /** Where it happened, in court space. */
  at: Vec3;
  /** 'landed' only: inside the lines? A ball on the line is in. */
  inBounds: boolean;
  /** Which half it happened over. */
  side: TeamId;
}

export interface PhysicsHooks {
  /**
   * Called in the exact substep the ball's hitbox first overlaps `athlete`.
   * Return true if the athlete actually played the ball - in which case the
   * handler must already have replaced the ball's velocity, and integration
   * continues from there with the new one.
   *
   * `atMs` is the wall-clock timestamp of that substep, not of the frame, so
   * the contact log resolves well below one frame.
   */
  onTouch?(athlete: Athlete, ball: Ball, atMs: number): boolean;
  /** Called whenever the ball legally passes over the net. */
  onNetCross?(ball: Ball, to: TeamId): void;
}

/** One fixed integration step of a projectile under gravity. Semi-implicit
 * Euler: exact in x/y, and with a 1/240s step the height error over a whole
 * flight stays far below the ball's own radius. Both the live ball and the
 * aiming preview go through this same function, which is what guarantees the
 * preview shows the flight the player will actually get. */
function integrate(pos: Vec3, vel: Vec3, h: number): void {
  vel.z -= GRAVITY * h;
  pos.x += vel.x * h;
  pos.y += vel.y * h;
  pos.z += vel.z * h;
}

const sideOf = (y: number): TeamId => (y > NET_Y ? 'human' : 'opponents');

/** Lines count as in. */
const inBounds = (p: Vec3): boolean =>
  p.x >= 0 && p.x <= COURT_WIDTH && p.y >= 0 && p.y <= COURT_LENGTH;

/**
 * Advances a live ball by `dt` seconds in fixed substeps, resolving contacts,
 * the net and the ground as they happen rather than once per frame.
 *
 * Returns the event that ended the flight, or null if the ball is still up.
 */
export function advance(
  ball: Ball,
  dt: number,
  athletes: Athlete[],
  hooks: PhysicsHooks,
  nowMs: number,
): BallEvent | null {
  if (ball.state !== 'live') return null;

  let remaining = Math.min(dt, MAX_FLIGHT_TIME);
  let elapsed = 0;

  while (remaining > 1e-9) {
    const h = Math.min(PHYSICS_SUBSTEP, remaining);
    remaining -= h;
    elapsed += h;

    const before: Vec3 = { ...ball.pos };
    integrate(ball.pos, ball.vel, h);

    const atMs = nowMs + elapsed * 1000;
    ball.contactLock = Math.max(0, ball.contactLock - h);

    if (ball.contactLock <= 0) resolveTouch(ball, athletes, hooks, atMs);

    const netFault = crossNet(ball, before, hooks);
    if (netFault) return netFault;

    const landing = land(ball, before);
    if (landing) return landing;
  }

  return null;
}

/** At most one athlete plays any given substep: the closest one whose hitbox
 * the ball is inside. Without that, two players standing together could both
 * be offered the same contact. */
function resolveTouch(ball: Ball, athletes: Athlete[], hooks: PhysicsHooks, atMs: number): void {
  if (!hooks.onTouch) return;

  let best: Athlete | null = null;
  let bestDist = Infinity;
  for (const athlete of athletes) {
    if (!ballTouches(ball, athlete)) continue;
    const d = Math.hypot(ball.pos.x - athlete.pos.x, ball.pos.y - athlete.pos.y);
    if (d < bestDist) {
      bestDist = d;
      best = athlete;
    }
  }
  if (best) hooks.onTouch(best, ball, atMs);
}

/** The net is a solid plane at y = NET_Y reaching up to NET_HEIGHT. Anything
 * crossing below the tape is a net fault; anything crossing above it is a
 * legal transfer to the other side. */
function crossNet(ball: Ball, before: Vec3, hooks: PhysicsHooks): BallEvent | null {
  const wasFar = before.y <= NET_Y;
  const isFar = ball.pos.y <= NET_Y;
  if (wasFar === isFar) return null;

  const span = ball.pos.y - before.y;
  const t = Math.abs(span) < 1e-9 ? 0 : (NET_Y - before.y) / span;
  const crossing: Vec3 = {
    x: before.x + (ball.pos.x - before.x) * t,
    y: NET_Y,
    z: before.z + (ball.pos.z - before.z) * t,
  };

  if (crossing.z < NET_HEIGHT) {
    ball.pos = crossing;
    ball.kill();
    return { type: 'net', at: crossing, inBounds: true, side: sideOf(before.y) };
  }

  hooks.onNetCross?.(ball, sideOf(ball.pos.y));
  return null;
}

/** Touchdown, resolved back to the exact point the ball reached the sand. */
function land(ball: Ball, before: Vec3): BallEvent | null {
  if (ball.pos.z > BALL_RADIUS) return null;

  const drop = before.z - ball.pos.z;
  const t = drop < 1e-9 ? 0 : (before.z - BALL_RADIUS) / drop;
  const at: Vec3 = {
    x: before.x + (ball.pos.x - before.x) * t,
    y: before.y + (ball.pos.y - before.y) * t,
    z: BALL_RADIUS,
  };
  ball.pos = at;
  ball.kill();
  return { type: 'landed', at, inBounds: inBounds(at), side: sideOf(at.y) };
}

/**
 * Runs the same integrator forward from a hypothetical launch, without any
 * players in the way, and returns the path it would take. This is what the
 * aiming preview draws - so the glowing line is not a sketch of the shot, it
 * is the shot, computed ahead of time.
 */
export function simulate(from: Vec3, velocity: Vec3, maxTime = MAX_FLIGHT_TIME): Vec3[] {
  const pos: Vec3 = { ...from };
  const vel: Vec3 = { ...velocity };
  const path: Vec3[] = [{ ...pos }];

  let elapsed = 0;
  while (elapsed < maxTime) {
    const before: Vec3 = { ...pos };
    integrate(pos, vel, PHYSICS_SUBSTEP);
    elapsed += PHYSICS_SUBSTEP;

    // Stop at the net, exactly as the live ball would.
    const crossed = before.y <= NET_Y !== pos.y <= NET_Y;
    if (crossed) {
      const span = pos.y - before.y;
      const t = Math.abs(span) < 1e-9 ? 0 : (NET_Y - before.y) / span;
      const z = before.z + (pos.z - before.z) * t;
      if (z < NET_HEIGHT) {
        path.push({ x: before.x + (pos.x - before.x) * t, y: NET_Y, z });
        break;
      }
    }

    if (pos.z <= BALL_RADIUS) {
      path.push({ ...pos, z: BALL_RADIUS });
      break;
    }
    path.push({ ...pos });
  }
  return path;
}

/**
 * Velocity that carries the ball from `from` to the ground point `target` in
 * exactly `time` seconds. Used by shots that are conceived as "put it there"
 * (AI returns, sets) - the resulting flight is still ordinary projectile
 * motion, with no steering along the way.
 */
export function velocityToTarget(from: Vec3, target: Vec2, time: number): Vec3 {
  const t = Math.max(0.05, time);
  return {
    x: (target.x - from.x) / t,
    y: (target.y - from.y) / t,
    z: (BALL_RADIUS - from.z) / t + 0.5 * GRAVITY * t,
  };
}

/** Seconds until a ball launched with this vertical velocity reaches its apex. */
export const timeToApex = (verticalSpeed: number): number => Math.max(0, verticalSpeed / GRAVITY);

/**
 * Where the ball's current flight will next be at height `z` on the way down,
 * and how long that takes. Returns null if it never gets that low (it landed
 * first) or is already below. Used by the AI and by the jump assist to decide
 * where to stand.
 */
export function predictAtHeight(
  ball: Ball,
  z: number,
): { pos: Vec2; time: number } | null {
  const dz = ball.pos.z - z;
  const disc = ball.vel.z * ball.vel.z + 2 * GRAVITY * dz;
  if (disc < 0) return null;
  const t = (ball.vel.z + Math.sqrt(disc)) / GRAVITY;
  if (t < 0 || t > MAX_FLIGHT_TIME) return null;
  return {
    pos: { x: ball.pos.x + ball.vel.x * t, y: ball.pos.y + ball.vel.y * t },
    time: t,
  };
}
