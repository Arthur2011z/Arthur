import { Vec2, clamp, distance, dot, length, lerpVec2, normalize, sub } from '../utils/math';
import {
  COURT_LENGTH,
  COURT_WIDTH,
  DIVE_AIM_TOLERANCE_COS,
  DIVE_DASH_DURATION,
  DIVE_PASS_DURATION,
  DIVE_PASS_PEAK_HEIGHT,
  DIVE_RANGE,
  DIVE_RECOVERY_DURATION,
  DIVE_WHIFF_DISTANCE,
  HIT_RANGE,
  JUMP_FALL_DURATION,
  JUMP_PEAK_HEIGHT,
  JUMP_RISE_DURATION,
  NET_PROXIMITY_RANGE,
  NET_Y,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  SPIKE_DURATION,
  SPIKE_PEAK_HEIGHT,
  SPIKE_RANGE,
  SPIKE_TARGET_MARGIN,
  WEAK_SHOT_DURATION,
  WEAK_SHOT_MARGIN,
  WEAK_SHOT_PEAK_HEIGHT,
} from '../game/constants';
import { Ball } from './Ball';
import { InputSnapshot } from '../input/InputManager';

type PlayerState = 'active' | 'diving' | 'recovering' | 'jumping_up' | 'jumping_down';

/** Default spike direction (straight toward the net) used when the jump's
 * peak is reached with no swipe yet. */
const DEFAULT_AIM_DIR: Vec2 = { x: 0, y: -1 };

/**
 * The human-controlled player. Free movement while 'active'; a swipe attempts a
 * dive ('diving', a short dash) which either connects with the ball (auto-passed
 * to the teammate) or whiffs, either way followed by a brief 'recovering' pause;
 * the Hit button, in range of the ball, sends a weak shot over the net.
 *
 * Near the net, Jump instead sends the player into a brief hop: 'jumping_up'
 * locks lateral movement and accepts a swipe to fire a hard, precisely-aimed
 * spike in the swiped direction (or, failing that, automatically at the peak in
 * a default direction, so a jump never wastes itself with no outcome); then
 * 'jumping_down' plays out the landing before control returns to 'active'.
 */
