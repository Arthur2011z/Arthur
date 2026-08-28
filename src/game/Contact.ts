import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { ActionType } from '../input/actions';
import { INPUT_BUFFER_MS } from './constants';
import { debugLog } from './Debug';

/**
 * Does the ball's hitbox overlap this athlete's right now?
 *
 * The athlete's shape comes from Athlete.hitbox - a vertical cylinder that a
 * blocker reshapes to reach across the net. The ball is a sphere. This is the
 * *only* definition of "the ball is touching this player" in the game: every
 * action, from a pass to a block to a serve, waits for exactly this to become
 * true, and nothing anywhere may act on the ball without it.
 */
export function ballTouches(ball: Ball, athlete: Athlete): boolean {
  const box = athlete.hitbox;
  const horizontal = Math.hypot(ball.pos.x - box.center.x, ball.pos.y - box.center.y);
  if (horizontal > box.radius + ball.radius) return false;
  return ball.pos.z <= box.ceiling + ball.radius && ball.pos.z >= box.floor - ball.radius;
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
export interface Clock {
  /** Wall-clock milliseconds (performance.now). What the log reports. */
  wallMs: number;
  /**
   * Milliseconds of *game* time, which runs slower during the aiming phase.
   *
   * The buffer ages on this rather than on wall time on purpose. The 180ms is
   * really a budget for how far the ball may travel before the input goes
   * stale, and during slow motion the ball travels four times slower. Ageing
   * on wall time would silently shrink the window to a quarter of itself at
   * exactly the moment the player is being invited to take their time and aim.
   */
  gameMs: number;
}

export class IntentBuffer {
  private action: ActionType | null = null;
  private pressedWallMs = 0;
  private pressedGameMs = 0;

  constructor(private readonly owner: Athlete) {}

  /** Records a press. A newer press replaces an older unredeemed one. */
  press(action: ActionType, pressedWallMs: number, clock: Clock): void {
    this.expireInto(clock);
    this.action = action;
    this.pressedWallMs = pressedWallMs;
    this.pressedGameMs = clock.gameMs;
  }

  /**
   * Ages the buffer. Must be called every frame: without it a press that the
   * ball never met would sit around unnoticed until the next contact instead
   * of expiring - and would never show up in the log as the discarded input
   * it is.
   */
  tick(clock: Clock): void {
    this.expireInto(clock);
  }

  /** The intent still valid now, or null. Drops (and logs) a stale one. */
  peek(clock: Clock): { action: ActionType; pressedAt: number } | null {
    this.expireInto(clock);
    if (this.action === null) return null;
    return { action: this.action, pressedAt: this.pressedWallMs };
  }

  /**
   * Redeems the pending intent because the hitboxes have actually met.
   * `touchedAt` is the wall-clock timestamp of that substep; the caller
   * applies the velocity change immediately, so `executedAt` equals it.
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

  private expireInto(clock: Clock): void {
    if (this.action === null) return;
    if (clock.gameMs - this.pressedGameMs <= INPUT_BUFFER_MS) return;
    debugLog.expired({
      athlete: this.owner.id,
      action: this.action,
      pressedAt: this.pressedWallMs,
      expiredAt: clock.wallMs,
    });
    this.action = null;
  }
}
