import { Vec2, length, sub } from '../utils/math';
import {
  BLOCK_COOLDOWN,
  BLOCK_FLOOR,
  BLOCK_JUMP_HEIGHT,
  BLOCK_NET_RANGE,
  BLOCK_OVERREACH,
  BLOCK_RISE,
  BLOCK_FALL,
  BLOCK_WIDTH_BONUS,
  BLOCK_WINDOW,
  BOOST_DURATION,
  BOOST_INTERCEPT_HEIGHT,
  BOOST_MULTIPLIER,
  HUMAN_HOMES,
  PLAYER_SPEED,
  SWING_POSE_DURATION,
} from '../game/constants';
import { IntentBuffer } from '../game/Contact';
import { debugLog } from '../game/Debug';
import { predictAtHeight } from '../game/Physics';
import { blockShot, emergencyShot, passShot, towardNet } from '../game/Shots';
import { InputSnapshot } from '../input/actions';
import { Athlete, Hitbox } from './Athlete';
import { Ball } from './Ball';

/** What a contact turned out to be. A block is judged differently by the rule
 * book: it costs no touch and releases the twice-in-a-row lock. */
export type ContactKind = 'play' | 'block' | null;

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
  /** True while the arms are up at the net. */
  blocking = false;

  private boostTimer = 0;
  private swingTimer = 0;
  private blockTimer = 0;
  private blockCooldown = 0;
  private blockPressedAt = 0;

  constructor() {
    super('player', 'human', HUMAN_HOMES[1]);
  }

  /**
   * While blocking, the hitbox is a different shape: it starts at the tape and
   * reaches across the net, because a block is played over the net rather than
   * on the blocker's own side. Anywhere else in the game this is the ordinary
   * cylinder from Athlete.
   */
  override get hitbox(): Hitbox {
    if (!this.blocking) return super.hitbox;
    const forward = towardNet(this);
    return {
      center: {
        x: this.pos.x + forward.x * BLOCK_OVERREACH,
        y: this.pos.y + forward.y * BLOCK_OVERREACH,
      },
      radius: this.radius + BLOCK_WIDTH_BONUS,
      floor: BLOCK_FLOOR,
      ceiling: this.reachHeight,
    };
  }

  /** Whether a block would engage from where the player is standing. */
  canBlock(): boolean {
    return this.blockCooldown <= 0 && !this.blocking && this.distanceToNet <= BLOCK_NET_RANGE;
  }

  update(dt: number, input: InputSnapshot, nowMs: number, ctx: PlayerContext): void {
    for (const press of input.pressed) {
      if (press.action === 'block') {
        this.startBlock(press.at);
        continue; // a block is a state, not a buffered contact
      }
      this.intents.press(press.action, press.at);
      if (press.action === 'pass' || press.action === 'emergency') this.startBoost(ctx);
    }
    this.intents.tick(nowMs);
    this.updateBlock(dt);

    // While blocking the player is in the air and committed; while boosting
    // they run at the ball rather than wherever the stick points. Otherwise
    // the stick is the only thing that moves them, and releasing it stops them
    // dead.
    if (this.blocking) {
      /* committed to the jump */
    } else if (this.boosting) {
      this.updateBoost(dt, ctx);
    } else {
      this.moveBy(input.move, PLAYER_SPEED, dt);
    }

    this.updatePose(dt, input.move);
  }

  /**
   * Called from inside the physics substep in which this player's hitbox and
   * the ball's actually overlap. Returns true if a buffered action was waiting
   * and the ball was therefore played; false means the ball passes by
   * untouched, which is what happens whenever nobody asked to play it.
   */
  playBall(ball: Ball, atMs: number, ctx: PlayerContext): ContactKind {
    // A raised block rejects whatever comes through the zone; it needs no
    // buffered press, because the press already happened when the arms went
    // up. The effect on the ball still only lands here, on real overlap.
    if (this.blocking) {
      ball.strike({ ...ball.pos }, blockShot(this, ball), this.id);
      debugLog.contact({
        athlete: this.id,
        action: 'block',
        pressedAt: this.blockPressedAt,
        touchedAt: atMs,
        executedAt: atMs,
      });
      this.endBlock();
      return 'block';
    }

    const intent = this.intents.peek(atMs);
    if (!intent) return null;

    const velocity =
      intent.action === 'pass'
        ? passShot(this, ball, ctx.partner)
        : emergencyShot(this, ball, ctx.aim);
    ball.strike({ ...ball.pos }, velocity, this.id);

    this.intents.redeem(intent.action, intent.pressedAt, atMs);
    this.stopBoost();
    this.swingTimer = SWING_POSE_DURATION;
    return 'play';
  }

  /** Raises the arms, if the player is close enough to the net and not still
   * recovering from the last attempt. A press from too far away simply does
   * nothing - there is no block from midcourt. */
  private startBlock(pressedAt: number): void {
    if (!this.canBlock()) return;
    this.blocking = true;
    this.blockTimer = 0;
    this.blockPressedAt = pressedAt;
  }

  private updateBlock(dt: number): void {
    this.blockCooldown = Math.max(0, this.blockCooldown - dt);
    if (!this.blocking) return;

    this.blockTimer += dt;
    if (this.blockTimer >= BLOCK_WINDOW) {
      this.endBlock();
      return;
    }

    // Up fast, hold, back down - so the zone is actually open for most of the
    // window rather than only at one instant.
    const remaining = BLOCK_WINDOW - this.blockTimer;
    const rise = Math.min(1, this.blockTimer / BLOCK_RISE);
    const fall = Math.min(1, remaining / BLOCK_FALL);
    this.jumpHeight = BLOCK_JUMP_HEIGHT * Math.min(rise, fall);
  }

  private endBlock(): void {
    this.blocking = false;
    this.blockTimer = 0;
    this.jumpHeight = 0;
    this.blockCooldown = BLOCK_COOLDOWN;
  }

  /** Ends the boost and drops any pending intent - used when the rally moves
   * on without this player. */
  standDown(): void {
    this.stopBoost();
    this.intents.clear();
    if (this.blocking) this.endBlock();
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
    if (this.blocking) {
      this.pose = 'blocking';
      return;
    }
    this.pose = this.boosting || length(move) > 1e-4 ? 'running' : 'idle';
  }
}
