import {
  Vec2,
  clamp,
  closestPointOnSegment,
  distance,
  length,
  lerpVec2,
  normalize,
  sub,
} from '../utils/math';
import { random } from '../utils/random';
import {
  ASSIST_RANGE,
  ASSIST_SPEED_MULTIPLIER,
  CATCHABLE_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  DIVE_DASH_DURATION,
  DIVE_RECOVERY_DURATION,
  HIT_DURATION,
  HIT_PEAK_HEIGHT,
  HIT_RANGE,
  INPUT_BUFFER_WINDOW,
  JUMP_ASSIST_RANGE,
  JUMP_FALL_DURATION,
  JUMP_PEAK_HEIGHT,
  JUMP_RISE_DURATION,
  NET_FAULT_DURATION,
  NET_FAULT_OWN_SIDE_MARGIN,
  NET_FAULT_PEAK_HEIGHT,
  NET_RISK_MAX,
  NET_RISK_MAX_DISTANCE,
  NET_RISK_SAFE_DISTANCE,
  NET_Y,
  PASS_DURATION,
  PASS_PEAK_HEIGHT,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  PLAYER_START_POS,
  RANDOM_TARGET_MARGIN,
  REACH_RANGE,
  SLOWMO_REAL_DURATION,
  SPIKE_DURATION,
  SPIKE_PEAK_HEIGHT,
  SPIKE_RANGE,
  SPIKE_TARGET_MARGIN,
} from '../game/constants';
import { Ball } from './Ball';
import { InputSnapshot } from '../input/InputManager';

export type PlayerState = 'active' | 'diving' | 'recovering' | 'jumping_up' | 'slowmo_aim' | 'jumping_down';

/** Default spike direction (straight toward the net), used if the slow-motion
 * aim window times out without a swipe. */
const DEFAULT_AIM_DIR: Vec2 = { x: 0, y: -1 };

/**
 * The human-controlled player. Five inputs, exactly as specced:
 *
 * - the joystick: free movement within the player's own half.
 * - Hechten (dive button): sends the player into a one-shot dash to the
 *   nearest intercept point on the flying ball's remaining path - only as far
 *   as that ball actually needs, up to REACH_RANGE. The direction is derived
 *   entirely from the ball's own trajectory: neither the joystick nor a swipe
 *   has to point anywhere in particular. Resolves automatically on contact
 *   (pass to the teammate, or a safe over-net hit if that would be the team's
 *   mandatory final touch), and always ends in a short recovery pause.
 * - Sprung-Schmetterschlag (jump button): works from anywhere, any time.
 *   Jumps immediately, with a light automatic drift toward the ball's
 *   predicted intercept point (only within the much smaller
 *   JUMP_ASSIST_RANGE - a subtle correction, not a dash). Ball contact while
 *   airborne opens a brief real-time slow-motion window (slowmo_aim) in which
 *   a swipe sets the hard spike's aim direction - the only thing swipes are
 *   still used for; no swipe times out with the
 *   default (straight over the net). The further from the net the player was
 *   standing when they jumped, the higher the chance the spike nets out
 *   instead (see resolveSpike).
 * - Pass button: a controlled, medium touch straight to the AI teammate.
 *   Same "just be roughly nearby" principle as Hechten, but via a light,
 *   continuous walking-speed assist (ASSIST_RANGE) rather than a dash.
 *   (Note ASSIST_RANGE is deliberately small - see its own doc comment.)
 *   Auto-converts to a safe over-net hit if it would be the team's mandatory
 *   final touch.
 * - Notfall-Schlag (small emergency button): same buffering/assist as Pass,
 *   but always a simple, weak hit to a safe spot over the net - from
 *   anywhere, no jump, always legal regardless of touch count.
 *
 * In every case, contact only actually happens once the ball is truly within
 * HIT_RANGE - never pre-emptively.
 */
export class Player {
  pos: Vec2 = { ...PLAYER_START_POS };
  radius = PLAYER_RADIUS;
  state: PlayerState = 'active';
  /** Visual-only vertical lift while jumping (mirrors Ball.height). */
  height = 0;
  /** Current spike aim direction, set by the aim-swipe during slowmo_aim
   * (exposed for the renderer's aim indicator). */
  aimDir: Vec2 = { ...DEFAULT_AIM_DIR };

  private stateTimer = 0;
  private approachStart: Vec2 = { ...this.pos };
  private approachTarget: Vec2 = { ...this.pos };
  private fallStartHeight = 0;
  /** Distance from the net at the moment of takeoff - drives the spike's
   * net-fault risk (see resolveSpike). */
  private jumpStartNetDistance = 0;

  private passBuffered = false;
  private passBufferAge = 0;
  private hitBuffered = false;
  private hitBufferAge = 0;

