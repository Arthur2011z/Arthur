import { Vec2, clamp, distance, lerpVec2, normalize } from '../utils/math';
import { random } from '../utils/random';
import {
  ASSIST_RANGE,
  BACK_ZONE_CENTER_Y,
  BLOCK_DURATION,
  BLOCK_RETURN_DURATION,
  BLOCK_RETURN_PEAK_HEIGHT,
  CATCHABLE_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  EMERGENCY_DURATION_THRESHOLD,
  HIT_RANGE,
  NET_Y,
  OPPONENT_HARD_BALL_DURATION,
  TEAMMATE_BLOCK_APPROACH_SPEED,
  TEAMMATE_BLOCK_LEAD_DISTANCE,
  TEAMMATE_BLOCK_READY_DISTANCE,
  TEAMMATE_BLOCK_STANCE_Y,
  NET_ZONE_CENTER_Y,
  PLAYER_RADIUS,
  PLAYER_START_POS,
  TEAMMATE_EMERGENCY_SET_DURATION,
  TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
  TEAMMATE_HOME_X,
  TEAMMATE_REACT_RADIUS,
  TEAMMATE_RETURN_EPSILON,
  TEAMMATE_SET_DURATION,
  SET_NET_APPROACH_Y,
  SET_NET_BLEND,
  ATTACK_TARGET_MARGIN,
  TEAMMATE_ATTACK_HIT_DURATION,
  TEAMMATE_ATTACK_HIT_PEAK_HEIGHT,
  TEAMMATE_SPIKE_CHANCE,
  TEAMMATE_SPIKE_MAX_NET_DISTANCE,
  TEAMMATE_SPIKE_MIN_HEIGHT,
  TEAMMATE_SET_PEAK_HEIGHT,
  TEAMMATE_SPEED,
  TEAMMATE_YIELD_MARGIN,
  RANDOM_TARGET_MARGIN,
  ZONE_SPLIT_Y,
} from '../game/constants';
import { Ball } from './Ball';
import { ballIsBlockable, blockHeightAt, blockReboundTarget } from '../game/block';
import { spikeShot } from '../game/spikePower';
import type { PlayerState } from './Player';

type TeammateState = 'home' | 'moving_to_ball' | 'returning' | 'to_net' | 'blocking';

/** The bits of live player state TeammateAI needs to decide ball-contact
 * priority (see playerHasPriority) and whether to go and block - deliberately
 * narrower than a full Player reference. */
export interface PlayerInfo {
  pos: Vec2;
  state: PlayerState;
  hasPendingContactInput: boolean;
  /** Whether the player is mid-serve-routine (see Player.isServing). */
  isServing?: boolean;
  /** Whether the player already has the block wall up (see Player.isBlocking).
   * If they do, the teammate does not block too - one blocker, one defender,
   * or the whole court behind the net is empty. */
  isBlocking?: boolean;
}

/** Whether the human player - not the AI teammate - should be the one to
 * play this ball right now. Prevents the teammate from racing in and taking
 * a ball the player is already actively handling or is clearly better
 * placed for:
 *
 * A ball the player has just played is excluded outright: they physically
 * cannot touch it again (see Player.ballReachable's own lastToucher guard), so
 * granting them priority over it would only stall the teammate - which matters
 * now that a Pass is deliberately aimed away from the teammate, toward the net.
 *
 * - Pass/Notfall-Schlag pressed (or still buffered) AND the player is
 *   already within their own ASSIST_RANGE homing distance of the ball - so
 *   about to close the gap and resolve it themselves.
 * - otherwise, only if the player is closer to the ball's live position by a
 *   clear margin (TEAMMATE_YIELD_MARGIN). The two rules above are *active*
 *   claims and win outright at any distance; this last one is mere proximity,
 *   which on its own says nothing about whether the player actually intends to
 *   play the ball - so a near-tie deliberately goes to the teammate, who
 *   definitely will, rather than leaving the ball to drop between them.
 */
