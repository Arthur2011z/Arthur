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
  OPPONENT_ERROR_CHANCE,
  OPPONENT_FAULT_DURATION,
  OPPONENT_FAULT_OWN_SIDE_MARGIN,
  OPPONENT_FAULT_PEAK_HEIGHT,
  OPPONENT_RETURN_DURATION,
  OPPONENT_RETURN_EPSILON,
  OPPONENT_RETURN_PEAK_HEIGHT,
  OPPONENT_SPEED,
  PLAYER_RADIUS,
  SERVE_MARGIN,
} from '../game/constants';
import { Ball, BallToucher } from './Ball';

type OpponentState = 'home' | 'moving_to_ball' | 'returning';

/**
 * Opponent AI: automatically moves to an incoming ball and plays it, then
 * heads back to its home position. Only the closer of the two opponents
 * (decided in GameState, passed in as `isLead`) chases any given ball, so they
 * don't both pile onto the same one.
 *
 * Deliberately beatable rather than a wall: most touches are a safe, generous
 * return (see OPPONENT_RETURN_*), but a fraction are an aggressive attack
 * (OPPONENT_ATTACK_CHANCE - faster, flatter, aimed closer to the lines) and a
 * smaller fraction are a mechanical error that nets out on their own side
 * (OPPONENT_ERROR_CHANCE), giving the human team real, earned scoring
 * chances beyond just outrunning the AI's positioning.
 */
export class OpponentAI {
  readonly homePos: Vec2;
  pos: Vec2;
  radius = PLAYER_RADIUS;
  state: OpponentState = 'home';

  constructor(
    homePos: Vec2,
    private readonly toucherId: Extract<BallToucher, 'opponent1' | 'opponent2'>,
  ) {
    this.homePos = { ...homePos };
    this.pos = { ...homePos };
  }

  update(dt: number, ball: Ball, isLead: boolean): void {
    switch (this.state) {
      case 'home':
        if (isLead && ball.state === 'flying' && ball.target.y <= NET_Y) {
          this.state = 'moving_to_ball';
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

    const dir = normalize({ x: ball.pos.x - this.pos.x, y: ball.pos.y - this.pos.y });
    this.pos.x += dir.x * OPPONENT_SPEED * dt;
    this.pos.y += dir.y * OPPONENT_SPEED * dt;
    this.pos = this.clampToOwnHalf(this.pos);
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
    const toHome = distance(this.pos, this.homePos);
    if (toHome <= OPPONENT_RETURN_EPSILON) {
      this.pos = { ...this.homePos };
      this.state = 'home';
      return;
    }
    const dir = normalize({ x: this.homePos.x - this.pos.x, y: this.homePos.y - this.pos.y });
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
