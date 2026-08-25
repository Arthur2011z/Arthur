import { Vec2, clamp, distance, normalize } from '../utils/math';
import { random } from '../utils/random';
import {
  CATCHABLE_HEIGHT,
  COURT_WIDTH,
  HIT_RANGE,
  NET_Y,
  OPPONENT_ATTACK_CHANCE,
  OPPONENT_ATTACK_DURATION,
  OPPONENT_ATTACK_PEAK_HEIGHT,
  OPPONENT_ATTACK_TARGET_MARGIN,
  OPPONENT_BACK_ZONE_CENTER_Y,
  OPPONENT_BACK_ZONE_X,
  OPPONENT_ERROR_CHANCE,
  OPPONENT_FAULT_DURATION,
  OPPONENT_FAULT_OWN_SIDE_MARGIN,
  OPPONENT_FAULT_PEAK_HEIGHT,
  OPPONENT_NET_ZONE_CENTER_Y,
  OPPONENT_NET_ZONE_X,
  OPPONENT_RETURN_DURATION,
  OPPONENT_RETURN_EPSILON,
  OPPONENT_RETURN_PEAK_HEIGHT,
  OPPONENT_SPEED,
  OPPONENT_ZONE_OVERRIDE_MARGIN,
  OPPONENT_ZONE_SPLIT_Y,
  PLAYER_RADIUS,
  SERVE_MARGIN,
} from '../game/constants';
import { Ball, BallToucher } from './Ball';

type OpponentState = 'home' | 'moving_to_ball' | 'returning';

/** Which half-depth of the opponent court a point falls in. The opponent
 * half runs from the baseline (y = 0) up to the net (y = NET_Y), so the
 * *net* zone is the one with the larger y. */
export type OpponentZone = 'net' | 'back';

export function opponentZoneOf(pos: Vec2): OpponentZone {
  return pos.y >= OPPONENT_ZONE_SPLIT_Y ? 'net' : 'back';
}

/** The centre of `zone` - where the opponent covering it holds position when
 * it isn't actively playing the ball. */
export function opponentZoneHome(zone: OpponentZone): Vec2 {
  return zone === 'net'
    ? { x: OPPONENT_NET_ZONE_X, y: OPPONENT_NET_ZONE_CENTER_Y }
    : { x: OPPONENT_BACK_ZONE_X, y: OPPONENT_BACK_ZONE_CENTER_Y };
}

/**
 * Decides which of the two opponents is responsible for the ball currently in
 * flight, or null if it isn't theirs to play at all. Zone ownership is the
 * rule: whoever covers the zone the ball is landing in takes it, which is what
 * keeps their movement legible - a deep ball is the back defender's, a ball at
 * the net is the net defender's, every time.
 *
 * The one exception is the sanity valve: if the other opponent is closer to
 * the landing spot by more than OPPONENT_ZONE_OVERRIDE_MARGIN, it takes over.
 * That covers a ball landing just barely across the zone line with the wrong
 * defender standing right on top of it - insisting on strict ownership there
 * would produce exactly the kind of illogical cross-court run the zones exist
 * to remove.
 */
export function chooseResponsibleOpponent(ball: Ball, opponents: OpponentAI[]): OpponentAI | null {
  if (ball.state !== 'flying' || ball.target.y > NET_Y) return null;

  const targetZone = opponentZoneOf(ball.target);
  const owner = opponents.find((o) => o.zone === targetZone);
  if (!owner) return opponents[0] ?? null;

  const other = opponents.find((o) => o !== owner);
  if (!other) return owner;

  const ownerDist = distance(owner.pos, ball.target);
  const otherDist = distance(other.pos, ball.target);
  return otherDist + OPPONENT_ZONE_OVERRIDE_MARGIN < ownerDist ? other : owner;
}

/**
 * Opponent AI: holds the centre of its own zone (net or back - see
 * OpponentZone), moves to the ball when it is the one responsible for it (see
 * chooseResponsibleOpponent, decided in GameState and passed in as `isLead`),
 * plays it, then returns to that base. Only ever one of the two chases any
 * given ball, so they never both pile onto the same one.
 *
 * The zone split is what makes the movement legible: each opponent's resting
 * position and the balls it goes for both follow from the zone it covers,
 * rather than from whichever of the two happened to be marginally nearer the
 * landing spot on that particular ball.
 *
 * Deliberately beatable rather than a wall: most touches are a safe, generous
 * return (see OPPONENT_RETURN_*), but a fraction are an aggressive attack
 * (OPPONENT_ATTACK_CHANCE - faster, flatter, aimed closer to the lines) and a
 * smaller fraction are a mechanical error that nets out on their own side
 * (OPPONENT_ERROR_CHANCE), giving the human team real, earned scoring
 * chances beyond just outrunning the AI's positioning.
 */
export class OpponentAI {
  readonly zone: OpponentZone;
  readonly homePos: Vec2;
  pos: Vec2;
  radius = PLAYER_RADIUS;
  state: OpponentState = 'home';

  constructor(
    zone: OpponentZone,
    private readonly toucherId: Extract<BallToucher, 'opponent1' | 'opponent2'>,
  ) {
    this.zone = zone;
    this.homePos = opponentZoneHome(zone);
    this.pos = { ...this.homePos };
  }

