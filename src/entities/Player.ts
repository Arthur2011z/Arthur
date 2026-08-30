import { Vec2, Vec3, clamp, length, lerpVec2, normalize, sub } from '../utils/math';
import {
  BOOST_DURATION,
  BOOST_INTERCEPT_HEIGHT,
  BOOST_MULTIPLIER,
  HUMAN_HOMES,
  JUMP_ASSIST_RANGE,
  JUMP_COOLDOWN,
  JUMP_FALL_TIME,
  JUMP_HANG_TIME,
  JUMP_PEAK_HEIGHT,
  JUMP_RISE_TIME,
  PLAYER_SPEED,
  SERVE_LATERAL_SPEED,
  SLOWMO_TRIGGER_RANGE,
  SWING_POSE_DURATION,
} from '../game/constants';
import { Clock, IntentBuffer } from '../game/Contact';
import { debugLog } from '../game/Debug';
import { predictAtHeight } from '../game/Physics';
import { blockShot, emergencyShot, passShot, spikeShot } from '../game/Shots';
import { InputSnapshot, SwipeSample } from '../input/actions';
import { Athlete } from './Athlete';
import { Ball } from './Ball';

/** What a contact turned out to be. A block is judged differently by the rule
 * book: it costs no touch and releases the twice-in-a-row lock. */
export type ContactKind = 'play' | 'block' | null;

type JumpPhase = 'rising' | 'hanging' | 'falling';

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
  /** Direction currently held, for aiming a shot. */
  aim: Vec2 | null;
  clock: Clock;
}

/**
 * The human-controlled athlete.
 *
 * Pressing an action does not touch the ball. It records an intent, redeemed
 * only from playBall(), which the physics integrator calls in the exact
 * substep the hitboxes overlap. There is deliberately no other route from
 * input to the ball - the jump, the boost and the block all only change where
 * the player is and what shape they occupy.
 */
export class Player extends Athlete {
  readonly intents = new IntentBuffer(this);
  /** True while the speed boost is running - exposed for the HUD and tests. */
  boosting = false;
  /** True from take-off until the feet are back down. */
  jumping = false;
  jumpPhase: JumpPhase = 'rising';
  /**
   * Court-space direction the attack is aimed at, or null when the player has
   * not chosen one.
   *
   * Null genuinely means "no aim" rather than "aimed at the net": in
   * spikeTarget() a direction pointing at the net means "drop it short", so
   * defaulting to that would make every un-aimed attack from deep in the court
   * a guaranteed net fault.
   */
  aimDir: Vec2 | null = null;
  /** Swipe length held during the aiming phase, or null on keyboard. */
  swipeStrength: number | null = null;
  /** True once the attack has been triggered and the arm is coming through. */
  swinging = false;
  /**
   * True while this player is holding serve. Movement is then restricted to
   * the base line, and the first jump press tosses the ball rather than simply
   * leaving the ground.
   */
  serveMode = false;
  /** Set on the frame the serve toss should go up - read and cleared by
   * GameState, which owns the ball. */
  pendingToss = false;

  private boostTimer = 0;
  private swingTimer = 0;

  private swingPressedAt = 0;
  private jumpTimer = 0;
  private jumpCooldown = 0;
  private jumpFrom: Vec2 = { x: 0, y: 0 };
  private jumpTo: Vec2 = { x: 0, y: 0 };
  /** Distance to the net at take-off - the dominant term in spike power. */
  private takeoffNetDistance = 0;

  constructor() {
    super('player', 'human', HUMAN_HOMES[1]);
  }

  /** Puts the player on their base line, ball in hand, awaiting the serve. */
  beginServe(): void {
    this.resetForNewRally();
    this.serveMode = true;
    this.pendingToss = false;
    this.pos = this.clampToOwnHalf({ x: this.pos.x, y: this.baselineY });
    this.pose = 'serving';
  }

  /** Leaves serve preparation - the ball is on its way. */
  endServe(): void {
    this.serveMode = false;
    this.pendingToss = false;
  }

  /**
   * True while the player is hanging at the top of an attack jump with the
   * ball close enough to actually be hit. This is what puts the world into
   * slow motion - gated on the ball, so an idle hop never stutters the game.
   */
  wantsAimTime(ball: Ball): boolean {
    if (!this.jumping || this.jumpPhase !== 'hanging' || ball.state !== 'live') return false;
    const reach = predictAtHeight(ball, this.reachHeight);
    const spot = reach ? reach.pos : { x: ball.pos.x, y: ball.pos.y };
    return Math.hypot(spot.x - this.pos.x, spot.y - this.pos.y) <= SLOWMO_TRIGGER_RANGE;
  }

