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
  BLOCK_DURATION,
  BLOCK_NET_DISTANCE,
  BLOCK_RETURN_DURATION,
  BLOCK_RETURN_PEAK_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  HIT_DURATION,
  HIT_PEAK_HEIGHT,
  INPUT_BUFFER_WINDOW,
  JUMP_ASSIST_RANGE,
  MOVE_BOOST_DURATION,
  MOVE_BOOST_MULTIPLIER,
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
  SET_NET_APPROACH_Y,
  SET_NET_BLEND,
  SLOWMO_CONTACT_TOLERANCE,
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
  TOUCH_DISTANCE,
  DEFAULT_AIM_STRENGTH,
} from '../game/constants';
import { Ball } from './Ball';
import type { AimPreview } from './Ball';
import { ballIsBlockable, blockHeightAt, blockReboundTarget } from '../game/block';
import { spikeShot } from '../game/spikePower';
import { InputSnapshot } from '../input/InputManager';

export type PlayerState =
  | 'active'
  /** Wall up at the net (see updateBlocking). Immobile for its whole, short
   * duration, and no other action is reachable from it. */
  | 'blocking'
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
 * - Block button: throws a wall up at the net, on the spot. It moves the
 *   player nowhere at all - it only intercepts while they are already within
 *   BLOCK_NET_DISTANCE of the net, which is the whole positional requirement.
 *   An opponent attack passing through the wall (see ballIsBlockable) rebounds
 *   hard and steep straight back down onto the attacker's own side - pointedly
 *   not a reception. A lob over the top or a dink underneath beats it.
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
 * - Pass button: a controlled, medium touch straight to the AI teammate. The
 *   player only has to be roughly nearby: a light, continuous walking-speed
 *   assist (ASSIST_RANGE) closes the last stride. (Note ASSIST_RANGE is
 *   deliberately small - see its own doc comment.) Auto-converts to a safe
 *   over-net hit if it would be the team's mandatory final touch.
 * - Notfall-Schlag (small emergency button): same buffering/assist as Pass,
 *   but always a simple, weak hit to a safe spot over the net - from
 *   anywhere, no jump, always legal regardless of touch count.
 *
 * In every case, contact only actually happens once the ball's hitbox and the
 * player's actually overlap (see hitboxesTouch) - never pre-emptively. A press
 * made shortly before that moment is held for INPUT_BUFFER_WINDOW and fires on
 * the touch itself; one made too early expires without effect.
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
  private fallStartHeight = 0;
  /** Distance from the net at the moment of takeoff - drives the spike's
   * net-fault risk (see resolveSpike). */
  private jumpStartNetDistance = 0;
  /** Where the ball was in 3D at the instant the aim window opened. */
  private spikeContactAt: { x: number; y: number; h: number } | null = null;

  /** True for the whole serve routine - from entering serve_ready right up to
   * the moment the ball is actually struck (or the attempt is over). This is
   * what the serve UI is switched on by, and what keeps the AI teammate from
   * poaching the server's own toss. */
  private serving = false;

  /** Time left on the Bewegungs-Boost window (see updateMoveBoost). */
  private boostTimer = 0;

  private passBuffered = false;
  private passBufferAge = 0;
  private hitBuffered = false;
  private hitBufferAge = 0;

  /** Simulation clock in ms, advanced by dt every frame. Deterministic (it
   * follows the simulation, not the wall clock), which is what makes the
   * contact log below reproducible in a stepped test rather than only
   * observable by eye. */
  private clockMs = 0;
  /** When the currently-buffered press happened, and which button it was.
   * Null once the buffer has expired or been consumed. */
  private pressAtMs: number | null = null;
  private pressAction: string | null = null;
  /** When the hitboxes last STARTED touching, or null while they are apart.
   * This is the moment a buffered press is allowed to fire - never earlier. */
  private touchStartedAtMs: number | null = null;

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
    this.clockMs += dt * 1000;
    this.updateInputBuffers(dt, input);
    this.updateMoveBoost(dt, input);
    // Evaluated before anything moves, so a touch that already existed at the
    // start of the frame keeps its original timestamp.
    this.noteTouchState(ball);

    switch (this.state) {
      case 'active':
        this.updateActive(dt, input, ball, teammatePos, mustCrossNet);
        break;
      case 'blocking':
        this.updateBlocking(dt, ball);
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
    this.boostTimer = 0; // a boost from the last rally has no business here
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
      // Keeps closing until the hitboxes actually meet. The lower bound has to
      // be TOUCH_DISTANCE, not HIT_RANGE: with contact now firing at 0.5m,
      // stopping the assist at 0.7m would leave a 0.2m dead band in which the
      // player neither walks in nor connects.
      if (interceptDist > TOUCH_DISTANCE && interceptDist <= ASSIST_RANGE) {
        this.assistWalk(dt, intercept);
        assisted = true;
      }
    }
    if (!assisted) this.applyMovement(dt, input.move);

    // Block takes the frame outright: it is a state of its own from which no
    // other action is reachable, so nothing below can fire alongside it.
    if (input.block) {
      this.startBlock();
      return;
    }

    if (input.jump) {
      this.tryStartJump(ball);
      return;
    }

    // The buffered press fires HERE and nowhere else: only once the hitboxes
    // genuinely overlap. noteTouchState is re-run first because the assist
    // walk above can create the touch within this very frame, and the log has
    // to carry the moment it actually happened.
    if ((this.passBuffered || this.hitBuffered) && this.ballReachable(ball)) {
      this.noteTouchState(ball);
      this.resolveContact(ball, teammatePos, mustCrossNet);
    }
  }

  private applyMovement(dt: number, moveVector: Vec2): void {
    const dir = normalize(moveVector);
    const magnitude = Math.min(1, length(moveVector));
    const speed = this.moveSpeed;
    this.pos.x += dir.x * speed * magnitude * dt;
    this.pos.y += dir.y * speed * magnitude * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Smooth, continuous walking-speed homing toward `target` - the "light"
   * correction used by Pass/Notfall-Schlag within ASSIST_RANGE. (The
   * Jump-Smash's own in-air drift does not go through here; it lerps over the
   * jump's fixed duration, see updateJumpingUp.) */
  private assistWalk(dt: number, target: Vec2): void {
    const dir = normalize(sub(target, this.pos));
    // moveSpeed rather than PLAYER_SPEED so the boost carries the assist too -
    // otherwise pressing Pass would speed up manual running but not the very
    // correction that same press triggers. ASSIST_SPEED_MULTIPLIER is
    // unchanged at 1.0: the assist is still never faster than the player's own
    // running, boosted or not.
    const speed = this.moveSpeed * ASSIST_SPEED_MULTIPLIER;
    this.pos.x += dir.x * speed * dt;
    this.pos.y += dir.y * speed * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** The Bewegungs-Boost: a fixed MOVE_BOOST_DURATION window of extra pace,
   * armed by any Pass or Notfall-Schlag press.
   *
   * Unconditional by design - it never asks whether a ball is in flight,
   * whether it is reachable, or whether the pace is actually needed. It also
   * runs its clock down no matter what happens in between: catching the ball,
   * missing it, blocking, jumping. A press mid-boost simply restarts the
   * window rather than extending it.
   *
   * Decay first, arm second, so a press always yields the full window even on
   * the frame an older one would have expired. */
  private updateMoveBoost(dt: number, input: InputSnapshot): void {
    this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (input.pass || input.hit) this.boostTimer = MOVE_BOOST_DURATION;
  }

  /** Whether the boost window is currently open (exposed for tests). */
  get isBoosting(): boolean {
    return this.boostTimer > 0;
  }

  /** The pace every piece of ground movement runs at this frame - the
   * joystick's and the assist's alike. The ONLY thing the boost changes:
   * direction, ranges and contact conditions are all untouched by it. */
  private get moveSpeed(): number {
    return PLAYER_SPEED * (this.boostTimer > 0 ? MOVE_BOOST_MULTIPLIER : 1);
  }

  /** Remembers a fresh Pass/Notfall-Schlag press for INPUT_BUFFER_WINDOW
   * seconds, so either can be pressed before the ball is actually in reach. */
  private updateInputBuffers(dt: number, input: InputSnapshot): void {
    if (input.pass) {
      this.passBuffered = true;
      this.passBufferAge = 0;
      this.pressAtMs = this.clockMs;
      this.pressAction = 'pass';
    } else if (this.passBuffered) {
      this.passBufferAge += dt;
      if (this.passBufferAge > INPUT_BUFFER_WINDOW) this.passBuffered = false;
    }

    if (input.hit) {
      this.hitBuffered = true;
      this.hitBufferAge = 0;
      this.pressAtMs = this.clockMs;
      this.pressAction = 'notfall-schlag';
    } else if (this.hitBuffered) {
      this.hitBufferAge += dt;
      if (this.hitBufferAge > INPUT_BUFFER_WINDOW) this.hitBuffered = false;
    }

    // A press that ran out of window is gone for good - it must never fire
    // late, on a touch that happens after it expired. Only clears a Pass /
    // Notfall press: a jump press has no buffer, it stays recorded for as long
    // as the jump it started is in the air.
    const bufferedPress = this.pressAction === 'pass' || this.pressAction === 'notfall-schlag';
    if (bufferedPress && !this.passBuffered && !this.hitBuffered) {
      this.pressAtMs = null;
      this.pressAction = null;
    }
  }

  /**
   * THE contact condition for every action the human player takes: the two
   * hitboxes actually overlap.
   *
   * Measured in three dimensions - across the court AND in height - because
   * that is the only place the two bodies actually are. It must NOT be
   * measured on the drawn positions: the renderer projects height into a
   * y-offset, so a ball high up the court is drawn on top of a player it is
   * nowhere near. Measured: a ball 2.153m up the court at a height of 1.672m
   * (2.726m away in truth) projected to a drawn gap of 0.481m and counted as
   * a touch. Two axes must not be collapsed into one for this test.
   *
   * This replaces the old "reach" test (ground distance <= HIT_RANGE 0.7 with
   * ball height <= CATCHABLE_HEIGHT 2.0), which was far more generous than
   * touching and is what made contact fire while the ball was still visibly
   * away from the player. Measured on the old rule, a jump-smash connected
   * with the ball drawn 0.911m from the player - nearly twice the 0.5m at
   * which the circles meet.
   *
   * The freshly-hit guard stays: a ball the player just launched starts out
   * inside their own hitbox, and without it every shot would immediately
   * re-trigger a catch on the very next frame.
   */
  private hitboxesTouch(ball: Ball): boolean {
    const dx = ball.pos.x - this.pos.x;
    const dy = ball.pos.y - this.pos.y;
    const dh = ball.height - this.height;
    return Math.hypot(dx, dy, dh) <= TOUCH_DISTANCE;
  }

  private ballReachable(ball: Ball): boolean {
    if (ball.state !== 'flying' || ball.lastToucher === 'player') return false;
    return this.hitboxesTouch(ball);
  }

  /** Keeps the "when did the hitboxes actually meet?" timestamp current, for
   * the contact log. Called both at the top of the frame and again right
   * before a contact fires, because the assist walk can create the touch
   * within the very frame that plays it. Only ever sets the timestamp when it
   * is unset, so the two calls cannot disagree. */
  private noteTouchState(ball: Ball): void {
    if (this.ballReachable(ball)) {
      if (this.touchStartedAtMs === null) this.touchStartedAtMs = this.clockMs;
    } else {
      this.touchStartedAtMs = null;
    }
  }

  /** Whether the player currently has the block wall up. Read by TeammateAI
   * (so the two never both block the same attack and leave the court empty
   * behind them) and by the renderer. */
  get isBlocking(): boolean {
    return this.state === 'blocking';
  }

  /** How far the player is from the net right now. */
  private get netDistance(): number {
    return Math.max(0, this.pos.y - NET_Y);
  }

  /** Block button. Throws the wall up right where the player stands - it moves
   * them nowhere, dashes nowhere, and costs no recovery pause afterwards. It
   * always plays, from anywhere, so the button is never dead; whether it can
   * actually intercept anything is decided per frame by how close to the net
   * the player happens to be standing (see canBlockNow). Any Pass /
   * Notfall-Schlag still sitting in the input buffer is dropped: the player
   * asked for a block, and a block is not a reception. */
  private startBlock(): void {
    this.state = 'blocking';
    this.stateTimer = 0;
    this.height = 0;
    this.aimPreview = null;
    this.clearPendingInputs();
  }

  /** The wall is up. The player is immobile for its whole (short) duration and
   * no other action is reachable from this state - that is what keeps the
   * block cleanly separate from Pass, Jump-Smash and Notfall-Schlag. */
  private updateBlocking(dt: number, ball: Ball): void {
    this.stateTimer += dt;
    this.height = blockHeightAt(this.stateTimer);

    if (this.canBlockNow(ball)) {
      this.rebound(ball);
      return;
    }

    if (this.stateTimer >= BLOCK_DURATION) this.endBlock();
  }

  /** A block only intercepts while the player is genuinely at the net - the
   * one thing the move asks of them positionally. Everything else about what
   * the wall covers lives in ballIsBlockable, shared with the AI teammate. */
  private canBlockNow(ball: Ball): boolean {
    return this.netDistance <= BLOCK_NET_DISTANCE && ballIsBlockable(ball, this.pos);
  }

  /** The blocked ball: straight back down onto the attacker's own side, fast
   * and steep. Deliberately unlike every reception in the game, which lifts
   * the ball to a teammate or lobs it across the court. */
  private rebound(ball: Ball): void {
    this.logContact('block', ball);
    ball.launch({ ...ball.pos }, blockReboundTarget(ball), {
      duration: BLOCK_RETURN_DURATION,
      peakHeight: BLOCK_RETURN_PEAK_HEIGHT,
      toucher: 'player',
    });
    this.endBlock();
  }

  private endBlock(): void {
    this.height = 0;
    this.state = 'active';
    this.stateTimer = 0;
  }

  /** Fires whatever a Pass/Notfall-Schlag contact resolves to: a
   * Notfall-Schlag if that was explicitly buffered, or if this touch must
   * legally cross the net (mandatory final team touch); a controlled pass to
   * the teammate otherwise. */
  private resolveContact(ball: Ball, teammatePos: Vec2, mustCrossNet: boolean): void {
    const fired = this.hitBuffered || mustCrossNet ? 'notfall-schlag' : 'pass';
    this.logContact(fired, ball);
    if (fired === 'notfall-schlag') {
      this.fireHit(ball);
    } else {
      this.firePass(ball, teammatePos);
    }
    this.clearPendingInputs();
  }

  /** Diagnostic trail for the Sprung-Schmetterschlag, from the press through
   * to the strike. One line per decision point, so a smash that does not come
   * off can be read off the console instead of guessed at:
   *
   *   trigger   the jump (or the second Q) was recognised, with a timestamp
   *   state     the player state the attempt was made in
   *   touching  whether the hitboxes overlap right now, with the live gap
   *   aim       the aim direction and strength the swipe is currently giving
   *   outcome   what actually happened to the ball
   */
  private logSpike(stage: string, ball: Ball, extra: Record<string, unknown> = {}): void {
    const gap = Math.hypot(
      ball.pos.x - this.pos.x,
      ball.pos.y - this.pos.y,
      ball.height - this.height,
    );
    console.log(
      `[Spike] ${stage} | t=${this.clockMs.toFixed(1)}ms state=${this.state} ` +
        `touching=${gap <= TOUCH_DISTANCE} gap=${gap.toFixed(3)}m (touch at ${TOUCH_DISTANCE.toFixed(2)}m) ` +
        `ballH=${ball.height.toFixed(3)} playerH=${this.height.toFixed(3)} ` +
        `aim=(${this.aimDir.x.toFixed(2)},${this.aimDir.y.toFixed(2)})x${this.aimStrength.toFixed(2)} ` +
        `ballState=${ball.state} lastToucher=${ball.lastToucher}` +
        Object.entries(extra)
          .map(([k, v]) => ` ${k}=${v}`)
          .join(''),
    );
  }

  /** Required debug trail for the "contact fires before the ball actually
   * touches the player" bug. Logged at the exact moment a contact fires -
   * never on a rejected attempt, which leaves the ball flying on silently.
   *
   * The four values the bug is judged by:
   *   pressAtMs    when the button/key was pressed
   *   touchAtMs    when the two hitboxes actually met
   *   contactAtMs  when the contact was executed
   *   pressToContactMs   contactAtMs - pressAtMs
   *
   * Read it like this: contactAtMs must NEVER be less than touchAtMs. Press
   * early and contactAtMs equals touchAtMs (the press waited for the ball);
   * press on the touch itself and all three coincide. Timestamps are on the
   * simulation clock (ms since this Player was constructed), so they are
   * reproducible rather than wall-clock noise; wallMs carries performance.now()
   * alongside for anyone reading the live console.
   *
   * gapAtContact is the distance between the two circles as drawn, and
   * touchesAt is where they meet - the geometric half of the same claim. */
  private logContact(action: string, ball: Ball): void {
    const gap = Math.hypot(
      ball.pos.x - this.pos.x,
      ball.pos.y - this.pos.y,
      ball.height - this.height,
    );
    const ms = (v: number | null) => (v === null ? 'n/a' : `${v.toFixed(1)}ms`);
    // Emitted as one flat line first, because console object arguments get
    // abbreviated by devtools and by automated console capture alike - the
    // four values this bug is judged by have to survive that. The object
    // follows for interactive inspection.
    console.log(
      `[BallContact] player ${action} | press=${ms(this.pressAtMs)} touch=${ms(this.touchStartedAtMs)} ` +
        `contact=${ms(this.clockMs)} pressToContact=${
          this.pressAtMs === null ? 'n/a' : `${(this.clockMs - this.pressAtMs).toFixed(1)}ms`
        } gap=${gap.toFixed(3)}m (touch at ${TOUCH_DISTANCE.toFixed(3)}m)`,
      {
      pressedButton: this.pressAction,
      pressAtMs: this.pressAtMs === null ? null : Number(this.pressAtMs.toFixed(1)),
      touchAtMs: this.touchStartedAtMs === null ? null : Number(this.touchStartedAtMs.toFixed(1)),
      contactAtMs: Number(this.clockMs.toFixed(1)),
      pressToContactMs:
        this.pressAtMs === null ? null : Number((this.clockMs - this.pressAtMs).toFixed(1)),
      contactBeforeTouchMs:
        this.touchStartedAtMs === null ? null : Number((this.touchStartedAtMs - this.clockMs).toFixed(1)),
      gapAtContact: Number(gap.toFixed(3)),
      touchesAt: TOUCH_DISTANCE,
      groundDistance: Number(distance(this.pos, ball.pos).toFixed(3)),
      ballHeight: Number(ball.height.toFixed(3)),
      playerHeight: Number(this.height.toFixed(3)),
      wallMs: Number(performance.now().toFixed(1)),
      },
    );
  }

  private clearPendingInputs(): void {
    this.passBuffered = false;
    this.hitBuffered = false;
    this.pressAtMs = null;
    this.pressAction = null;
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

    // The jump press IS the press for a Schmetterschlag: contact happens when
    // the ball meets the player in the air, so this is the timestamp the
    // contact log has to measure that against.
    this.pressAtMs = this.clockMs;
    this.pressAction = 'schmetterschlag (Sprung)';
    this.logSpike('trigger:jump', ball, { assistTarget: `${target.x.toFixed(2)},${target.y.toFixed(2)}` });

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
      this.enterSlowmoAim(ball);
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

  private enterSlowmoAim(ball: Ball): void {
    this.state = 'slowmo_aim';
    this.stateTimer = 0;
    this.logSpike('contact:aim-window-opens', ball);
    // The contact is made HERE - this is the frame the hitboxes met. Remember
    // where the ball was, so resolveSpike can tell "still the same ball, still
    // essentially here" from "that ball is long gone" (see
    // SLOWMO_CONTACT_TOLERANCE).
    this.spikeContactAt = { x: ball.pos.x, y: ball.pos.y, h: ball.height };
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
    // stopped. The contact itself was already made when the window opened, so
    // what is re-checked here is not a fresh touch but whether this is still
    // the same ball in essentially the same place: a fast shot can cover well
    // over a metre even at slow-motion speed, and that ball is genuinely gone
    // - let it fly on untouched rather than striking at thin air.
    if (!this.spikeStillOnTheBall(ball)) {
      this.logSpike('outcome:ABANDONED (ball gone)', ball, {
        contactWasAt: this.spikeContactAt
          ? `${this.spikeContactAt.x.toFixed(2)},${this.spikeContactAt.y.toFixed(2)}`
          : 'n/a',
      });
      this.serving = false;
      this.spikeContactAt = null;
      this.fallStartHeight = this.height;
      this.state = 'jumping_down';
      this.stateTimer = 0;
      return;
    }

    this.logSpike('outcome:STRUCK', ball);
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
    this.pressAtMs = null;
    this.pressAction = null;
    this.spikeContactAt = null;
    this.fallStartHeight = this.height;
    this.state = 'jumping_down';
    this.stateTimer = 0;
  }

  /** Whether the ball the aim window opened on is still there to be struck:
   * still flying, still not ours, and still within SLOWMO_CONTACT_TOLERANCE of
   * where it was at the moment of contact. Falls back to a strict touch if no
   * contact point was recorded (the on-demand spike path, which fires the
   * instant the hitboxes meet and has no window to drift across). */
  private spikeStillOnTheBall(ball: Ball): boolean {
    if (ball.lastToucher === 'player') return false;
    // With no recorded contact point this is the on-demand spike, which fires
    // the instant the hitboxes meet and has no window to drift across: a
    // strict, live touch is exactly right there, and it needs a live ball.
    if (this.spikeContactAt === null) return ball.state === 'flying' && this.hitboxesTouch(ball);
    // Otherwise the contact was already made when the window opened. A flight
    // that happens to complete during the window does not un-make it - the
    // ball was struck in the air, and only how far it has since travelled
    // decides whether it is still there to hit.
    const dx = ball.pos.x - this.spikeContactAt.x;
    const dy = ball.pos.y - this.spikeContactAt.y;
    const dh = ball.height - this.spikeContactAt.h;
    return Math.hypot(dx, dy, dh) <= SLOWMO_CONTACT_TOLERANCE;
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
    if (!input.spike) return false;
    if (!this.ballReachable(ball)) {
      this.logSpike('trigger:hit-rejected (ball not touching)', ball);
      return false;
    }
    this.pressAtMs = this.clockMs;
    this.pressAction = 'schmetterschlag';
    this.noteTouchState(ball);
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
      this.enterSlowmoAim(ball);
      return;
    }

    this.stateTimer += dt;
    const u = clamp(this.stateTimer / JUMP_FALL_DURATION, 0, 1);
    this.height = this.fallStartHeight * (1 - u);
    if (u >= 1) {
      this.height = 0;
      this.state = 'active';
      this.stateTimer = 0;
      if (this.pressAction === 'schmetterschlag (Sprung)') {
        this.logSpike('outcome:LANDED EMPTY (never touched the ball)', ball);
      }
      // Safety net for a serve jump that never got near the tossed ball at
      // all (so resolveSpike never ran): the attempt is over, hand the UI
      // back. Without this the serve buttons would stay up forever.
      this.serving = false;
      // The jump is over; its press must not be reported against some later
      // contact.
      if (this.pressAction !== 'pass' && this.pressAction !== 'notfall-schlag') {
        this.pressAtMs = null;
        this.pressAction = null;
      }
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
