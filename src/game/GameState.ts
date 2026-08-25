import { Ball, BallToucher } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { InputSnapshot } from '../input/InputManager';
import { random } from '../utils/random';
import { distance, Vec2 } from '../utils/math';
import {
  AUTO_SERVE_DELAY,
  AUTO_SERVE_DURATION,
  AUTO_SERVE_PEAK_HEIGHT,
  COURT_WIDTH,
  HUMAN_SERVE_DURATION,
  HUMAN_SERVE_PEAK_HEIGHT,
  HUMAN_SERVE_TIMEOUT,
  MAX_TEAM_TOUCHES,
  NET_Y,
  OPPONENT_HOMES,
  POINT_PAUSE_DURATION,
  SERVE_MARGIN,
  SLOWMO_FACTOR,
  WIN_MARGIN,
  WIN_SCORE,
} from './constants';

export type GamePhase = 'playing' | 'point_scored' | 'game_over';
export type Team = 'human' | 'opponents';

/**
 * Single source of truth for the game world: the human player, the ball, the
 * AI teammate, the two AI opponents, rally-point scoring to WIN_SCORE, and
 * the volleyball touch-limit (see rallyTouches/mustCrossNet below).
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
  /** Non-null while the human is holding serve, waiting for their
   * Notfall-Schlag press. */
  awaitingServe: Team | null = null;

  private ballIdleTimer = 0;
  private pointPauseTimer = 0;
  private serveHoldTimer = 0;
  /** Whoever wins a rally serves the next one; opponents serve first. */
  private servingTeam: Team = 'opponents';
  /** How many consecutive touches the currently-touching team has made since
   * the ball last crossed the net (or since the current serve went up). At
   * MAX_TEAM_TOUCHES - 1, the *next* touch by that team is mandatory-final -
   * see mustCrossNet(). */
  private rallyTouches: { team: Team | null; count: number } = { team: null, count: 0 };

  update(dt: number, input: InputSnapshot): void {
    if (this.phase === 'game_over') return;

    if (this.phase === 'point_scored') {
      this.pointPauseTimer += dt;
      if (this.pointPauseTimer >= POINT_PAUSE_DURATION) {
        this.pointPauseTimer = 0;
        this.phase = 'playing';
        this.beginServe(this.servingTeam);
      }
      return;
    }

    if (this.awaitingServe !== null) {
      this.updateServeHold(dt, input);
      return;
    }

    const wasFlying = this.ball.state === 'flying';
    const prevToucher = this.ball.lastToucher;

    this.player.update(dt, input, this.ball, this.teammate.pos, this.mustCrossNet('human'));
    // The ball's own flight is what visibly carries the "Zeitlupe": while the
    // player is mid-aim (slowmo_aim), it's fed a drastically scaled-down dt so
    // it barely creeps along its flight for the (real-time) duration of the
    // window, in sync with the player's own suspended jump animation.
    const ballDt = this.player.state === 'slowmo_aim' ? dt * SLOWMO_FACTOR : dt;
    this.ball.update(ballDt);
    this.teammate.update(
      dt,
      this.ball,
      { pos: this.player.pos, state: this.player.state, hasPendingContactInput: this.player.hasPendingContactInput },
      this.mustCrossNet('human'),
    );

    const leadOpponent = this.findLeadOpponent();
    for (const opponent of this.opponents) {
      opponent.update(dt, this.ball, opponent === leadOpponent);
    }

    if (this.ball.lastToucher !== prevToucher && this.ball.lastToucher !== null) {
      this.registerTouch(this.ball.lastToucher);
    }

    if (wasFlying && this.ball.state === 'idle') {
      this.handleBallLanded();
      return;
    }

    if (this.ball.state === 'idle') {
      this.ballIdleTimer += dt;
      if (this.ballIdleTimer >= AUTO_SERVE_DELAY) {
        this.beginServe(this.servingTeam);
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
    this.awaitingServe = null;
    this.ballIdleTimer = 0;
    this.pointPauseTimer = 0;
    this.serveHoldTimer = 0;
    this.servingTeam = 'opponents';
    this.rallyTouches = { team: null, count: 0 };
  }

  /** Whether `team`'s *next* touch is mandatory-final (its 3rd consecutive
   * touch since the ball last crossed the net) - Player and TeammateAI use
   * this to force the ball back over the net instead of staying on their own
   * side (a pass/set) for that touch. */
  private mustCrossNet(team: Team): boolean {
    return this.rallyTouches.team === team && this.rallyTouches.count >= MAX_TEAM_TOUCHES - 1;
  }

  private registerTouch(toucher: BallToucher): void {
    const team: Team = toucher === 'player' || toucher === 'teammate' ? 'human' : 'opponents';
    if (this.rallyTouches.team === team) {
      this.rallyTouches.count += 1;
    } else {
      this.rallyTouches = { team, count: 1 };
    }
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

  /** Dispatches the next serve to whoever won the last rally: the opponents
   * auto-serve immediately, the human instead holds the ball until they
   * press Notfall-Schlag to send it (or a fallback timeout elapses). */
  private beginServe(servingTeam: Team): void {
    this.ballIdleTimer = 0;
    this.rallyTouches = { team: null, count: 0 };
    if (servingTeam === 'opponents') {
      this.launchOpponentServe();
    } else {
      this.awaitingServe = 'human';
      this.serveHoldTimer = 0;
      this.ball.pos = { ...this.player.pos }; // snap immediately, no first-frame pop
    }
  }

  /** Fair, easy-to-react-to toss, visually originating from an opponent
   * (rather than the abstract net-center point) so it reads as a real serve. */
  private launchOpponentServe(): void {
    const origin = { ...this.opponents[0].pos };
    const target: Vec2 = {
      x: SERVE_MARGIN + random() * (COURT_WIDTH - 2 * SERVE_MARGIN),
      y: NET_Y + SERVE_MARGIN + random() * (NET_Y - 2 * SERVE_MARGIN),
    };
    this.ball.launch(origin, target, {
      duration: AUTO_SERVE_DURATION,
      peakHeight: AUTO_SERVE_PEAK_HEIGHT,
      toucher: null,
    });
  }

  /** While the human holds serve: the ball tracks their position (free
   * movement still works), and only the Notfall-Schlag button (or the safety
   * timeout) sends it over - swipe, jump, Hechten and Pass are withheld
   * entirely so an accidental press can't race a zero-range action against
   * the serve itself. */
  private updateServeHold(dt: number, input: InputSnapshot): void {
    this.serveHoldTimer += dt;

    this.player.update(
      dt,
      { move: input.move, swipe: null, jump: false, pass: false, dive: false, hit: false },
      this.ball,
      this.teammate.pos,
      false,
    );
    this.ball.pos = { ...this.player.pos };
    this.teammate.update(
      dt,
      this.ball,
      { pos: this.player.pos, state: this.player.state, hasPendingContactInput: this.player.hasPendingContactInput },
      false,
    );
    for (const opponent of this.opponents) opponent.update(dt, this.ball, false);

    if (input.hit || this.serveHoldTimer >= HUMAN_SERVE_TIMEOUT) {
      this.fireHumanServe();
    }
  }

  private fireHumanServe(): void {
    const target: Vec2 = {
      x: SERVE_MARGIN + random() * (COURT_WIDTH - 2 * SERVE_MARGIN),
      y: SERVE_MARGIN + random() * (NET_Y - 2 * SERVE_MARGIN),
    };
    this.ball.launch({ ...this.player.pos }, target, {
      duration: HUMAN_SERVE_DURATION,
      peakHeight: HUMAN_SERVE_PEAK_HEIGHT,
      toucher: 'player',
    });
    this.awaitingServe = null;
  }
}
