import {
  Vec2,
  clamp,
  closestPointOnSegment,
  distance,
  length,
  lerp,
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
  DIVE_MAX_DURATION,
  DIVE_MIN_DURATION,
  DIVE_PEAK_HEIGHT,
  DIVE_RECOVERY_DURATION,
  DIVE_SPEED,
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
  SET_NET_APPROACH_Y,
  SET_NET_BLEND,
  SLOWMO_REAL_DURATION,
  SERVE_BASELINE_Y,
  SERVE_DEFAULT_AIM_STRENGTH,
  SERVE_JUMP_DELAY,
  SERVE_MAX_RANGE,
  SERVE_MIN_RANGE,
  SERVE_TOSS_DURATION,
  SERVE_TOSS_PEAK_HEIGHT,
  SPIKE_MIN_RANGE,
  SPIKE_RANGE,
  SPIKE_SCATTER_RADIUS,
  SPIKE_SWIPE_SLOW_FACTOR,
  SPIKE_TARGET_MARGIN,
  DEFAULT_AIM_STRENGTH,
} from '../game/constants';
import { Ball } from './Ball';
import type { AimPreview } from './Ball';
import { spikeShot } from '../game/spikePower';
import { InputSnapshot } from '../input/InputManager';

export type PlayerState =
  | 'active'
  | 'diving'
  | 'recovering'
  | 'jumping_up'
  | 'slowmo_aim'
  | 'jumping_down'
  /** Preparing to serve: ball in hand, movement restricted to sliding along
   * the own baseline, waiting for the serve press. */
  | 'serve_ready'
  /** The ball has been tossed straight up and the player is about to spring
   * after it (see SERVE_JUMP_DELAY). */
  | 'serve_toss';

/** Nudges a landing point by a small random offset - uniformly over a disc of
 * SPIKE_SCATTER_RADIUS, so the shot is honest rather than machine-perfect. The
 * sqrt is what makes it uniform over the AREA; without it the offsets would
 * bunch toward the centre and the scatter would barely read. */
function scatter(target: Vec2): Vec2 {
  const angle = random() * Math.PI * 2;
  const radius = Math.sqrt(random()) * SPIKE_SCATTER_RADIUS;
  return { x: target.x + Math.cos(angle) * radius, y: target.y + Math.sin(angle) * radius };
}

/** The serve stance: pinned to the own baseline, and never outside the side
 * lines. Both are hard walls rather than soft nudges - y is *set*, not eased,
 * so no accumulated forward drift can ever survive a frame, and x is clamped
 * to the same [radius, width - radius] band the rest of the game uses, so the
 * player can neither slip through a side line nor slide on beyond it however
 * long the stick is held. Applied on entering serve_ready and again after
 * every single movement step. */