export class Player {
  pos: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y + COURT_LENGTH / 4 };
  radius = PLAYER_RADIUS;
  state: PlayerState = 'active';
  /** Visual-only vertical lift while jumping (mirrors Ball.height). */
  height = 0;

  private stateTimer = 0;
  private diveStart: Vec2 = { ...this.pos };
  private diveTarget: Vec2 = { ...this.pos };
  private diveConnected = false;
  private fallStartHeight = 0;

  update(dt: number, input: InputSnapshot, ball: Ball, teammatePos: Vec2): void {
    switch (this.state) {
      case 'active':
        this.applyMovement(dt, input.move);
        if (input.jump && this.canJump()) this.startJump();
        else if (input.swipe) this.startDive(input.swipe, ball);
        else if (input.hit) this.tryHit(ball);
        break;
      case 'diving':
        this.updateDive(dt, ball, teammatePos);
        break;
      case 'recovering':
        this.stateTimer += dt;
        if (this.stateTimer >= DIVE_RECOVERY_DURATION) {
          this.state = 'active';
          this.stateTimer = 0;
        }
        break;
      case 'jumping_up':
        this.updateJumpUp(dt, input, ball);
        break;
      case 'jumping_down':
        this.updateJumpDown(dt);
        break;
    }
  }

  /** Whether the player is currently close enough to the net to use Jump. */
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

  private startDive(swipeDir: Vec2, ball: Ball): void {
    const toBall = sub(ball.pos, this.pos);
    const dist = length(toBall);
    const connects =
      ball.state === 'flying' &&
      dist <= DIVE_RANGE &&
      dot(normalize(swipeDir), normalize(toBall)) >= DIVE_AIM_TOLERANCE_COS;

    this.diveStart = { ...this.pos };
    this.diveConnected = connects;
    if (connects) {
      // Freeze the ball where it was caught so the short dash below visibly
      // lands on it, instead of it continuing to fly past the catch point.
      // 'held', not 'idle': a real landing is what scoring reacts to.
      ball.state = 'held';
      this.diveTarget = { ...ball.pos };
    } else {
      const whiff = {
        x: this.pos.x + swipeDir.x * DIVE_WHIFF_DISTANCE,
        y: this.pos.y + swipeDir.y * DIVE_WHIFF_DISTANCE,
      };
      this.diveTarget = this.clampToOwnHalf(whiff);
    }

    this.state = 'diving';
    this.stateTimer = 0;
  }

  private updateDive(dt: number, ball: Ball, teammatePos: Vec2): void {
    this.stateTimer += dt;
    const u = clamp(this.stateTimer / DIVE_DASH_DURATION, 0, 1);
    this.pos = lerpVec2(this.diveStart, this.diveTarget, u);

    if (u >= 1) {
      if (this.diveConnected) {
        ball.launch(this.pos, teammatePos, {
          duration: DIVE_PASS_DURATION,
          peakHeight: DIVE_PASS_PEAK_HEIGHT,
          toucher: 'player',
        });
      }
      this.state = 'recovering';
      this.stateTimer = 0;
    }
  }

  /** Hit button, no jump: a weak shot in a semi-random direction over the net.
   * Only a proximity gate — no height/timing requirement. */
  private tryHit(ball: Ball): void {
    if (distance(this.pos, ball.pos) > HIT_RANGE) return;

    const target: Vec2 = {
      x: WEAK_SHOT_MARGIN + Math.random() * (COURT_WIDTH - 2 * WEAK_SHOT_MARGIN),
      y: WEAK_SHOT_MARGIN + Math.random() * (NET_Y - 2 * WEAK_SHOT_MARGIN),
    };
    // Launch from the ball's own live position, not this.pos: contact is
    // allowed within HIT_RANGE (not exact overlap), so using the player's
    // position here would snap the ball at the moment of contact instead of
    // continuing smoothly from where it actually is.
    ball.launch({ ...ball.pos }, target, {
      duration: WEAK_SHOT_DURATION,
      peakHeight: WEAK_SHOT_PEAK_HEIGHT,
      toucher: 'player',
    });
  }

  private startJump(): void {
    this.state = 'jumping_up';
    this.stateTimer = 0;
    this.height = 0;
  }

  private updateJumpUp(dt: number, input: InputSnapshot, ball: Ball): void {
    // No lateral movement while jumping.
    this.stateTimer += dt;
    this.height = JUMP_PEAK_HEIGHT * clamp(this.stateTimer / JUMP_RISE_DURATION, 0, 1);

    if (input.swipe) {
      // A well-aimed swipe fires immediately. Out of range: forgiven, not a
      // failed attempt - stay up and let another swipe be tried before the
      // peak, matching the whole point of this redesign (less time pressure).
      if (this.trySpike(input.swipe, ball)) this.enterFalling();
      return;
    }

    if (this.stateTimer >= JUMP_RISE_DURATION) {
      // The aiming window always closes at the peak - attempt a default-
      // direction spike (still range-gated: a jump taken far from the ball
      // can still whiff), then fall regardless.
      this.trySpike(DEFAULT_AIM_DIR, ball);
      this.enterFalling();
    }
  }

  private enterFalling(): void {
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  private updateJumpDown(dt: number): void {
    this.stateTimer += dt;
    const u = clamp(this.stateTimer / JUMP_FALL_DURATION, 0, 1);
    this.height = this.fallStartHeight * (1 - u);
    if (u >= 1) {
      this.height = 0;
      this.state = 'active';
      this.stateTimer = 0;
    }
  }

  /** A hard, precisely-aimed spike toward the given direction. Returns
   * whether it connected (proximity gate only, like the weak shot). */
  private trySpike(dir: Vec2, ball: Ball): boolean {
    if (distance(this.pos, ball.pos) > HIT_RANGE) return false;

    const target = this.computeSpikeTarget(dir);
    // Launch from the ball's own live position (see tryHit() for why), while
    // the aim/target itself is still computed from the player's position.
    ball.launch({ ...ball.pos }, target, {
      duration: SPIKE_DURATION,
      peakHeight: SPIKE_PEAK_HEIGHT,
      toucher: 'player',
    });
    return true;
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