  update(dt: number, input: InputSnapshot, ctx: PlayerContext): void {
    this.handlePresses(input, ctx);
    this.intents.tick(ctx.clock);
    this.updateBlock(dt);
    this.updateJump(dt);
    this.updateAim(input);

    // While blocking or jumping the player is airborne and committed; while
    // boosting they run at the ball rather than wherever the stick points.
    // Otherwise the stick is the only thing that moves them, and releasing it
    // stops them dead.
    if (this.blocking || this.jumping) {
      /* committed to the jump */
    } else if (this.serveMode) {
      // Only sideways along the base line: no stepping into the court before
      // the ball has been struck.
      this.moveBy({ x: input.move.x, y: 0 }, SERVE_LATERAL_SPEED, dt);
      this.pos.y = this.baselineY;
    } else if (this.boosting) {
      this.updateBoost(dt, ctx);
    } else {
      this.moveBy(input.move, PLAYER_SPEED, dt);
    }

    this.updatePose(dt, input.move);
  }

  /**
   * Called from inside the physics substep in which this player's hitbox and
   * the ball's actually overlap. Returns what kind of contact happened, or
   * null if nobody had asked to play this ball - in which case it passes by
   * untouched.
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
        pressedAt: this.blockStartedAt,
        touchedAt: atMs,
        executedAt: atMs,
      });
      this.endBlock();
      return 'block';
    }

    // A swing already in progress meets whatever comes through, exactly like
    // a raised block: the arm is moving, and the ball either arrives inside
    // that motion or the swing misses.
    if (this.swinging && this.jumping) {
      ball.strike({ ...ball.pos }, this.buildSpike(ball), this.id);
      debugLog.contact({
        athlete: this.id,
        action: 'jump',
        pressedAt: this.swingPressedAt,
        touchedAt: atMs,
        executedAt: atMs,
      });
      this.swinging = false;
      this.swingTimer = SWING_POSE_DURATION;
      return 'play';
    }

    const intent = this.intents.peek(ctx.clock);
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

  /**
   * The flight the current aim would produce if contact happened right now.
   * The trajectory preview draws exactly this, and playBall() builds the real
   * shot the same way - so the glowing line is the shot, not a sketch of it.
   * Only the random scatter is left out, because that is not knowable ahead
   * of the swing.
   */
  previewSpike(ball: Ball): Vec3 {
    return spikeShot(this, ball, this.aimDir, this.takeoffNetDistance, this.swipeStrength, 0);
  }

  private buildSpike(ball: Ball): Vec3 {
    return spikeShot(this, ball, this.aimDir, this.takeoffNetDistance, this.swipeStrength);
  }

  /** Ends every committed action and drops any pending intent - used when the
   * rally moves on without this player. */
  standDown(): void {
    this.stopBoost();
    this.intents.clear();
    if (this.blocking) this.endBlock();
    if (this.jumping) this.endJump();
  }

  /**
   * Clears everything that belongs to the rally just finished, cooldowns
   * included.
   *
   * Cooldowns need clearing explicitly because the player is not updated at
   * all during the pause after a point - so a cooldown started just before
   * that point would still be counting down into the next rally, and swallow
   * the first jump or block of it.
   */
  resetForNewRally(): void {
    this.standDown();
    this.serveMode = false;
    this.pendingToss = false;
    this.jumpCooldown = 0;
    this.blockCooldown = 0;
    this.swingTimer = 0;
    this.jumpHeight = 0;
    this.pose = 'idle';
  }

  // -------------------------------------------------------------------------
  // Input
  // -------------------------------------------------------------------------

  private handlePresses(input: InputSnapshot, ctx: PlayerContext): void {
    for (const press of input.pressed) {
      if (press.action === 'block') {
        if (!this.jumping) this.startBlock(press.at);
        continue; // a block is a state, not a buffered contact
      }
      if (press.action === 'jump') {
        // First press leaves the ground; a second one while airborne swings.
        // Neither touches the ball here - the toss is handed to GameState,
        // which owns the ball, and the swing waits for a real overlap.
        if (this.jumping) {
          this.startSwing(press.at);
        } else {
          if (this.serveMode) this.pendingToss = true;
          this.startJump(ctx.ball);
        }
        continue;
      }

      // Nothing but the serve exists while holding serve; the other actions
      // are hidden from the UI anyway, but a stray key must not slip through.
      if (this.serveMode) continue;
      this.intents.press(press.action, press.at, ctx.clock);
      if (press.action === 'pass' || press.action === 'emergency') this.startBoost(ctx);
    }

    // On touch, letting go of the aiming swipe is the swing - the equivalent
    // of the second Q press.
    if (input.swipeReleased) {
      if (this.jumping) {
        this.startSwing(ctx.clock.wallMs);
        debugLog.aim({ stage: 'swing_started', note: 'released aiming swipe' });
      } else {
        debugLog.aim({ stage: 'swing_started', note: 'discarded: player is not airborne' });
      }
    }
  }

