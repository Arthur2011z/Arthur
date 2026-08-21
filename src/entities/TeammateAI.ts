import { Vec2, distance, normalize } from '../utils/math';
import {
  EMERGENCY_TIME_THRESHOLD,
  HIT_RANGE,
  NET_Y,
  PLAYER_RADIUS,
  TEAMMATE_EMERGENCY_SET_DURATION,
  TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
  TEAMMATE_HOME,
  TEAMMATE_REACT_RADIUS,
  TEAMMATE_RETURN_EPSILON,
  TEAMMATE_SET_DURATION,
  TEAMMATE_SET_PEAK_HEIGHT,
  TEAMMATE_SPEED,
  WEAK_SHOT_MARGIN,
  COURT_WIDTH,
} from '../game/constants';
import { Ball } from './Ball';

type TeammateState = 'home' | 'moving_to_ball' | 'returning';

/**
 * AI teammate: only leaves home when the ball is actually coming near it or
 * flying toward it (which also covers the human player's dive-pass, since that
 * always targets this teammate's position); plays it — a quick emergency
 * save if it arrived too fast/direct, otherwise a high set to the human player
 * — then heads back home. Idle at home whenever the ball isn't headed its way.
 */
export class TeammateAI {
  readonly homePos: Vec2 = { ...TEAMMATE_HOME };
  pos: Vec2 = { ...TEAMMATE_HOME };
  radius = PLAYER_RADIUS;
  state: TeammateState = 'home';

  update(dt: number, ball: Ball, playerPos: Vec2): void {
    switch (this.state) {
      case 'home':
        if (this.shouldReact(ball)) this.state = 'moving_to_ball';
        break;
      case 'moving_to_ball':
        this.updateMovingToBall(dt, ball, playerPos);
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

  private updateMovingToBall(dt: number, ball: Ball, playerPos: Vec2): void {
    if (ball.state !== 'flying') {
      // The ball landed, or was already handled elsewhere - stand down.
      this.state = 'returning';
      return;
    }

    const toBall = distance(this.pos, ball.pos);
    if (toBall <= HIT_RANGE) {
      this.playBall(ball, playerPos);
      this.state = 'returning';
      return;
    }

    const dir = normalize({ x: ball.pos.x - this.pos.x, y: ball.pos.y - this.pos.y });
    this.pos.x += dir.x * TEAMMATE_SPEED * dt;
    this.pos.y += dir.y * TEAMMATE_SPEED * dt;
  }

  private playBall(ball: Ball, playerPos: Vec2): void {
    const isEmergency = ball.timeRemaining < EMERGENCY_TIME_THRESHOLD;
    if (isEmergency) {
      const target: Vec2 = {
        x: WEAK_SHOT_MARGIN + Math.random() * (COURT_WIDTH - 2 * WEAK_SHOT_MARGIN),
        y: WEAK_SHOT_MARGIN + Math.random() * (NET_Y - 2 * WEAK_SHOT_MARGIN),
      };
      ball.launch(this.pos, target, {
        duration: TEAMMATE_EMERGENCY_SET_DURATION,
        peakHeight: TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT,
        toucher: 'teammate',
      });
    } else {
      ball.launch(this.pos, { ...playerPos }, {
        duration: TEAMMATE_SET_DURATION,
        peakHeight: TEAMMATE_SET_PEAK_HEIGHT,
        toucher: 'teammate',
      });
    }
  }

  private updateReturning(dt: number): void {
    const toHome = distance(this.pos, this.homePos);
    if (toHome <= TEAMMATE_RETURN_EPSILON) {
      this.pos = { ...this.homePos };
      this.state = 'home';
      return;
    }
    const dir = normalize({ x: this.homePos.x - this.pos.x, y: this.homePos.y - this.pos.y });
    this.pos.x += dir.x * TEAMMATE_SPEED * dt;
    this.pos.y += dir.y * TEAMMATE_SPEED * dt;
  }
}