function playerHasPriority(ball: Ball, player: PlayerInfo, teammatePos: Vec2): boolean {
  if (ball.state !== 'flying') return false;
  if (ball.lastToucher === 'player') return false;
  // A serve belongs to the server, unconditionally. The toss goes straight up
  // from the baseline and the teammate's back-zone base is well within
  // TEAMMATE_REACT_RADIUS of it, so without this the teammate would sprint in
  // and poach its own partner's serve out of the air.
  if (player.isServing) return true;
  if (player.hasPendingContactInput && distance(player.pos, ball.pos) <= ASSIST_RANGE) return true;
  return distance(player.pos, ball.pos) + TEAMMATE_YIELD_MARGIN < distance(teammatePos, ball.pos);
}

/** Whichever zone (net vs. back) `pos` is currently in, within the human
 * half. Used to figure out which zone the *other* one - the AI teammate's
 * target - should cover. */
function zoneOf(pos: Vec2): 'net' | 'back' {
  return pos.y < ZONE_SPLIT_Y ? 'net' : 'back';
}

/** The AI teammate's current base position: the center of whichever zone
 * `playerPos` is currently *not* in. Re-evaluated every frame - there is no
 * single fixed home, the teammate always covers the gap the player's own
 * position is currently leaving open (e.g. player up at the net -> teammate
 * covers the back; player pulled back -> teammate moves up toward the net). */
function computeZoneHome(playerPos: Vec2): Vec2 {
  const y = zoneOf(playerPos) === 'net' ? BACK_ZONE_CENTER_Y : NET_ZONE_CENTER_Y;
  return { x: TEAMMATE_HOME_X, y };
}

/** Whether this ball is a set-up played to us by the human player: they
 * touched it last and aimed it into our own half. That is what turns the
 * teammate from setter into attacker (see playBall/attack), and what makes it
 * wait at the landing spot rather than running into the ball early. */
function isSetUpForUs(ball: Ball): boolean {
  return ball.lastToucher === 'player' && ball.target.y > NET_Y;
}

/** A ball our own player has already sent over the net is not ours to touch:
 * it is on its way to the opponents, and stepping into its path only throws
 * our own shot away. This is the mirror image of isSetUpForUs - same shot,
 * other side of the net.
 *
 * Measured on the serve, which is where it actually bites: the serve is struck
 * at the baseline and flies the entire length of the court, passing within
 * ~2.05m of the teammate's back-zone base on the way - inside
 * TEAMMATE_REACT_RADIUS. Without this guard the teammate reliably stepped in
 * and dug its own partner's serve, which therefore never reached the
 * opponents at all. */
function ownShotHeadingOver(ball: Ball): boolean {
  return ball.lastToucher === 'player' && ball.target.y <= NET_Y;
}

/** Where to aim an attack: the in-bounds spot furthest from every opponent -
 * i.e. the gap their current formation is leaving open. Sampled over a coarse
 * grid rather than solved exactly; the point is a shot that reads the defence,
 * not an optimal one. With no opponents known, falls back to the middle of the
 * far court. */
