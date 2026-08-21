import { Ball } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { InputSnapshot } from '../input/InputManager';
import {
  AUTO_SERVE_DELAY,
  AUTO_SERVE_DURATION,
  AUTO_SERVE_PEAK_HEIGHT,
  COURT_WIDTH,
  NET_Y,
  OPPONENT_HOMES,
} from './constants';

/**
 * Single source of truth for the game world. Grows incrementally as build steps
 * land (score/phase); for now it owns the human player, the ball, the (still
 * static) AI teammate, and the (still static) two AI opponents.
 */
export class GameState {
  readonly player = new Player();
  readonly ball = new Ball();
  readonly teammate = new TeammateAI();
  readonly opponents: OpponentAI[] = OPPONENT_HOMES.map((home) => new OpponentAI(home));

  private ballIdleTimer = 0;

  update(dt: number, input: InputSnapshot): void {
    this.player.update(dt, input, this.ball, this.teammate.pos);
    this.ball.update(dt);
    this.teammate.update(dt, this.ball, this.player.pos);
    for (const opponent of this.opponents) opponent.update(dt);

    if (this.ball.state === 'idle') {
      this.ballIdleTimer += dt;
      if (this.ballIdleTimer >= AUTO_SERVE_DELAY) {
        this.launchAutoServe();
      }
    } else {
      this.ballIdleTimer = 0;
    }
  }

  /** No serve mechanic exists yet: periodically toss a fresh practice ball into
   * the human half so there's always something to react to. */
  private launchAutoServe(): void {
    const target = {
      x: 1 + Math.random() * (COURT_WIDTH - 2),
      y: NET_Y + 2 + Math.random() * 5,
    };
    this.ball.launch(
      { x: COURT_WIDTH / 2, y: NET_Y },
      target,
      { duration: AUTO_SERVE_DURATION, peakHeight: AUTO_SERVE_PEAK_HEIGHT, toucher: null },
    );
    this.ballIdleTimer = 0;
  }
}