  update(dt: number, ball: Ball, isLead: boolean): void {
    switch (this.state) {
      case 'home':
        if (isLead && ball.state === 'flying' && ball.target.y <= NET_Y) {
          this.state = 'moving_to_ball';
        } else {
          // Hold the zone: creep back to base rather than standing wherever
          // the last rally happened to leave them.
          this.driftToward(dt, this.homePos);
        }
        break;
      case 'moving_to_ball':
        this.updateMovingToBall(dt, ball);
        break;
      case 'returning':
        this.updateReturning(dt);
        break;
    }
  }

  private updateMovingToBall(dt: number, ball: Ball): void {
    if (ball.state !== 'flying') {
      this.state = 'returning';
      return;
    }

    // Both the ground-plane distance AND the ball's current height must be
    // in range in the same frame - being under a ball still meters overhead
    // is not a catch (see CATCHABLE_HEIGHT).
    const toBall = distance(this.pos, ball.pos);
    const distanceOk = toBall <= HIT_RANGE;
    const heightOk = ball.height <= CATCHABLE_HEIGHT;
    if (distanceOk && heightOk) {
      console.log('[BallContact]', this.toucherId, {
        distance: Number(toBall.toFixed(3)),
        height: Number(ball.height.toFixed(3)),
        hitRange: HIT_RANGE,
        catchableHeight: CATCHABLE_HEIGHT,
        conditionA_distanceOk: distanceOk,
        conditionB_heightOk: heightOk,
        conditionC_inputActive: true, // AI has no button - "active" once it committed to moving_to_ball
      });
      this.playBall(ball);
      this.state = 'returning';
      return;
    }

    // Head for where the ball is going to land, not for where it happens to
    // be right now. Chasing the live position means trailing a moving point
    // and converging only at the very end - it reads as running after the
    // ball rather than reading it. Moving to the landing spot and waiting
    // there is both what a real player does and visibly purposeful. The
    // contact check above still runs against the ball's live position every
    // frame, so a ball that comes within reach on the way is still played.
    this.driftToward(dt, ball.target);
  }

  /** Rolls between an error, an aggressive attack, and the safe default
   * return - see the class doc comment for the reasoning. */
  private playBall(ball: Ball): void {
    // Launch from the ball's own live position, not this.pos: contact is
    // allowed within HIT_RANGE (not exact overlap), so using the catcher's
    // position here would snap the ball sideways/vertically at the moment
    // of contact instead of continuing smoothly from where it actually is.
    const from = { ...ball.pos };
    const roll = random();

    if (roll < OPPONENT_ERROR_CHANCE) {
      // Mechanical error: nets out and drops back on their own side.
      const target: Vec2 = {
        x: clamp(ball.pos.x, OPPONENT_FAULT_OWN_SIDE_MARGIN, COURT_WIDTH - OPPONENT_FAULT_OWN_SIDE_MARGIN),
        y: NET_Y - OPPONENT_FAULT_OWN_SIDE_MARGIN,
      };
      ball.launch(from, target, {
        duration: OPPONENT_FAULT_DURATION,
        peakHeight: OPPONENT_FAULT_PEAK_HEIGHT,
        toucher: this.toucherId,
      });
    } else if (roll < OPPONENT_ERROR_CHANCE + OPPONENT_ATTACK_CHANCE) {
      // Aggressive attack: noticeably faster and flatter, aimed closer to
      // the lines than the safe default.
      const target: Vec2 = {
        x: OPPONENT_ATTACK_TARGET_MARGIN + random() * (COURT_WIDTH - 2 * OPPONENT_ATTACK_TARGET_MARGIN),
        y: NET_Y + OPPONENT_ATTACK_TARGET_MARGIN + random() * (NET_Y - 2 * OPPONENT_ATTACK_TARGET_MARGIN),
      };
      ball.launch(from, target, {
        duration: OPPONENT_ATTACK_DURATION,
        peakHeight: OPPONENT_ATTACK_PEAK_HEIGHT,
        toucher: this.toucherId,
      });
    } else {
      // Safe default: generous, easy-to-react-to return.
      const target: Vec2 = {
        x: SERVE_MARGIN + random() * (COURT_WIDTH - 2 * SERVE_MARGIN),
        y: NET_Y + SERVE_MARGIN + random() * (NET_Y - 2 * SERVE_MARGIN),
      };
      ball.launch(from, target, {
        duration: OPPONENT_RETURN_DURATION,
        peakHeight: OPPONENT_RETURN_PEAK_HEIGHT,
        toucher: this.toucherId,
      });
    }
  }

  private updateReturning(dt: number): void {
    if (distance(this.pos, this.homePos) <= OPPONENT_RETURN_EPSILON) {
      this.pos = { ...this.homePos };
      this.state = 'home';
      return;
    }
    this.driftToward(dt, this.homePos);
  }

  /** Smooth, constant-speed movement toward `target`, snapping the last
   * fraction of a metre so it settles instead of creeping in asymptotically. */
  private driftToward(dt: number, target: Vec2): void {
    if (distance(this.pos, target) <= OPPONENT_RETURN_EPSILON) {
      this.pos = { ...target };
      return;
    }
    const dir = normalize({ x: target.x - this.pos.x, y: target.y - this.pos.y });
    this.pos.x += dir.x * OPPONENT_SPEED * dt;
    this.pos.y += dir.y * OPPONENT_SPEED * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  /** Never cross the net: stays within the opponent half. */
  private clampToOwnHalf(p: Vec2): Vec2 {
    return {
      x: clamp(p.x, this.radius, COURT_WIDTH - this.radius),
      y: clamp(p.y, this.radius, NET_Y - this.radius),
    };
  }
}