  /** While airborne the direction input aims the attack instead of steering
   * the player. A live swipe wins over the stick; with neither, the last
   * chosen direction is kept rather than snapping back. */
  private updateAim(input: InputSnapshot): void {
    if (!this.jumping) {
      this.swipeStrength = null;
      return;
    }
    const swipe: SwipeSample | null = input.swipe;
    if (swipe && length(swipe.dir) > 0) {
      this.aimDir = normalize(swipe.dir);
      this.swipeStrength = swipe.strength;
      debugLog.aim({
        stage: 'aim_applied',
        dirX: this.aimDir.x,
        dirY: this.aimDir.y,
        strength: swipe.strength,
      });
    } else if (input.aim) {
      this.aimDir = normalize(input.aim);
      debugLog.aim({ stage: 'aim_applied', dirX: this.aimDir.x, dirY: this.aimDir.y, note: 'from stick/keys' });
    }
  }

  // -------------------------------------------------------------------------
  // Jump
  // -------------------------------------------------------------------------

  /**
   * Leaves the ground toward the ball. The take-off may pull the player up to
   * JUMP_ASSIST_RANGE toward where the ball will actually be - position help
   * only. *When* to jump stays entirely the player's problem, which is what
   * keeps the spike a skill rather than a button.
   */
  private startJump(ball: Ball): void {
    if (this.jumping || this.blocking || this.jumpCooldown > 0) return;

    this.jumping = true;
    this.jumpPhase = 'rising';
    this.jumpTimer = 0;
    this.jumpFrom = { ...this.pos };
    this.jumpTo = this.assistedLanding(ball);
    this.takeoffNetDistance = this.distanceToNet;
    this.aimDir = null;
    this.swipeStrength = null;
  }

  /**
   * Triggers the attack. Like the block, this is a committed motion rather
   * than an instant: it stays live until the feet are back on the sand, so
   * the ball has the whole descent to arrive rather than one narrow buffer
   * window. And like the block, it never touches the ball itself - the swing
   * only connects from playBall(), on real hitbox overlap.
   */
  private startSwing(pressedAt: number): void {
    if (!this.jumping || this.swinging) return;
    this.swinging = true;
    this.swingPressedAt = pressedAt;
  }

  private assistedLanding(ball: Ball): Vec2 {
    if (ball.state !== 'live') return { ...this.pos };
    const reach = predictAtHeight(ball, this.reachHeight + JUMP_PEAK_HEIGHT);
    if (!reach) return { ...this.pos };

    const offset = sub(reach.pos, this.pos);
    const distance = length(offset);
    if (distance < 1e-3) return { ...this.pos };

    const step = Math.min(distance, JUMP_ASSIST_RANGE);
    const dir = normalize(offset);
    return this.clampToOwnHalf({
      x: this.pos.x + dir.x * step,
      y: this.pos.y + dir.y * step,
    });
  }

  private updateJump(dt: number): void {
    this.jumpCooldown = Math.max(0, this.jumpCooldown - dt);
    if (!this.jumping) return;

    this.jumpTimer += dt;
    if (this.jumpPhase === 'rising') {
      const t = clamp(this.jumpTimer / JUMP_RISE_TIME, 0, 1);
      this.jumpHeight = JUMP_PEAK_HEIGHT * t;
      this.pos = this.clampToOwnHalf(lerpVec2(this.jumpFrom, this.jumpTo, t));
      if (t >= 1) {
        this.jumpPhase = 'hanging';
        this.jumpTimer = 0;
      }
      return;
    }

    if (this.jumpPhase === 'hanging') {
      this.jumpHeight = JUMP_PEAK_HEIGHT;
      if (this.jumpTimer >= JUMP_HANG_TIME) {
        this.jumpPhase = 'falling';
        this.jumpTimer = 0;
      }
      return;
    }

    const t = clamp(this.jumpTimer / JUMP_FALL_TIME, 0, 1);
    this.jumpHeight = JUMP_PEAK_HEIGHT * (1 - t);
    if (t >= 1) this.endJump();
  }

  private endJump(): void {
    this.jumping = false;
    this.swinging = false;
    this.jumpPhase = 'rising';
    this.jumpTimer = 0;
    this.jumpHeight = 0;
    this.jumpCooldown = JUMP_COOLDOWN;
    this.swipeStrength = null;
  }

  // -------------------------------------------------------------------------
  // Block
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Speed boost
  // -------------------------------------------------------------------------

  private startBoost(ctx: PlayerContext): void {
    if (!ctx.mayTouch || ctx.ball.state !== 'live' || this.jumping || this.blocking) return;
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
    if (this.serveMode && !this.jumping) {
      this.pose = 'serving';
      return;
    }
    if (this.blocking) {
      this.pose = 'blocking';
      return;
    }
    if (this.jumping) {
      this.pose = 'jumping';
      return;
    }
    this.pose = this.boosting || length(move) > 1e-4 ? 'running' : 'idle';
  }
}
