import { Vec2, length, sub } from '../utils/math';
import {
  BOOST_DURATION,
  BOOST_INTERCEPT_HEIGHT,
  BOOST_MULTIPLIER,
  HUMAN_HOMES,
  PLAYER_SPEED,
  SWING_POSE_DURATION,
} from '../game/constants';
import { IntentBuffer } from '../game/Contact';
import { predictAtHeight } from '../game/Physics';
import { emergencyShot, passShot } from '../game/Shots';
import { InputSnapshot } from '../input/actions';
import { Athlete } from './Athlete';
import { Ball } from './Ball';

export interface PlayerContext {
  ball: Ball;
  /** The partner, for aiming a pass. */
  partner: Athlete;
  /**
   * False once this player is no longer allowed to touch the ball - because
   * they took the last contact, or the rally is not running.
   *
   * The speed boost checks this every frame. A boost that kept dragging a
   * player toward a ball they may not touch would walk them straight into a
   * double contact they never asked for.
   */
  mayTouch: boolean;
  /** Direction currently held, for aiming the Notfall shot. */
  aim: Vec2 | null;
}

/**
 * The human-controlled athlete.
 *
 * Pressing an action does not touch the ball. It records an intent, redeemed
 * only from playBall(), which the physics integrator calls in the exact
 * substep the hitboxes overlap. There is deliberately no other route from
 * input to the ball.
 *
 * Pass and Notfall additionally start a short speed boost that runs the player
 * at the ball, so one that was just out of reach becomes playable. The boost
 * never guarantees a contact - it only shortens the distance, and the timing
 * rule above still has the final say.
 */
export class Player extends Athlete {
  readonly intents = new IntentBuffer(this);
  /** True while the speed boost is running - exposed for the HUD and tests. */
  boosting = false;

  private boostTimer = 0;
  private swingTimer = 0;

  constructor() {
    super('player', 'human', HUMAN_HOMES[1]);
  }

  update(dt: number, input: InputSnapshot, nowMs: number, ctx: PlayerContext): void {
    for (const press of input.pressed) {
      this.intents.press(press.action, press.at);
      if (press.action === 'pass' || press.action === 'emergency') this.startBoost(ctx);
    }
    this.intents.tick(nowMs);

    // While boosting, the player runs at the ball rather than wherever the
    // stick points - that is the whole purpose of the burst. Otherwise the
    // stick is the only thing that moves them, and releasing it stops them
    // dead.
    if (this.boosting) this.updateBoost(dt, ctx);
    else this.moveBy(input.move, PLAYER_SPEED, dt);

    this.updatePose(dt, input.move);
  }

  /**
   * Called from inside the physics substep in which this player's hitbox and
   * the ball's actually overlap. Returns true if a buffered action was waiting
   * and the ball was therefore played; false means the ball passes by
   * untouched, which is what happens whenever nobody asked to play it.
   */
  playBall(ball: Ball, atMs: number, ctx: PlayerContext): boolean {
    const intent = this.intents.peek(atMs);
    if (!intent) return false;

    const velocity =
      intent.action === 'pass'
        ? passShot(this, ball, ctx.partner)
        : emergencyShot(this, ball, ctx.aim);
    ball.strike({ ...ball.pos }, velocity, this.id);

    this.intents.redeem(intent.action, intent.pressedAt, atMs);
    this.stopBoost();
    this.swingTimer = SWING_POSE_DURATION;
    return true;
  }

  /** Ends the boost and drops any pending intent - used when the rally moves
   * on without this player. */
  standDown(): void {
    this.stopBoost();
    this.intents.clear();
  }

  private startBoost(ctx: PlayerContext): void {
    if (!ctx.mayTouch || ctx.ball.state !== 'live') return;
    this.boosting = true;
    this.boostTimer = BOOST_DURATION;
  }

  private stopBoost(): void {
    this.boosting = false;
    this.boostTimer = 0;
  }

  private updateBoost(dt: number, ctx: PlayerContext): void {
    this.boostTimer -= dt;
    if (this.boostTimer <= 0 || !ctx.mayTouch || ctx.ball.state !== 'live') {
      this.stopBoost();
      return;
    }

    const toBall = sub(this.interceptPoint(ctx.ball), this.pos);
    if (length(toBall) < 1e-3) return;
    this.moveBy(toBall, PLAYER_SPEED * BOOST_MULTIPLIER, dt);
  }

  /** Where on the ground the ball will next be playable from - the point at
   * which it drops to a comfortable contact height. Falls back to the ball's
   * current position for a ball that is already low. */
  private interceptPoint(ball: Ball): Vec2 {
    const predicted = predictAtHeight(ball, BOOST_INTERCEPT_HEIGHT);
    const target = predicted ? predicted.pos : { x: ball.pos.x, y: ball.pos.y };
    return this.clampToOwnHalf(target);
  }

  private updatePose(dt: number, move: Vec2): void {
    if (this.swingTimer > 0) {
      this.swingTimer -= dt;
      this.pose = 'swinging';
      return;
    }
    this.pose = this.boosting || length(move) > 1e-4 ? 'running' : 'idle';
  }
}