  /** Whether the player currently has a fresh Pass/Notfall-Schlag press
   * buffered (see updateInputBuffers) - i.e. has actively signaled intent to
   * play the ball themselves. Read by TeammateAI to decide ball-contact
   * priority: a player who just pressed one of these shouldn't have the
   * teammate AI swoop in and take the ball first (see TeammateAI's
   * playerHasPriority). */
  get hasPendingContactInput(): boolean {
    return this.passBuffered || this.hitBuffered;
  }

  update(
    dt: number,
    input: InputSnapshot,
    ball: Ball,
    teammatePos: Vec2,
    mustCrossNet: boolean,
  ): void {
    this.updateInputBuffers(dt, input);

    switch (this.state) {
      case 'active':
        this.updateActive(dt, input, ball, teammatePos, mustCrossNet);
        break;
      case 'diving':
        this.updateDiving(dt, ball, teammatePos, mustCrossNet);
        break;
      case 'recovering':
        this.stateTimer += dt;
        if (this.stateTimer >= DIVE_RECOVERY_DURATION) {
          this.state = 'active';
          this.stateTimer = 0;
        }
        break;
      case 'jumping_up':
        this.updateJumpingUp(dt, ball);
        break;
      case 'slowmo_aim':
        this.updateSlowmoAim(dt, input, ball);
        break;
      case 'jumping_down':
        this.updateJumpingDown(dt, ball);
        break;
    }
  }

  private updateActive(
    dt: number,
    input: InputSnapshot,
    ball: Ball,
    teammatePos: Vec2,
    mustCrossNet: boolean,
  ): void {
    const ballFlying = ball.state === 'flying';
    let assisted = false;

    // Pass/Notfall-Schlag "vorgehalten": once the ball's intercept point is
    // close enough to walk to normally (but not yet in HIT_RANGE), a light
    // assist walk overrides the joystick for this frame - the AI doing "the
    // exact fine movement", per spec, while the player just has to be roughly
    // in the area.
    if ((this.passBuffered || this.hitBuffered) && ballFlying) {
      const intercept = closestPointOnSegment(this.pos, ball.pos, ball.target);
      const interceptDist = distance(this.pos, intercept);
      if (interceptDist > HIT_RANGE && interceptDist <= ASSIST_RANGE) {
        this.assistWalk(dt, intercept);
        assisted = true;
      }
    }
    if (!assisted) this.applyMovement(dt, input.move);

    if (input.dive) this.tryButtonDive(ball);

    // tryButtonDive may have switched state to 'diving' - jump/resolve only
    // apply if we're still active.
    if (this.state !== 'active') return;

    if (input.jump) {
      this.tryStartJump(ball);
      return;
    }

    if ((this.passBuffered || this.hitBuffered) && this.ballReachable(ball)) {
      this.resolveContact(ball, teammatePos, mustCrossNet, 'button');
    }
  }