function clampToBaseline(p: Vec2): Vec2 {
  return {
    x: clamp(p.x, PLAYER_RADIUS, COURT_WIDTH - PLAYER_RADIUS),
    y: SERVE_BASELINE_Y,
  };
}

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
 *   instead AND the less power it carries when it does go over (see
 *   resolveSpike / spikeWeakness).
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
  /** How hard the current aim would hit, 0..1 - the swipe's own length (see
   * InputSnapshot.aim). Drives how far the spike is aimed and, secondarily,
   * its pace. */
  aimStrength: number = DEFAULT_AIM_STRENGTH;
  /** The trajectory the spike would fly if it were struck right now, or null
   * when no aim is being taken. Recomputed every frame of the aim window so it
   * tracks the swipe live; read by the renderer to draw the preview. */
  aimPreview: AimPreview | null = null;

  private stateTimer = 0;
  private approachStart: Vec2 = { ...this.pos };
  private approachTarget: Vec2 = { ...this.pos };
  /** How long this particular dive's dash lasts - derived from the distance
   * it has to cover at DIVE_SPEED, so every dive lunges at the same pace. */
  private diveDuration = DIVE_MIN_DURATION;
  private fallStartHeight = 0;
  /** Distance from the net at the moment of takeoff - drives the spike's
   * net-fault risk (see resolveSpike). */
  private jumpStartNetDistance = 0;

  /** True for the whole serve routine - from entering serve_ready right up to
   * the moment the ball is actually struck (or the attempt is over). This is
   * what the serve UI is switched on by, and what keeps the AI teammate from
   * poaching the server's own toss. */
  private serving = false;

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
        this.updateJumpingUp(dt, input, ball);
        break;
      case 'slowmo_aim':
        this.updateSlowmoAim(dt, input, ball);
        break;
      case 'jumping_down':
        this.updateJumpingDown(dt, input, ball);
        break;
      case 'serve_ready':
        this.updateServeReady(dt, input, ball);
        break;
      case 'serve_toss':
        this.updateServeToss(dt, ball);
        break;
    }
  }

  /** Puts the player into serve preparation: ball in hand, pinned to the
   * baseline. Called by GameState when this team wins the right to serve. */
  enterServeReady(): void {
    this.state = 'serve_ready';
    this.serving = true;
    this.stateTimer = 0;
    this.height = 0;
    this.aimPreview = null;
    this.aimDir = { ...DEFAULT_AIM_DIR };
    this.aimStrength = SERVE_DEFAULT_AIM_STRENGTH;
    this.clearPendingInputs();
    this.pos = clampToBaseline(this.pos);
  }

  /** True while the serve has been set up but not yet struck - i.e. for as
   * long as the serving UI should be showing. Covers the whole routine: the
   * wait, the toss, the jump and the aim window. */
  get isServing(): boolean {
    return this.serving;
  }

  /** Waiting to serve. Only two things are possible here: sliding along the
   * baseline, and pressing serve. Every other action is simply not reachable
   * from this state, which is what makes the serve UI honest - the buttons are
   * hidden AND the actions behind them are unavailable. */
  private updateServeReady(dt: number, input: InputSnapshot, ball: Ball): void {
    this.applyServeMovement(dt, input.move);
    // The ball rests in the server's hand.
    ball.pos = { ...this.pos };
    if (input.serve) this.startServeToss(ball);
  }

  /** Tosses the ball straight up and starts the clock on the jump. */
  private startServeToss(ball: Ball): void {
    const from = { ...this.pos };
    ball.launch(from, { ...from }, {
      duration: SERVE_TOSS_DURATION,
      peakHeight: SERVE_TOSS_PEAK_HEIGHT,
      toucher: null,
    });
    this.state = 'serve_toss';
    this.stateTimer = 0;
  }

  /** The beat between toss and jump. No contact is checked here on purpose:
   * the toss starts at ground level, so without this wait the ball would be
   * "in reach" the instant it left the hand and the aim window would open
   * before the ball had gone anywhere. */
  private updateServeToss(dt: number, ball: Ball): void {
    this.stateTimer += dt;
    if (this.stateTimer >= SERVE_JUMP_DELAY) this.tryStartJump(ball);
  }

  /** Movement while preparing to serve: along the baseline only. Forward
   * motion into the court is dropped outright rather than clamped afterwards,
   * and the side lines are a hard wall (see clampToBaseline). */
  private applyServeMovement(dt: number, moveVector: Vec2): void {
    const lateralOnly = { x: moveVector.x, y: 0 };
    const dir = normalize(lateralOnly);
    const magnitude = Math.min(1, length(lateralOnly));
    this.pos.x += dir.x * PLAYER_SPEED * magnitude * dt;
    this.pos = clampToBaseline(this.pos);
  }

  private updateActive(
    dt: number,
    input: InputSnapshot,
    ball: Ball,
    teammatePos: Vec2,
    mustCrossNet: boolean,
  ): void {
    // A ball the player themselves just played is not one they can play again
    // (see ballReachable's own lastToucher guard), so the assist must not walk
    // them after it. Without this the player gets quietly dragged along behind
    // their own pass for as long as the input stays buffered, ending up out of
    // position - and, once the teammate has attacked off it, close enough to
    // take a third touch nobody asked for.
    const ballFlying = ball.state === 'flying' && ball.lastToucher !== 'player';
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
    this.diveDuration = clamp(
      distance(this.pos, intercept) / DIVE_SPEED,
      DIVE_MIN_DURATION,
      DIVE_MAX_DURATION,
    );
    this.height = 0;
    this.stateTimer = 0;
    this.state = 'diving';
  }

  private updateDiving(dt: number, ball: Ball, teammatePos: Vec2, mustCrossNet: boolean): void {
    if (this.ballReachable(ball)) {
      this.resolveContact(ball, teammatePos, mustCrossNet, 'hechten');
      this.endDive();
      return;
    }

    this.stateTimer += dt;
    const u = clamp(this.stateTimer / this.diveDuration, 0, 1);

    // Cubic ease-out: most of the ground is covered in the first instants and
    // the dive then settles, which is what gives it the sharp launch of a real
    // lunge rather than the even glide a linear ramp produces. At a quarter of
    // the way through the dive is already ~58% of the way there.
    const eased = 1 - (1 - u) ** 3;
    this.pos = lerpVec2(this.approachStart, this.approachTarget, eased);
    // Low hop, peaking mid-dive - purely visual (the renderer lifts the token
    // and drops a shadow beneath it), never part of any contact check.
    this.height = DIVE_PEAK_HEIGHT * 4 * u * (1 - u);

    if (u >= 1) this.endDive();
  }

  /** Ends a dive - whether it connected or not - into the recovery pause,
   * with the hop reset so the player is back on the ground. */
  private endDive(): void {
    this.height = 0;
    this.state = 'recovering';
    this.stateTimer = 0;
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

  private updateJumpingUp(dt: number, input: InputSnapshot, ball: Ball): void {
    this.updateAirborneAim(input);

    // The second Q press: hits the smash right now, but only if the ball is
    // genuinely in reach at this instant. Checked BEFORE the automatic
    // slow-motion entry below, because both can come true on the same frame
    // and the press would otherwise be swallowed by the state change (it is
    // edge-triggered, so it would be gone by the next frame).
    if (this.trySpikeOnDemand(input, ball)) return;

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

  /** The flight the spike would take if struck this instant: launched from the
   * ball's own live position and height, aimed by the current swipe. Shares
   * spikeShot and computeSpikeTarget with the real shot, so the preview cannot
   * drift away from what actually happens. The random scatter is deliberately
   * NOT previewed - it is what makes the shot imperfect, and showing it would
   * be showing the player a dice roll that has not been made yet. */
  private buildAimPreview(ball: Ball): AimPreview {
    const shot = this.spikeShotForCurrentAim();
    return {
      from: { ...ball.pos },
      target: this.computeSpikeTarget(this.aimDir, this.aimStrength),
      duration: shot.duration,
      peakHeight: shot.peakHeight,
      initialHeight: ball.height,
    };
  }

  /** The spike's flight parameters for the aim currently held. Net distance at
   * takeoff is the dominant term (spikeShot); the swipe's length only stretches
   * the duration, by up to SPIKE_SWIPE_SLOW_FACTOR at the shortest swipe and
   * by nothing at all at full strength. */
  private spikeShotForCurrentAim(): { duration: number; peakHeight: number } {
    const base = spikeShot(this.jumpStartNetDistance);
    return {
      duration: base.duration * lerp(SPIKE_SWIPE_SLOW_FACTOR, 1, this.aimStrength),
      peakHeight: base.peakHeight,
    };
  }

  /** Real-time aim window (GameState passes this the same unscaled dt it
   * always does - only the ball's own update() is slowed while this state is
   * active, see GameState.update). A swipe sets the aim and resolves right
   * away; otherwise the window force-resolves with the default aim once
   * SLOWMO_REAL_DURATION has elapsed, so play can never stall on a missed
   * swipe. */
  private updateSlowmoAim(dt: number, input: InputSnapshot, ball: Ball): void {
    this.updateAirborneAim(input);
    // Recomputed every frame so the drawn curve follows the swipe live, and is
    // exactly the shot that firing right now would produce - same target, same
    // duration, same arc (scatter aside, which is by definition unknowable in
    // advance).
    this.aimPreview = this.buildAimPreview(ball);

    // Keyboard: the second Q hits it, using whatever direction WASD is
    // currently holding. Same in-reach requirement as everywhere else.
    if (this.trySpikeOnDemand(input, ball)) return;

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

  /** Resolves the jump-smash. How far from the net the player was standing
   * when they jumped (jumpStartNetDistance) drives two separate consequences,
   * both ramping in over the same stretch of court:
   *
   * - a net-fault risk roll, deciding between the aimed spike and a short,
   *   low shot that nets out and drops back on the player's own side (which
   *   the existing landed-in-which-half scoring in GameState already
   *   attributes correctly - no separate "fault" concept needed), and
   * - the spike's own power (see spikeWeakness): struck at the net it keeps
   *   its full, flat, fast form; from deep it arrives slower and loopier, and
   *   so is genuinely defendable rather than a near-certain point. */
  private resolveSpike(ball: Ball): void {
    // The aim window is over either way - nothing left to preview.
    this.aimPreview = null;
    // ...and so is the serve, either way: struck, or missed and gone. Kept set
    // until the shot itself has been built below, since computeSpikeTarget
    // reads it - then cleared, which is what hands the UI back to the normal
    // action buttons (see isServing).
    const isServe = this.serving;

    // The ball isn't frozen during slowmo_aim (see GameState.update) - it
    // keeps creeping along its original flight, heavily slowed but not
    // stopped, so a fast original shot (or a long aim window) can drift it
    // back out of HIT_RANGE before this resolves. Re-check right here: no
    // contact is ever allowed to fire from a position the player didn't
    // actually reach - let the ball fly on untouched instead.
    if (!this.ballReachable(ball)) {
      this.serving = false;
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
    // A serve is exempt from the net-fault roll. It is by definition struck
    // from the baseline, i.e. at the far end of the risk ramp, where the roll
    // would net out more than half of all serves - and unlike a rally smash,
    // that risk was never a choice the player made: they cannot serve from
    // anywhere else. It would also make the live trajectory preview a lie,
    // since the roll happens after and regardless of what the preview showed.
    // Everything else about the serve strike IS the ordinary smash: aim,
    // swipe-length power, scatter, and the possibility of hitting it out.
    const faulted = !isServe && random() < risk;

    if (faulted) {
      ball.launch({ ...ball.pos }, this.netFaultTarget(ball), {
        duration: NET_FAULT_DURATION,
        peakHeight: NET_FAULT_PEAK_HEIGHT,
        toucher: 'player',
      });
    } else {
      const shot = this.spikeShotForCurrentAim();
      const aimed = this.computeSpikeTarget(this.aimDir, this.aimStrength);
      ball.launch({ ...ball.pos }, scatter(aimed), {
        duration: shot.duration,
        peakHeight: shot.peakHeight,
        toucher: 'player',
      });
    }

    this.serving = false;
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  /** While airborne, the movement input stops being movement and becomes the
   * smash's aim: WASD on the keyboard, or the joystick on touch. Ignores a
   * neutral stick so releasing it mid-jump keeps the aim you already had
   * rather than snapping back to the default. */
  private updateAirborneAim(input: InputSnapshot): void {
    if (!input.aim) return;
    this.aimDir = input.aim.dir;
    this.aimStrength = input.aim.strength;
  }

  /** The second Q press, from any airborne state. Fires the smash only when
   * the ball is actually within reach at that exact moment - the same
   * distance/height contact conditions every other action uses. A press into
   * empty air does nothing at all: it neither fires nor interrupts the jump,
   * so mistiming it costs the swing, not the rally. Returns whether the smash
   * was played. */
  private trySpikeOnDemand(input: InputSnapshot, ball: Ball): boolean {
    if (!input.spike || !this.ballReachable(ball)) return false;
    this.resolveSpike(ball);
    return true;
  }

  private enterFalling(): void {
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  private updateJumpingDown(dt: number, input: InputSnapshot, ball: Ball): void {
    this.updateAirborneAim(input);

    if (this.trySpikeOnDemand(input, ball)) return;

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
      // Safety net for a serve jump that never got near the tossed ball at
      // all (so resolveSpike never ran): the attempt is over, hand the UI
      // back. Without this the serve buttons would stay up forever.
      this.serving = false;
    }
  }

  /** Pass to the AI teammate - and, like the teammate's own set to the player,
   * aimed near the net rather than squarely at where they happen to be
   * standing (see SET_NET_BLEND). That is what sets up the role swap: the
   * teammate receives the ball in an attacking position and plays its own shot
   * off it instead of setting straight back. Only the depth is shifted; x
   * stays on the teammate so the pass never asks them to sprint sideways. */
  private firePass(ball: Ball, teammatePos: Vec2): void {
    const nearNet: Vec2 = { x: teammatePos.x, y: SET_NET_APPROACH_Y };
    ball.launch({ ...ball.pos }, lerpVec2(teammatePos, nearNet, SET_NET_BLEND), {
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

  /** Where the spike is aimed. Deliberately NOT clamped into the opponent
   * court: a spike may be hit out, and it is the player's job - not the game's
   * - to keep it in. The swipe's length sets how far it is aimed, between
   * SPIKE_MIN_RANGE (a flick, dropping it in short) and SPIKE_RANGE (a full
   * drag, deep enough to sail past the baseline if mis-aimed).
   *
   * A serve uses the same mapping over its own distances (SERVE_MIN_RANGE..
   * SERVE_MAX_RANGE) - see those constants for why the spike band cannot work
   * from the baseline. */
  private computeSpikeTarget(aimDir: Vec2, strength: number): Vec2 {
    const dir = normalize(aimDir);
    const range = this.serving
      ? lerp(SERVE_MIN_RANGE, SERVE_MAX_RANGE, clamp(strength, 0, 1))
      : lerp(SPIKE_MIN_RANGE, SPIKE_RANGE, clamp(strength, 0, 1));
    return { x: this.pos.x + dir.x * range, y: this.pos.y + dir.y * range };
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
