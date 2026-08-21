import { Ball } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { InputSnapshot } from '../input/InputManager';
import { distance, Vec2 } from '../utils/math';
import {
  AUTO_SERVE_DURATION,
  AUTO_SERVE_PEAK_HEIGHT,
  AUTO_SERVE_DELAY,
  COURT_WIDTH,
  NET_Y,
  OPPONENT_HOMES,
  POINT_PAUSE_DURATION,
  SERVE_MARGIN,
  WIN_MARGIN,
  WIN_SCORE,
} from './constants';

export type GamePhase = 'playing' | 'point_scored' | 'game_over';
export type Team = 'human' | 'opponents';

/**
 * Single source of truth for the game world: the human player, the ball, the
 * AI teammate, the two AI opponents, and rally-point scoring to WIN_SCORE.
 */
export class GameState {
  player = new Player();
  ball = new Ball();
  teammate = new TeammateAI();
  opponents: OpponentAI[] = OPPONENT_HOMES.map((home, i) =>
    new OpponentAI(home, i === 0 ? 'opponent1' : 'opponent2'),
  );

  score = { human: 0, opponents: 0 };
  phase: GamePhase = 'playing';
  winner: Team | null = null;

  private ballIdleTimer = 0;
  private pointPauseTimer = 0;
  /** Whoever wins a rally serves the next one; opponents serve first. */
  private servingTeam: Team = 'opponents';

  update(dt: number, input: InputSnapshot): void {
    if (this.phase === 'game_over') return;

    if (this.phase === 'point_scored') {
      this.pointPauseTimer += dt;
      if (this.pointPauseTimer >= POINT_PAUSE_DURATION) {
        this.pointPauseTimer = 0;
        this.phase = 'playing';
        this.launchServe(this.servingTeam);
      }
      return;
    }

    const wasFlying = this.ball.state === 'flying';

    this.player.update(dt, input, this.ball, this.teammate.pos);
    this.ball.update(dt);
    this.teammate.update(dt, this.ball, this.player.pos);

    const leadOpponent = this.findLeadOpponent();
    for (const opponent of this.opponents) {
      opponent.update(dt, this.ball, opponent === leadOpponent);
    }

    if (wasFlying && this.ball.state === 'idle') {
      this.handleBallLanded();
      return;
    }

    if (this.ball.state === 'idle') {
      this.ballIdleTimer += dt;
      if (this.ballIdleTimer >= AUTO_SERVE_DELAY) {
        this.launchServe(this.servingTeam);
      }
    } else {
      this.ballIdleTimer = 0;
    }
  }

  /** Discards all in-progress state and starts a fresh game at 0:0. */
  restart(): void {
    this.player = new Player();
    this.ball = new Ball();
    this.teammate = new TeammateAI();
    this.opponents = OPPONENT_HOMES.map((home, i) =>
      new OpponentAI(home, i === 0 ? 'opponent1' : 'opponent2'),
    );
    this.score = { human: 0, opponents: 0 };
    this.phase = 'playing';
    this.winner = null;
    this.ballIdleTimer = 0;
    this.pointPauseTimer = 0;
    this.servingTeam = 'opponents';
  }

  /** Only the closer of the two opponents chases a ball headed their way, so
   * they never both pile onto the same one. */
  private findLeadOpponent(): OpponentAI | null {
    if (this.ball.state !== 'flying' || this.ball.target.y > NET_Y) return null;
    return this.opponents.reduce((closest, o) =>
      distance(o.pos, this.ball.target) < distance(closest.pos, this.ball.target) ? o : closest,
    );
  }

  /** A flight completing untouched is a landing: the side it landed on failed
   * to return it, so the other team scores. */
  private handleBallLanded(): void {
    const landedInHumanHalf = this.ball.pos.y > NET_Y;
    if (landedInHumanHalf) {
      this.score.opponents += 1;
      this.servingTeam = 'opponents';
    } else {
      this.score.human += 1;
      this.servingTeam = 'human';
    }

    if (this.score.human >= WIN_SCORE && this.score.human - this.score.opponents >= WIN_MARGIN) {
      this.winner = 'human';
      this.phase = 'game_over';
    } else if (
      this.score.opponents >= WIN_SCORE &&
      this.score.opponents - this.score.human >= WIN_MARGIN
    ) {
      this.winner = 'opponents';
      this.phase = 'game_over';
    } else {
      this.phase = 'point_scored';
      this.pointPauseTimer = 0;
    }
  }

  /** No real serve mechanic exists: toss the ball into whichever half the
   * *receiving* team defends - the human half if opponents are serving, the
   * opponent half if the human team just won the rally. */
  private launchServe(servingTeam: Team): void {
    const receivingHumanHalf = servingTeam === 'opponents';
    const target: Vec2 = {
      x: SERVE_MARGIN + Math.random() * (COURT_WIDTH - 2 * SERVE_MARGIN),
      y: receivingHumanHalf
        ? NET_Y + SERVE_MARGIN + Math.random() * (NET_Y - 2 * SERVE_MARGIN)
        : SERVE_MARGIN + Math.random() * (NET_Y - 2 * SERVE_MARGIN),
    };
    this.ball.launch(
      { x: COURT_WIDTH / 2, y: NET_Y },
      target,
      { duration: AUTO_SERVE_DURATION, peakHeight: AUTO_SERVE_PEAK_HEIGHT, toucher: null },
    );
    this.ballIdleTimer = 0;
  }
}
