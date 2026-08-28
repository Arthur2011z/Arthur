import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { ActionType } from '../input/actions';
import { INPUT_BUFFER_MS } from './constants';
import { debugLog } from './Debug';

/**
 * Does the ball's hitbox overlap this athlete's right now?
 *
 * The athlete is a vertical capsule: a circle of `radius` on the ground,
 * reaching from their feet up to `reachHeight` (which grows with a jump). The
 * ball is a sphere. This is the *only* definition of "the ball is touching
 * this player" in the game - every action, from a pass to a block to a serve,
 * waits for exactly this to become true.
 */
export function ballTouches(ball: Ball, athlete: Athlete): boolean {
  const horizontal = Math.hypot(ball.pos.x - athlete.pos.x, ball.pos.y - athlete.pos.y);
  if (horizontal > athlete.radius + ball.radius) return false;

  const ceiling = athlete.reachHeight + ball.radius;
  // A player in the air cannot play a ball that is below their own feet.
  const floor = Math.max(0, athlete.jumpHeight - ball.radius);
  return ball.pos.z <= ceiling && ball.pos.z >= floor;
}

/**
 * A single remembered button press, waiting for the ball to arrive.
 *
 * Pressing an action never touches the ball. It only records an intent, which
 * is redeemed later - in the exact physics substep the hitboxes meet - or
 * expires unused after INPUT_BUFFER_MS. That indirection is the whole point:
 * there is no code path from "button pressed" to "ball moves" that does not go
 * through a real, physical overlap.
 */
export class IntentBuffer {
  private action: ActionType | null = null;
  private pressedAt = 0;

  constructor(private readonly owner: Athlete) {}

  /** Records a press. A newer press replaces an older unredeemed one. */
  press(action: ActionType, nowMs: number): void {
    this.expireInto(nowMs);
    this.action = action;
    this.pressedAt = nowMs;
  }

  /**
   * Ages the buffer. Must be called every frame: without it a press that the
   * ball never met would sit around unnoticed until the next contact instead
   * of expiring - and would never show up in the log as the discarded input
   * it is.
   */
  tick(nowMs: number): void {
    this.expireInto(nowMs);
  }

  /** The intent still valid at `nowMs`, or null. Drops (and logs) a stale one. */
  peek(nowMs: number): { action: ActionType; pressedAt: number } | null {
    this.expireInto(nowMs);
    if (this.action === null) return null;
    return { action: this.action, pressedAt: this.pressedAt };
  }

  /**
   * Redeems the pending intent because the hitboxes have actually met.
   * `touchedAt` is the timestamp of that substep; the caller applies the
   * velocity change immediately, so `executedAt` equals it.
   */
  redeem(action: ActionType, pressedAt: number, touchedAt: number): void {
    this.action = null;
    debugLog.contact({
      athlete: this.owner.id,
      action,
      pressedAt,
      touchedAt,
      executedAt: touchedAt,
    });
  }

  /** Throws away any pending intent without firing it - used when the player
   * is no longer allowed to play this ball at all. */
  clear(): void {
    this.action = null;
  }

  get pending(): boolean {
    return this.action !== null;
  }

  private expireInto(nowMs: number): void {
    if (this.action === null) return;
    if (nowMs - this.pressedAt <= INPUT_BUFFER_MS) return;
    debugLog.expired({
      athlete: this.owner.id,
      action: this.action,
      pressedAt: this.pressedAt,
      expiredAt: nowMs,
    });
    this.action = null;
  }
}
