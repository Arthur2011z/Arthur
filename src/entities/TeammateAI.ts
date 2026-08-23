import { Vec2, clamp, distance, normalize } from '../utils/math';
import { random } from '../utils/random';
import {
  BACK_ZONE_CENTER_Y,
  COURT_LENGTH,
  COURT_WIDTH,
  EMERGENCY_DURATION_THRESHOLD,
  HIT_RANGE,
  NET_Y,
  NET_ZONE_CENTER_Y,
  PLAYER_RADIUS,
  PLAYER_START_POS,
  TEAMMATE_EMERGENCY_SET_DURATION,
  TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
  TEAMMATE_HOME_X,
  TEAMMATE_REACT_RADIUS,
  TEAMMATE_RETURN_EPSILON,
  TEAMMATE_SET_DURATION,
  TEAMMATE_SET_PEAK_HEIGHT,
  TEAMMATE_SPEED,
  RANDOM_TARGET_MARGIN,
  ZONE_SPLIT_Y,
} from '../game/constants';
import { Ball } from './Ball';

type TeammateState = 'home' | 'moving_to_ball' | 'returning';

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

/**
 * AI teammate: dynamically covers whichever zone (net/front vs. back) the
 * player currently isn't in (see computeZoneHome) instead of sitting at one
 * fixed spot. Only leaves that base when the ball is actually coming near it
 * or flying toward it (which also covers the human player's dive-pass, since
 * that always targets this teammate's position); plays it — a quick
 * emergency save if it arrived too fast/direct or this is the team's
 * mandatory final touch, otherwise a high set to the human player — then
 * heads back to base.
 */
export class TeammateAI {
  pos: Vec2;
  radius = PLAYER_RADIUS;
  state: TeammateState = 'home';

  /** The currently-targeted base position (see computeZoneHome) - recomputed
   * every update() from the live player position. */
  private targetHome: Vec2;

  constructor() {
    this.targetHome = computeZoneHome(PLAYER_START_POS);
    this.pos = { ...this.targetHome };
  }

  /** The teammate's current base position (read by the renderer/tests; also
   * where updateReturning heads back to). */
  get homePos(): Vec2 {
    return this.targetHome;
  }

  update(dt: number, ball: Ball, playerPos: Vec2, mustCrossNet: boolean): void {
    this.targetHome = computeZoneHome(playerPos);

    switch (this.state) {
      case 'home':
        if (this.shouldReact(ball)) {
          this.state = 'moving_to_ball';
        } else {
          // Situational positioning, not a static spot: keep drifting toward
          // the current base as the player moves between zones.
          this.driftToward(dt, this.targetHome);
        }
        break;
      case 'moving_to_ball':
        this.updateMovingToBall(dt, ball, playerPos, mustCrossNet);
        break;
      case 'returning':
        this.updateReturning(dt);
        break;
    }
  }

  private shouldReact(ball: Ball): boolean {
    if (ball.state !== 'flying') return false;
    return (
      distance(ball.pos, this.pos) <= TEAMMATE_REACT_RADIUS ||
      distance(ball.target, this.pos) <= TEAMMATE_REACT_RADIUS
    );
  }

  private updateMovingToBall(dt: number, ball: Ball, playerPos: Vec2, mustCrossNet: boolean): void {
    if (ball.state !== 'flying') {
      // The ball landed, or was already handled elsewhere - stand down.
      this.state = 'returning';
      return;
    }

    const toBall = distance(this.pos, ball.pos);
    if (toBall <= HIT_RANGE) {
      this.playBall(ball, playerPos, mustCrossNet);
      this.state = 'returning';
      return;
    }

    const dir = normalize({ x: ball.pos.x - this.pos.x, y: ball.pos.y - this.pos.y });
    this.pos.x += dir.x * TEAMMATE_SPEED * dt;
    this.pos.y += dir.y * TEAMMATE_SPEED * dt;
    this.pos = this.clampToOwnHalf(this.pos);
  }

  private playBall(ball: Ball, playerPos: Vec2, mustCrossNet: boolean): void {
    // Launch from the ball's own live position, not this.pos: contact is
    // allowed within HIT_RANGE (not exact overlap), so using the catcher's
    // position here would snap the ball sideways/vertically at the moment of
    // contact instead of continuing smoothly from where it actually is.
    const from = { ...ball.pos };
    // Send it straight back over the net - rather than setting up the player
    // - either because it arrived too fast/direct to set up properly, or
    // because this is the team's mandatory final touch (a set here would
    // illegally stay on the human side for a 4th touch).
    const isEmergency = ball.duration < EMERGENCY_DURATION_THRESHOLD || mustCrossNet;
    if (isEmergency) {
      const target: Vec2 = {
        x: RANDOM_TARGET_MARGIN + random() * (COURT_WIDTH - 2 * RANDOM_TARGET_MARGIN),
        y: RANDOM_TARGET_MARGIN + random() * (NET_Y - 2 * RANDOM_TARGET_MARGIN),
      };
      ball.launch(from, target, {
        duration: TEAMMATE_EMERGENCY_SET_DURATION,
        peakHeight: TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
        toucher: 'teammate',
      });
    } else {
      ball.launch(from, { ...playerPos }, {
        duration: TEAMMATE_SET_DURATION,
        peakHeight: TEAMMATE_SET_PEAK_HEIGHT,
        toucher: 'teammate',
      });
    }
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

  private driftToward(dt: number, target: Vec2): void {
    const toTarget = distance(this.pos, target);
    if (toTarget <= TEAMMATE_RETURN_EPSILON) {
      this.pos = { ...target };
      return;
    }
    const dir = normalize({ x: target.x - this.pos.x, y: target.y - this.pos.y });
    this.pos.x += dir.x * TEAMMATE_SPEED * dt;
    this.pos.y += dir.y * TEAMMATE_SPEED * dt;
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
