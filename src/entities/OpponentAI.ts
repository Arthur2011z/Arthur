import { Vec2, clamp, distance, normalize } from '../utils/math';
import { random } from '../utils/random';
import {
  COURT_WIDTH,
  HIT_RANGE,
  NET_Y,
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
 * Simple opponent AI: automatically moves to an incoming ball and returns it,
 * then heads back to its home position. Only the closer of the two opponents
 * (decided in GameState, passed in as `isLead`) chases any given ball, so they
 * don't both pile onto the same one.
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

    if (distance(this.pos, ball.pos) <= HIT_RANGE) {
      // Launch from the ball's own live position, not this.pos: contact is
      // allowed within HIT_RANGE (not exact overlap), so using the catcher's
      // position here would snap the ball sideways/vertically at the moment
      // of contact instead of continuing smoothly from where it actually is.
      const from = { ...ball.pos };
      const target: Vec2 = {
        x: SERVE_MARGIN + random() * (COURT_WIDTH - 2 * SERVE_MARGIN),
        y: NET_Y + SERVE_MARGIN + random() * (NET_Y - 2 * SERVE_MARGIN),
      };
      ball.launch(from, target, {
        duration: OPPONENT_RETURN_DURATION,
        peakHeight: OPPONENT_RETURN_PEAK_HEIGHT,
        toucher: this.toucherId,
      });
      this.state = 'returning';
      return;
    }

    const dir = normalize({ x: ball.pos.x - this.pos.x, y: ball.pos.y - this.pos.y });
    this.pos.x += dir.x * OPPONENT_SPEED * dt;
    this.pos.y += dir.y * OPPONENT_SPEED * dt;
    this.pos = this.clampToOwnHalf(this.pos);
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