  private applyMovement(dt: number, moveVector: Vec2): void {
    const dir = normalize(moveVector);
    const magnitude = Math.min(1, length(moveVector));
    this.pos.x += dir.x * PLAYER_SPEED * magnitude * dt;
    this.pos.y += dir.y * PLAYER_SPEED * magnitude * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Smooth, continuous walking-speed homing toward `target` - the "light"
   * correction used by Pass/Notfall-Schlag (ASSIST_RANGE) and, in
   * updateJumpingUp, the Jump-Smash's in-air drift. Distinct from the
   * Hechten dash, which is a single lerp over a fixed duration. */
  private assistWalk(dt: number, target: Vec2): void {
    const dir = normalize(sub(target, this.pos));
    const speed = PLAYER_SPEED * ASSIST_SPEED_MULTIPLIER;
    this.pos.x += dir.x * speed * dt;
    this.pos.y += dir.y * speed * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Remembers a fresh Pass/Notfall-Schlag press for INPUT_BUFFER_WINDOW
   * seconds, so either can be pressed before the ball is actually in reach. */
  private updateInputBuffers(dt: number, input: InputSnapshot): void {
    if (input.pass) {
      this.passBuffered = true;
      this.passBufferAge = 0;
    } else if (this.passBuffered) {
      this.passBufferAge += dt;
      if (this.passBufferAge > INPUT_BUFFER_WINDOW) this.passBuffered = false;
    }

    if (input.hit) {
      this.hitBuffered = true;
      this.hitBufferAge = 0;
    } else if (this.hitBuffered) {
      this.hitBufferAge += dt;
      if (this.hitBufferAge > INPUT_BUFFER_WINDOW) this.hitBuffered = false;
    }
  }

  /** Whether the ball is a live target the player can react to right now:
   * actually flying, within HIT_RANGE of the ball's *current* ground-plane
   * position (never ball.target, the landing-point prediction), at a height
   * the player can actually reach, and - crucially - not the very ball the
   * player themselves just launched (a freshly-hit ball starts out colocated
   * with the player, which would otherwise immediately re-trigger a "catch"
   * on the very next frame). All three - distance, height, freshly-hit guard
   * - must hold in the same frame; being close on the ground while the ball
   * is still meters overhead is deliberately NOT enough (see CATCHABLE_HEIGHT). */
  private ballReachable(ball: Ball): boolean {
    if (ball.state !== 'flying' || ball.lastToucher === 'player') return false;
    return distance(this.pos, ball.pos) <= HIT_RANGE && ball.height <= CATCHABLE_HEIGHT;
  }

  /** Hechten button: sends the player into a one-shot dash toward the nearest
   * point of the flying ball's remaining path - the only ball there ever is,
   * so "the relevant ball" needs no disambiguation. No aiming of any kind is
   * required: neither the joystick nor a swipe direction is consulted, the
   * dash target is derived purely from the ball's own trajectory. Silently
   * does nothing if no ball is flying or its whole remaining path is farther
   * than REACH_RANGE away - that's a dive the player physically can't make.
   * Every dive ends in the 'recovering' state (see updateDiving), so there is
   * always a short pause afterwards, whether or not it connected. */
  private tryButtonDive(ball: Ball): void {
    if (ball.state !== 'flying') return;

    const intercept = closestPointOnSegment(this.pos, ball.pos, ball.target);
    if (distance(this.pos, intercept) > REACH_RANGE) return;

    this.approachStart = { ...this.pos };
    this.approachTarget = intercept;
    this.stateTimer = 0;
    this.state = 'diving';
  }

  private updateDiving(dt: number, ball: Ball, teammatePos: Vec2, mustCrossNet: boolean): void {
    if (this.ballReachable(ball)) {
      this.resolveContact(ball, teammatePos, mustCrossNet, 'hechten');
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

  /** Fires whatever the dive/Pass/Notfall-Schlag contact resolves to: a
   * Notfall-Schlag if that was explicitly buffered, or if this touch must
   * legally cross the net (mandatory final team touch); a controlled pass to
   * the teammate otherwise (the default for a bare Hechten with nothing
   * buffered, and for a buffered Pass). `origin` is only for the debug log
   * below - it doesn't affect which shot fires. */
  private resolveContact(ball: Ball, teammatePos: Vec2, mustCrossNet: boolean, origin: 'hechten' | 'button'): void {
    const fired = this.hitBuffered || mustCrossNet ? 'notfall-schlag' : 'pass';
    this.logContact(origin === 'hechten' ? 'hechten' : fired, ball);
    if (fired === 'notfall-schlag') {
      this.fireHit(ball);
    } else {
      this.firePass(ball, teammatePos);
    }
    this.clearPendingInputs();
  }

  /** Required debug trail for the "contact fires without the player actually
   * being at the ball's current position/height" bug: logs, at the exact
   * moment ANY contact actually fires, the live distance and height that
   * satisfied ballReachable() - so a fix (or a regression) is verifiable from
   * the console instead of taken on faith. Logged only on an actual fire,
   * never on a rejected attempt (ball just keeps flying then, silently). */
  private logContact(action: string, ball: Ball): void {
    console.log('[BallContact] player', action, {
      distance: Number(distance(this.pos, ball.pos).toFixed(3)),
      height: Number(ball.height.toFixed(3)),
      hitRange: HIT_RANGE,
      catchableHeight: CATCHABLE_HEIGHT,
      conditionA_distanceOk: true,
      conditionB_heightOk: true,
      conditionC_inputActive: true,
    });
  }

  private clearPendingInputs(): void {
    this.passBuffered = false;
    this.hitBuffered = false;
  }

  /** Sprung-Schmetterschlag button: jumps from anywhere. If the ball's
   * intercept point is within the light JUMP_ASSIST_RANGE, drifts toward it
   * while rising; otherwise jumps in place. */
  private tryStartJump(ball: Ball): void {
    let target: Vec2 = { ...this.pos };
    if (ball.state === 'flying') {
      const intercept = closestPointOnSegment(this.pos, ball.pos, ball.target);
      if (distance(this.pos, intercept) <= JUMP_ASSIST_RANGE) target = intercept;
    }

    this.approachStart = { ...this.pos };
    this.approachTarget = target;
    this.jumpStartNetDistance = Math.max(0, this.pos.y - NET_Y);
    this.aimDir = { ...DEFAULT_AIM_DIR };
    this.height = 0;
    this.stateTimer = 0;
    this.state = 'jumping_up';
  }

  private updateJumpingUp(dt: number, ball: Ball): void {
    if (this.ballReachable(ball)) {
      this.enterSlowmoAim();
      return;
    }

    this.stateTimer += dt;
    const u = clamp(this.stateTimer / JUMP_RISE_DURATION, 0, 1);
    this.height = JUMP_PEAK_HEIGHT * u;
    this.pos = lerpVec2(this.approachStart, this.approachTarget, u);

    if (this.stateTimer >= JUMP_RISE_DURATION) {
      this.enterFalling();
    }
  }

  private enterSlowmoAim(): void {
    this.state = 'slowmo_aim';
    this.stateTimer = 0;
  }

  /** Real-time aim window (GameState passes this the same unscaled dt it
   * always does - only the ball's own update() is slowed while this state is
   * active, see GameState.update). A swipe sets the aim and resolves right
   * away; otherwise the window force-resolves with the default aim once
   * SLOWMO_REAL_DURATION has elapsed, so play can never stall on a missed
   * swipe. */
  private updateSlowmoAim(dt: number, input: InputSnapshot, ball: Ball): void {
    if (input.swipe) {
      this.aimDir = normalize(input.swipe);
      this.resolveSpike(ball);
      return;
    }

    this.stateTimer += dt;
    if (this.stateTimer >= SLOWMO_REAL_DURATION) {
      this.resolveSpike(ball);
    }
  }

  /** Resolves the jump-smash: a net-fault risk roll (scaled by how far from
   * the net the player was standing when they jumped - see
   * jumpStartNetDistance) decides between the hard aimed spike and a short,
   * low shot that nets out and drops back on the player's own side (which the
   * existing landed-in-which-half scoring in GameState already attributes
   * correctly - no separate "fault" concept needed). */
  private resolveSpike(ball: Ball): void {
    // The ball isn't frozen during slowmo_aim (see GameState.update) - it
    // keeps creeping along its original flight, heavily slowed but not
    // stopped, so a fast original shot (or a long aim window) can drift it
    // back out of HIT_RANGE before this resolves. Re-check right here: no
    // contact is ever allowed to fire from a position the player didn't
    // actually reach - let the ball fly on untouched instead.
    if (!this.ballReachable(ball)) {
      this.fallStartHeight = this.height;
      this.state = 'jumping_down';
      this.stateTimer = 0;
      return;
    }

    this.logContact('schmetterschlag', ball);

    const riskT = clamp(
      (this.jumpStartNetDistance - NET_RISK_SAFE_DISTANCE) / (NET_RISK_MAX_DISTANCE - NET_RISK_SAFE_DISTANCE),
      0,
      1,
    );
    const risk = riskT * NET_RISK_MAX;
    const faulted = random() < risk;

    if (faulted) {
      ball.launch({ ...ball.pos }, this.netFaultTarget(ball), {
        duration: NET_FAULT_DURATION,
        peakHeight: NET_FAULT_PEAK_HEIGHT,
        toucher: 'player',
      });
    } else {
      ball.launch({ ...ball.pos }, this.computeSpikeTarget(this.aimDir), {
        duration: SPIKE_DURATION,
        peakHeight: SPIKE_PEAK_HEIGHT,
        toucher: 'player',
      });
    }

    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  private enterFalling(): void {
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  private updateJumpingDown(dt: number, ball: Ball): void {
    // A little extra forgiveness: a ball arriving just after the jump's peak
    // can still be smashed on the way down, rather than only during the rise.
    // ballReachable's lastToucher guard is what stops this from immediately
    // re-triggering on the very ball this jump itself just fired.
    if (this.ballReachable(ball)) {
      this.enterSlowmoAim();
      return;
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

  private firePass(ball: Ball, teammatePos: Vec2): void {
    ball.launch({ ...ball.pos }, { ...teammatePos }, {
      duration: PASS_DURATION,
      peakHeight: PASS_PEAK_HEIGHT,
      toucher: 'player',
    });
  }

  private fireHit(ball: Ball): void {
    const target: Vec2 = {
      x: RANDOM_TARGET_MARGIN + random() * (COURT_WIDTH - 2 * RANDOM_TARGET_MARGIN),
      y: RANDOM_TARGET_MARGIN + random() * (NET_Y - 2 * RANDOM_TARGET_MARGIN),
    };
    ball.launch({ ...ball.pos }, target, {
      duration: HIT_DURATION,
      peakHeight: HIT_PEAK_HEIGHT,
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

  private netFaultTarget(ball: Ball): Vec2 {
    return {
      x: clamp(ball.pos.x, SPIKE_TARGET_MARGIN, COURT_WIDTH - SPIKE_TARGET_MARGIN),
      y: NET_Y + NET_FAULT_OWN_SIDE_MARGIN,
    };
  }

  private clampToOwnHalf(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.radius, COURT_WIDTH - this.radius),
      y: clamp(p.y, NET_Y + this.radius, COURT_LENGTH - this.radius),
    };
  }
}
