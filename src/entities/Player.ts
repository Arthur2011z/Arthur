import {
  Vec2,
  clamp,
  closestPointOnSegment,
  distance,
  dot,
  length,
  lerpVec2,
  normalize,
  sub,
} from '../utils/math';
import {
  AIM_DEADZONE,
  COURT_LENGTH,
  COURT_WIDTH,
  DIVE_DASH_DURATION,
  DIVE_RECOVERY_DURATION,
  HIT_RANGE,
  INPUT_BUFFER_WINDOW,
  JUMP_FALL_DURATION,
  JUMP_PEAK_HEIGHT,
  JUMP_RISE_DURATION,
  JUMP_SCHLAG_GRACE_DURATION,
  NET_PROXIMITY_RANGE,
  NET_Y,
  PASS_DURATION,
  PASS_PEAK_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  REACH_AIMLESS_RANGE,
  REACH_AIM_TOLERANCE_COS,
  REACH_RANGE,
  SPIKE_DURATION,
  SPIKE_PEAK_HEIGHT,
  SPIKE_RANGE,
  SPIKE_TARGET_MARGIN,
} from '../game/constants';
import { Ball } from './Ball';
import { InputSnapshot } from '../input/InputManager';

type PlayerState = 'active' | 'diving' | 'recovering' | 'jumping_up' | 'jumping_down';

/** Default spike direction (straight toward the net), used while the joystick
 * is left centered during the whole jump. */
const DEFAULT_AIM_DIR: Vec2 = { x: 0, y: -1 };

/**
 * The human-controlled player. Only four inputs exist, no gestures:
 *
 * - the joystick: free movement within the player's own half.
 * - Sprung/Hecht ("reach"): while the joystick points roughly toward the
 *   ball's remaining flight path, sends the player into a brief automatic
 *   approach toward the nearest point of that path - a vertical hop (with
 *   hang time, locking lateral movement) if already near the net, a flat
 *   dash otherwise. The precise positioning is the game's job, not the
 *   player's - the joystick only has to point roughly the right way.
 * - Schlag ("attack"): fires a hard, aimed spike, but only while airborne
 *   near the net. May be pressed early (buffered) and still resolves the
 *   instant the ball comes within range, plus a short grace period past the
 *   jump's peak - so timing is never split-second. Aim direction is whatever
 *   the joystick is held toward during the jump.
 * - Pass: a controlled, medium touch straight to the AI teammate. Works from
 *   any state the instant the ball is within HIT_RANGE - the deliberate
 *   "safe" alternative to attacking.
 */