function attackTarget(opponentPositions: Vec2[]): Vec2 {
  const xs = [ATTACK_TARGET_MARGIN, COURT_WIDTH / 2, COURT_WIDTH - ATTACK_TARGET_MARGIN];
  const ys = [ATTACK_TARGET_MARGIN, NET_Y / 2, NET_Y - ATTACK_TARGET_MARGIN];
  if (opponentPositions.length === 0) return { x: COURT_WIDTH / 2, y: NET_Y / 2 };

  let best: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y / 2 };
  let bestGap = -Infinity;
  for (const x of xs) {
    for (const y of ys) {
      const candidate = { x, y };
      const gap = Math.min(...opponentPositions.map((o) => distance(o, candidate)));
      if (gap > bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
  }
  return best;
}

/**
 * AI teammate: dynamically covers whichever zone (net/front vs. back) the
 * player currently isn't in (see computeZoneHome) instead of sitting at one
 * fixed spot. Only leaves that base when the ball is actually coming near it
 * or flying toward it; plays it — a quick emergency save if it arrived too
 * fast/direct or this is the team's mandatory final touch, otherwise a high
 * set to the human player — then heads back to base.
 *
 * It also blocks entirely on its own initiative, with nothing pressed. The
 * moment our team sends the ball over the net an attack is being built: the
 * teammate breaks off whatever it was doing, runs to the net on the ball's own
 * column ('to_net'), and throws the wall up the instant a hard ball is struck
 * back at us ('blocking'). A lob it deliberately does not block - it stands
 * down and digs it instead. That is what frees the human player to drop back
 * into the defence behind the block rather than covering the net themselves.
 */
export class TeammateAI {
  pos: Vec2;
  radius = PLAYER_RADIUS;
  state: TeammateState = 'home';
  /** Visual-only lift while blocking, mirroring Player.height. */
  height = 0;

  /** The currently-targeted base position (see computeZoneHome) - recomputed
   * every update() from the live player position. */
  private targetHome: Vec2;
  private blockTimer = 0;

  constructor() {
    this.targetHome = computeZoneHome(PLAYER_START_POS);
    this.pos = { ...this.targetHome };
  }

  /** The teammate's current base position (read by the renderer/tests; also
   * where updateReturning heads back to). */
  get homePos(): Vec2 {
    return this.targetHome;
  }

  update(
    dt: number,
    ball: Ball,
    player: PlayerInfo,
    mustCrossNet: boolean,
    opponentPositions: Vec2[] = [],
  ): void {
    this.targetHome = computeZoneHome(player.pos);

    switch (this.state) {
      case 'blocking':
        this.updateBlocking(dt, ball);
        break;
      case 'to_net':
        this.updateToNet(dt, ball, player);
        break;
      case 'home':
        // Going to block outranks everything else: the window for getting to
        // the net closes long before the attack is struck, so this decision
        // cannot wait for the ball to actually come at us.
        if (this.shouldPrepareBlock(ball, player)) {
          this.state = 'to_net';
        } else if (this.shouldReact(ball, player)) {
          this.state = 'moving_to_ball';
        } else {
          // Situational positioning, not a static spot: keep drifting toward
          // the current base as the player moves between zones.
          this.driftToward(dt, this.targetHome);
        }
        break;
      case 'moving_to_ball':
        this.updateMovingToBall(dt, ball, player, mustCrossNet, opponentPositions);
        break;
      case 'returning':
        // React straight out of 'returning' as well, not only once home has
        // been reached. The teammate now passes through this state after every
        // block and every stood-down block approach, and a ball arriving
        // during the walk back would otherwise simply drop.
        if (this.shouldPrepareBlock(ball, player)) this.state = 'to_net';
        else if (this.shouldReact(ball, player)) this.state = 'moving_to_ball';
        else this.updateReturning(dt);
        break;
    }
  }

  /** Whether the teammate currently has the block wall up - read by the
   * renderer and by tests. */
  get isBlocking(): boolean {
    return this.state === 'blocking';
  }

  /** An attack is being built against us: our team has put the ball over and
   * it is on its way to an opponent, who will play it straight back. That is
   * the only warning there ever is - the opponents strike the instant they
   * reach the ball - so the run to the net has to start here, well before
   * anything is coming at us.
   *
   * Never while the human player is already blocking: two blockers at the net
   * leave nobody at all in the court behind them. */
  private shouldPrepareBlock(ball: Ball, player: PlayerInfo): boolean {
    if (player.isBlocking) return false;
    if (ball.state !== 'flying') return false;
    if (ball.lastToucher === 'opponent1' || ball.lastToucher === 'opponent2') return false;
    return ball.target.y <= NET_Y;
  }

  /** On the way to the net, shading onto the ball's own column - the line the
   * attack will most likely come down. Run at scramble pace: arriving late is
   * the same as not going at all. */
  private updateToNet(dt: number, ball: Ball, player: PlayerInfo): void {
    if (player.isBlocking || ball.state !== 'flying') {
      this.state = 'returning';
      return;
    }

    const struck = ball.lastToucher === 'opponent1' || ball.lastToucher === 'opponent2';
    if (!struck && ball.target.y > NET_Y) {
      // The ball is no longer on its way over: one of us touched it again and
      // it is coming back into our own half, so there is no attack to block
      // after all. Stand down, or the teammate camps at the net while the ball
      // it should be playing drops behind it.
      this.state = 'returning';
      return;
    }

    if (struck) {
      // The attack has been played. A hard ball is blocked; anything slower is
      // a lob that would sail over the block anyway, so stand down and dig it.
      const blockable = ball.target.y > NET_Y && ball.duration <= OPPONENT_HARD_BALL_DURATION;
      if (!blockable) {
        this.state = 'returning';
        return;
      }

      // Not up yet: keep sliding along with the ball's live column. The attack
      // travels diagonally, so the hitter's column and the column the ball
      // actually comes through the net on are two different places - jumping on
      // the former is jumping next to the ball. Measured: an attack from x=5
      // toward x=2.6 crosses the net around x=3.8, i.e. 1.2m away, just outside
      // the block's own BLOCK_HALF_WIDTH of 1.1.
      if (NET_Y - ball.pos.y > TEAMMATE_BLOCK_LEAD_DISTANCE) {
        this.driftToward(dt, this.blockStance(ball), TEAMMATE_BLOCK_APPROACH_SPEED);
        return;
      }

      // Committing point: up now, or not at all.
      if (distance(this.pos, this.blockStance(ball)) <= TEAMMATE_BLOCK_READY_DISTANCE) {
        this.state = 'blocking';
        this.blockTimer = 0;
        this.height = 0;
      } else {
        this.state = 'returning';
      }
      return;
    }

    this.driftToward(dt, this.blockStance(ball), TEAMMATE_BLOCK_APPROACH_SPEED);
  }

  /** Where to stand to block this ball: right off the net, in its column. */
  private blockStance(ball: Ball): Vec2 {
    return {
      x: clamp(ball.pos.x, this.radius, COURT_WIDTH - this.radius),
      y: TEAMMATE_BLOCK_STANCE_Y,
    };
  }

  /** The wall is up. Same shared zone/rebound/animation definitions the human
   * player's block uses, so the two can never behave differently. */
  private updateBlocking(dt: number, ball: Ball): void {
    this.blockTimer += dt;
    this.height = blockHeightAt(this.blockTimer);

    if (ballIsBlockable(ball, this.pos)) {
      console.log('[BallContact] teammate block', {
        distance: Number(Math.abs(ball.pos.x - this.pos.x).toFixed(3)),
        height: Number(ball.height.toFixed(3)),
        hitRange: HIT_RANGE,
        catchableHeight: CATCHABLE_HEIGHT,
        conditionA_distanceOk: true,
        conditionB_heightOk: true,
        conditionC_inputActive: true, // AI has no button - the block itself is the commitment
      });
      ball.launch({ ...ball.pos }, blockReboundTarget(ball), {
        duration: BLOCK_RETURN_DURATION,
        peakHeight: BLOCK_RETURN_PEAK_HEIGHT,
        toucher: 'teammate',
      });
      this.endBlock();
      return;
    }

    if (this.blockTimer >= BLOCK_DURATION) this.endBlock();
  }

  private endBlock(): void {
    this.height = 0;
    this.blockTimer = 0;
    this.state = 'returning';
  }

  /** Excludes the very ball the teammate itself just launched: playBall()
   * transitions synchronously to 'returning', but if the teammate was
   * already standing right at (or very near) its target base when it made
   * contact, updateReturning() can snap it straight back to 'home' within a
   * frame or two - at which point the ball it JUST hit is still live right
   * next to it (well inside TEAMMATE_REACT_RADIUS), so shouldReact() would
   * otherwise immediately fire again and send it straight back into
   * 'moving_to_ball' to re-catch its own shot. Without this guard that's a
   * real, observed double-touch within a single rally exchange - not two
   * separate, legitimate touches later in the rally.
   *
   * Also defers entirely when the player has priority (see
   * playerHasPriority) - the teammate should never race the human player for
   * a ball the human is already actively handling or is clearly better
   * placed for. */
  private shouldReact(ball: Ball, player: PlayerInfo): boolean {
    if (ball.state !== 'flying' || ball.lastToucher === 'teammate') return false;
    if (ownShotHeadingOver(ball)) return false;
    if (playerHasPriority(ball, player, this.pos)) return false;
    // A ball the player just played into our own half is a pass to us, by
    // definition - go for it regardless of the reaction radius. That radius is
    // measured against the teammate's position, and a Pass is now aimed at the
    // net rather than at the teammate, so it can easily land outside it.
    if (isSetUpForUs(ball)) return true;
    return (
      distance(ball.pos, this.pos) <= TEAMMATE_REACT_RADIUS ||
      distance(ball.target, this.pos) <= TEAMMATE_REACT_RADIUS
    );
  }

  private updateMovingToBall(
    dt: number,
    ball: Ball,
    player: PlayerInfo,
    mustCrossNet: boolean,
    opponentPositions: Vec2[],
  ): void {
    if (ball.state !== 'flying') {
      // The ball landed, or was already handled elsewhere - stand down.
      this.state = 'returning';
      return;
    }

    // The player may only have taken priority *after* the teammate was
    // already committed to 'moving_to_ball' (e.g. they pressed Pass while
    // standing on it) - re-check every frame, not just on entry, and back off
    // immediately rather than continuing to close in on (or catch) a ball
    // the player is now actively handling. 'returning' re-positions toward
    // the current zone home, which already leans toward the net when the
    // player is covering the back - exactly the "get ready for the next
    // contact" behavior asked for.
    if (playerHasPriority(ball, player, this.pos) || ownShotHeadingOver(ball)) {
      this.state = 'returning';
      return;
    }

    // Both the ground-plane distance AND the ball's current height must be
    // in range in the same frame - being under a ball still meters overhead
    // is not a catch (see CATCHABLE_HEIGHT). lastToucher guards against
    // re-catching the very shot just fired (see shouldReact's doc comment) -
    // kept here too, defensively, in case this state was ever entered by some
    // other path.
    const toBall = distance(this.pos, ball.pos);
    const distanceOk = toBall <= HIT_RANGE;
    const heightOk = ball.height <= CATCHABLE_HEIGHT;
    const notOwnShot = ball.lastToucher !== 'teammate';
    if (distanceOk && heightOk && notOwnShot) {
      console.log('[BallContact] teammate zuspiel', {
        distance: Number(toBall.toFixed(3)),
        height: Number(ball.height.toFixed(3)),
        hitRange: HIT_RANGE,
        catchableHeight: CATCHABLE_HEIGHT,
        conditionA_distanceOk: distanceOk,
        conditionB_heightOk: heightOk,
        conditionC_inputActive: true, // AI has no button - "active" once shouldReact() committed it to moving_to_ball
      });
      this.playBall(ball, player.pos, mustCrossNet, opponentPositions);
      this.state = 'returning';
      return;
    }

    // For a set-up from the player, head for where the pass is going to land
    // and let it come. Chasing the ball's live position instead means running
    // INTO the incoming pass and hitting it early, deep in our own half - which
    // throws away the whole point of a pass aimed at the net. Every other ball
    // is still chased live, which is what lets the teammate dig balls that
    // merely pass nearby.
    const destination = isSetUpForUs(ball) ? ball.target : ball.pos;
    const dir = normalize({ x: destination.x - this.pos.x, y: destination.y - this.pos.y });
    this.pos.x += dir.x * TEAMMATE_SPEED * dt;
    this.pos.y += dir.y * TEAMMATE_SPEED * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Decides and plays the teammate's shot. Three outcomes, in order:
   *
   * 1. The ball arrived too fast to do anything constructive with -> a quick
   *    emergency save over the net, just to keep it alive.
   * 2. It was set up for an attack (the player passed it to us near the net),
   *    or this is the team's mandatory final touch -> attack (see
   *    chooseAttack). This is the role swap: the player sets, the AI hits.
   * 3. Otherwise -> the usual high set to the player, so they can attack.
   */
  private playBall(ball: Ball, playerPos: Vec2, mustCrossNet: boolean, opponentPositions: Vec2[]): void {
    // Launch from the ball's own live position, not this.pos: contact is
    // allowed within HIT_RANGE (not exact overlap), so using the catcher's
    // position here would snap the ball sideways/vertically at the moment of
    // contact instead of continuing smoothly from where it actually is.
    const from = { ...ball.pos };

    // Judged by the incoming flight's own total duration - fixed per shot
    // type, independent of how far into the flight contact happened.
    if (ball.duration < EMERGENCY_DURATION_THRESHOLD) {
      const target: Vec2 = {
        x: RANDOM_TARGET_MARGIN + random() * (COURT_WIDTH - 2 * RANDOM_TARGET_MARGIN),
        y: RANDOM_TARGET_MARGIN + random() * (NET_Y - 2 * RANDOM_TARGET_MARGIN),
      };
      ball.launch(from, target, {
        duration: TEAMMATE_EMERGENCY_SET_DURATION,
        peakHeight: TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
        toucher: 'teammate',
      });
      return;
    }

    // A ball the player played into our own half is a pass to us - they have
    // set us up, so we attack rather than setting straight back. A mandatory
    // final touch has to cross the net anyway, so it is played as an attack
    // too rather than as a thrown-away safe lob.
    const setUpForAttack = isSetUpForUs(ball);
    if (setUpForAttack || mustCrossNet) {
      this.attack(ball, from, opponentPositions);
      return;
    }

    // Blend the player's own current position with a point near the own
    // net area (same x, so this never asks for lateral movement - only
    // how far forward/back the set lands) - see SET_NET_BLEND's
    // doc comment for why a set can't just land squarely on top of
    // wherever the player happens to be standing.
    const nearNet: Vec2 = { x: playerPos.x, y: SET_NET_APPROACH_Y };
    ball.launch(from, lerpVec2(playerPos, nearNet, SET_NET_BLEND), {
      duration: TEAMMATE_SET_DURATION,
      peakHeight: TEAMMATE_SET_PEAK_HEIGHT,
      toucher: 'teammate',
    });
  }

  /** The teammate's own attack over the net. Whether it spikes or plays the
   * safer attacking hit depends on whether it is actually in a position to
   * spike - close enough to the net, with the ball high enough to strike
   * downward - and then on a roll, so the same situation does not always
   * produce the same shot. Either way it aims at the gap in the opponents'
   * defence rather than at a random spot. */
  private attack(ball: Ball, from: Vec2, opponentPositions: Vec2[]): void {
    const netDistance = Math.max(0, this.pos.y - NET_Y);
    const canSpike =
      netDistance <= TEAMMATE_SPIKE_MAX_NET_DISTANCE && ball.height >= TEAMMATE_SPIKE_MIN_HEIGHT;
    const target = attackTarget(opponentPositions);

    if (canSpike && random() < TEAMMATE_SPIKE_CHANCE) {
      // Same distance-based power rule the human player's spike uses: struck
      // at the net it is hard and flat, from deeper it is slower and loopier.
      const shot = spikeShot(netDistance);
      ball.launch(from, target, {
        duration: shot.duration,
        peakHeight: shot.peakHeight,
        toucher: 'teammate',
      });
      return;
    }

    ball.launch(from, target, {
      duration: TEAMMATE_ATTACK_HIT_DURATION,
      peakHeight: TEAMMATE_ATTACK_HIT_PEAK_HEIGHT,
      toucher: 'teammate',
    });
  }

  private updateReturning(dt: number): void {
    const toHome = distance(this.pos, this.targetHome);
    if (toHome <= TEAMMATE_RETURN_EPSILON) {
      this.pos = { ...this.targetHome };
      this.state = 'home';
      return;
    }
    this.driftToward(dt, this.targetHome);
  }

  private driftToward(dt: number, target: Vec2, speed: number = TEAMMATE_SPEED): void {
    const toTarget = distance(this.pos, target);
    if (toTarget <= TEAMMATE_RETURN_EPSILON) {
      this.pos = { ...target };
      return;
    }
    const dir = normalize({ x: target.x - this.pos.x, y: target.y - this.pos.y });
    this.pos.x += dir.x * speed * dt;
    this.pos.y += dir.y * speed * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Never cross the net: stays within the human team's half, same bounds as
   * the human player. */
  private clampToOwnHalf(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.radius, COURT_WIDTH - this.radius),
      y: clamp(p.y, NET_Y + this.radius, COURT_LENGTH - this.radius),
    };
  }
}