export class Player {
  pos: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y + COURT_LENGTH / 4 };
  radius = PLAYER_RADIUS;
  state: PlayerState = 'active';
  /** Visual-only vertical lift while jumping (mirrors Ball.height). */
  height = 0;
  /** Current spike aim direction while jumping (driven by the joystick each
   * frame, exposed for the renderer's aim indicator). */
  aimDir: Vec2 = { ...DEFAULT_AIM_DIR };

  private stateTimer = 0;
  private approachStart: Vec2 = { ...this.pos };
  private approachTarget: Vec2 = { ...this.pos };
  private fallStartHeight = 0;

  private attackBuffered = false;
  private attackBufferAge = 0;
  private passBuffered = false;
  private passBufferAge = 0;

  update(dt: number, input: InputSnapshot, ball: Ball, teammatePos: Vec2): void {
    this.updateInputBuffers(dt, input);

    switch (this.state) {
      case 'active':
        this.applyMovement(dt, input.move);
        if (input.reach) this.tryReach(input.move, ball);
        this.tryResolvePending(ball, teammatePos, false);
        break;
      case 'diving':
        this.updateDiving(dt, ball, teammatePos);
        break;
      case 'recovering':
        this.stateTimer += dt;
        if (this.stateTimer >= DIVE_RECOVERY_DURATION) {
          this.state = 'active';
          this.stateTimer = 0;
        }
        break;
      case 'jumping_up':
        this.updateJumpingUp(dt, input, ball, teammatePos);
        break;
      case 'jumping_down':
        this.updateJumpingDown(dt, ball, teammatePos);
        break;
    }
  }

  /** Whether the player is currently close enough to the net for Sprung/Hecht
   * to produce a jump (rather than a grounded dive). */
  canJump(): boolean {
    return this.pos.y <= NET_Y + NET_PROXIMITY_RANGE;
  }

  private applyMovement(dt: number, moveVector: Vec2): void {
    const dir = normalize(moveVector);
    const magnitude = Math.min(1, length(moveVector));
    this.pos.x += dir.x * PLAYER_SPEED * magnitude * dt;
    this.pos.y += dir.y * PLAYER_SPEED * magnitude * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Remembers a fresh Schlag/Pass press for INPUT_BUFFER_WINDOW seconds, so
   * either can be pressed before the ball is actually in reach. */
  private updateInputBuffers(dt: number, input: InputSnapshot): void {
    if (input.attack) {
      this.attackBuffered = true;
      this.attackBufferAge = 0;
    } else if (this.attackBuffered) {
      this.attackBufferAge += dt;
      if (this.attackBufferAge > INPUT_BUFFER_WINDOW) this.attackBuffered = false;
    }

    if (input.pass) {
      this.passBuffered = true;
      this.passBufferAge = 0;
    } else if (this.passBuffered) {
      this.passBufferAge += dt;
      if (this.passBufferAge > INPUT_BUFFER_WINDOW) this.passBuffered = false;
    }
  }

  /** Sprung/Hecht: while the ball is flying and the joystick points roughly
   * toward the nearest point of its remaining path, auto-approaches it - a
   * jump near the net, a flat dive dash otherwise. Silently does nothing if
   * unaimed or the ball is out of reach entirely. */
  private tryReach(moveVector: Vec2, ball: Ball): void {
    if (ball.state !== 'flying') return;

    const intercept = closestPointOnSegment(this.pos, ball.pos, ball.target);
    const toIntercept = sub(intercept, this.pos);
    const dist = length(toIntercept);
    if (dist > REACH_RANGE) return;

    if (dist > REACH_AIMLESS_RANGE) {
      const aimed = dot(normalize(moveVector), normalize(toIntercept)) >= REACH_AIM_TOLERANCE_COS;
      if (!aimed) return;
    }

    this.approachStart = { ...this.pos };
    this.approachTarget = intercept;
    this.stateTimer = 0;

    if (this.canJump()) {
      this.state = 'jumping_up';
      this.height = 0;
      this.aimDir = { ...DEFAULT_AIM_DIR };
    } else {
      this.state = 'diving';
    }
  }

  private updateDiving(dt: number, ball: Ball, teammatePos: Vec2): void {
    if (this.tryResolvePending(ball, teammatePos, false)) {
      this.state = 'recovering';
      this.stateTimer = 0;
      return;
    }

    this.stateTimer += dt;
    const u = clamp(this.stateTimer / DIVE_DASH_DURATION, 0, 1);
    this.pos = lerpVec2(this.approachStart, this.approachTarget, u);

    if (u >= 1) {
      this.state = 'recovering';
      this.stateTimer = 0;
    }
  }

  private updateJumpingUp(dt: number, input: InputSnapshot, ball: Ball, teammatePos: Vec2): void {
    if (this.tryResolvePending(ball, teammatePos, true)) {
      this.enterFalling();
      return;
    }

    // No lateral joystick movement while jumping - it steers the spike's aim
    // instead (see aimDir below).
    this.stateTimer += dt;
    const u = clamp(this.stateTimer / JUMP_RISE_DURATION, 0, 1);
    this.height = JUMP_PEAK_HEIGHT * u;
    this.pos = lerpVec2(this.approachStart, this.approachTarget, u);

    if (length(input.move) > AIM_DEADZONE) {
      this.aimDir = normalize(input.move);
    }

    if (this.stateTimer >= JUMP_RISE_DURATION) {
      this.enterFalling();
    }
  }

  private enterFalling(): void {
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  private updateJumpingDown(dt: number, ball: Ball, teammatePos: Vec2): void {
    // Grace period: a Schlag/Pass arriving just past the peak still resolves,
    // so the jump's timing never feels like a single-frame deadline.
    if (this.stateTimer <= JUMP_SCHLAG_GRACE_DURATION) {
      this.tryResolvePending(ball, teammatePos, true);
    }

    this.stateTimer += dt;
    const u = clamp(this.stateTimer / JUMP_FALL_DURATION, 0, 1);
    this.height = this.fallStartHeight * (1 - u);
    if (u >= 1) {
      this.height = 0;
      this.state = 'active';
      this.stateTimer = 0;
    }
  }

  /** Resolves a buffered Schlag (only if `allowAttack`) or Pass the instant
   * the ball is actually within HIT_RANGE. Returns whether something fired. */
  private tryResolvePending(ball: Ball, teammatePos: Vec2, allowAttack: boolean): boolean {
    if (ball.state !== 'flying') return false;
    if (distance(this.pos, ball.pos) > HIT_RANGE) return false;

    if (allowAttack && this.attackBuffered) {
      this.fireSpike(ball);
      this.clearPendingInputs();
      return true;
    }
    if (this.passBuffered) {
      this.firePass(ball, teammatePos);
      this.clearPendingInputs();
      return true;
    }
    return false;
  }

  private clearPendingInputs(): void {
    this.attackBuffered = false;
    this.passBuffered = false;
  }

  private fireSpike(ball: Ball): void {
    const target = this.computeSpikeTarget(this.aimDir);
    // Launch from the ball's own live position, not this.pos: contact is
    // allowed within HIT_RANGE (not exact overlap), so using the player's
    // position here would snap the ball at the moment of contact instead of
    // continuing smoothly from where it actually is.
    ball.launch({ ...ball.pos }, target, {
      duration: SPIKE_DURATION,
      peakHeight: SPIKE_PEAK_HEIGHT,
      toucher: 'player',
    });
  }

  private firePass(ball: Ball, teammatePos: Vec2): void {
    ball.launch({ ...ball.pos }, { ...teammatePos }, {
      duration: PASS_DURATION,
      peakHeight: PASS_PEAK_HEIGHT,
      toucher: 'player',
    });
  }

  private computeSpikeTarget(aimDir: Vec2): Vec2 {
    const dir = normalize(aimDir);
    const raw = {
      x: this.pos.x + dir.x * SPIKE_RANGE,
      y: this.pos.y + dir.y * SPIKE_RANGE,
    };
    return {
      x: clamp(raw.x, SPIKE_TARGET_MARGIN, COURT_WIDTH - SPIKE_TARGET_MARGIN),
      y: clamp(raw.y, SPIKE_TARGET_MARGIN, NET_Y - SPIKE_TARGET_MARGIN),
    };
  }

  private clampToOwnHalf(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.radius, COURT_WIDTH - this.radius),
      y: clamp(p.y, NET_Y + this.radius, COURT_LENGTH - this.radius),
    };
  }
}
