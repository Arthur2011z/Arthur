import { Ball, BallToucher } from '../entities/Ball';
import { OpponentAI, chooseResponsibleOpponent } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { InputSnapshot } from '../input/InputManager';
import { random } from '../utils/random';
import { Vec2 } from '../utils/math';
import {
  AUTO_SERVE_DELAY,
  AUTO_SERVE_DURATION,
  AUTO_SERVE_PEAK_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  HUMAN_SERVE_TIMEOUT,
  MAX_TEAM_TOUCHES,
  NET_Y,
  POINT_PAUSE_DURATION,
  SERVE_MARGIN,
  SLOWMO_FACTOR,
  WIN_MARGIN,
  WIN_SCORE,
} from './constants';

export type GamePhase = 'playing' | 'point_scored' | 'game_over';
export type Team = 'human' | 'opponents';

/** The two opponents, one per zone: index 0 covers the net zone, index 1 the
 * back zone (see OpponentAI's zone). */
function createOpponents(): OpponentAI[] {
  return [new OpponentAI('net', 'opponent1'), new OpponentAI('back', 'opponent2')];
}

/**
 * Single source of truth for the game world: the human player, the ball, the
 * AI teammate, the two AI opponents, rally-point scoring to WIN_SCORE, and
 * the volleyball touch-limit (see rallyTouches/mustCrossNet below).
 */
export class GameState {
  player = new Player();
  ball = new Ball();
  teammate = new TeammateAI();
  opponents: OpponentAI[] = createOpponents();

  score = { human: 0, opponents: 0 };
  phase: GamePhase = 'playing';
  winner: Team | null = null;
  /** Non-null for as long as the human team is in the serve routine: standing
   * at the baseline waiting for the Aufschlag press, and on through the toss,
   * the jump and the aim window, right up to the moment the ball is struck.
   * The UI reads this to decide which buttons to show (see main.ts). */
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

    // Serve preparation (ball in hand / in the toss) runs its own reduced
    // update: no idle-serve timer, no touch counting, no actions but moving
    // and serving. The moment the server springs after the toss it becomes an
    // ordinary Jump-Smash and the normal loop below takes over - which is what
    // gives the serve the identical slow-motion aim window, live trajectory
    // preview, swipe-length power, scatter and out-balls without duplicating
    // any of it.
    if (this.player.state === 'serve_ready' || this.player.state === 'serve_toss') {
      this.updateServePreparation(dt, input);
      return;
    }

    const wasFlying = this.ball.state === 'flying';
    const prevToucher = this.ball.lastToucher;

    this.player.update(dt, input, this.ball, this.teammate.pos, this.mustCrossNet('human'));
    this.syncServeMode();
    // The ball's own flight is what visibly carries the "Zeitlupe": while the
    // player is mid-aim (slowmo_aim), it's fed a drastically scaled-down dt so
    // it barely creeps along its flight for the (real-time) duration of the
    // window, in sync with the player's own suspended jump animation.
    const ballDt = this.player.state === 'slowmo_aim' ? dt * SLOWMO_FACTOR : dt;
    this.ball.update(ballDt);
    this.teammate.update(
      dt,
      this.ball,
      this.playerInfo(),
      this.mustCrossNet('human'),
      // So the teammate's own attack can aim at the gap their formation leaves.
      this.opponents.map((o) => o.pos),
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
    this.opponents = createOpponents();
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

  /** Exactly one opponent chases any given ball, so they never both pile onto
   * the same one. Which one follows from zone ownership rather than raw
   * proximity - see chooseResponsibleOpponent. */
  private findLeadOpponent(): OpponentAI | null {
    return chooseResponsibleOpponent(this.ball, this.opponents);
  }

  private landedOutOfBounds(): boolean {
    const { x, y } = this.ball.pos;
    return x < 0 || x > COURT_WIDTH || y < 0 || y > COURT_LENGTH;
  }

  /** The team that did NOT play `toucher`'s shot. An untouched ball (only
   * possible before anyone has played the current rally) falls back to the
   * in-bounds rule's answer, since nobody can be blamed for hitting it out. */
  private opposingTeam(toucher: BallToucher): Team {
    if (toucher === null) return this.receivingSideLoses();
    return toucher === 'player' || toucher === 'teammate' ? 'opponents' : 'human';
  }

  /** Who wins when the ball lands IN: the side it came down on failed to dig
   * it, so the other side scores. */
  private receivingSideLoses(): Team {
    return this.ball.pos.y > NET_Y ? 'opponents' : 'human';
  }

  /** A flight completing untouched is a landing. Two ways it can score:
   *
   * - OUT: it came down outside the court lines. Whoever hit it out loses the
   *   point, regardless of which side of the net it came down on. The spike is
   *   the only shot that can do this - it is deliberately not clamped into the
   *   court (see Player.computeSpikeTarget), which is exactly what makes it a
   *   risk worth taking. Every other shot in the game aims within a margin.
   * - IN: the side it landed on failed to return it, so the other team scores.
   */
  private handleBallLanded(): void {
    const winner = this.landedOutOfBounds() ? this.opposingTeam(this.ball.lastToucher) : this.receivingSideLoses();
    if (winner === 'human') {
      this.score.human += 1;
      this.servingTeam = 'human';
    } else {
      this.score.opponents += 1;
      this.servingTeam = 'opponents';
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
   * auto-serve immediately, the human instead goes into the serve routine -
   * the ball in hand at the baseline, the serve UI up, waiting for the
   * Aufschlag press. */
  private beginServe(servingTeam: Team): void {
    this.ballIdleTimer = 0;
    this.rallyTouches = { team: null, count: 0 };
    if (servingTeam === 'opponents') {
      this.launchOpponentServe();
    } else {
      this.awaitingServe = 'human';
      this.serveHoldTimer = 0;
      this.player.enterServeReady();
      this.ball.pos = { ...this.player.pos }; // snap immediately, no first-frame pop
    }
  }

  /** Fair, easy-to-react-to toss, visually originating from an opponent
   * (rather than the abstract net-center point) so it reads as a real serve.
   * Served by the back-zone defender - the one actually standing deep - not
   * by whoever is holding the net. */
  private launchOpponentServe(): void {
    const server = this.opponents.find((o) => o.zone === 'back') ?? this.opponents[0];
    const origin = { ...server.pos };
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

  /** The serve preparation phase (player.state serve_ready / serve_toss): the
   * ball is in the server's hand, or already tossed with the jump about to
   * follow. Only two inputs exist here - moving along the baseline, and the
   * serve itself. Everything else is withheld outright rather than merely
   * hidden, so a stray keypress cannot fire an action that has no meaning at
   * the baseline (and cannot race the serve).
   *
   * The idle-serve timer is deliberately not running during this phase: the
   * ball sitting idle in a server's hand must not trigger the auto-serve
   * fallback. The HUMAN_SERVE_TIMEOUT below is that phase's own safety net. */
  private updateServePreparation(dt: number, input: InputSnapshot): void {
    this.serveHoldTimer += dt;

    this.player.update(
      dt,
      {
        move: input.move,
        aim: null,
        swipe: null,
        jump: false,
        spike: false,
        pass: false,
        block: false,
        hit: false,
        // The fallback keeps the game from ever getting permanently stuck on a
        // serve that is never pressed - it starts the routine exactly as a
        // press would, rather than teleporting the ball over the net.
        serve: input.serve || this.serveHoldTimer >= HUMAN_SERVE_TIMEOUT,
      },
      this.ball,
      this.teammate.pos,
      false,
    );
    this.syncServeMode();
    this.ball.update(dt);
    this.teammate.update(dt, this.ball, this.playerInfo(), false, this.opponents.map((o) => o.pos));
    for (const opponent of this.opponents) opponent.update(dt, this.ball, false);
  }

  /** The serve UI is up for exactly as long as the player is in the serve
   * routine - Player owns that fact (it ends it the instant the ball is
   * struck, or the attempt is over), this only mirrors it. */
  private syncServeMode(): void {
    this.awaitingServe = this.player.isServing ? 'human' : null;
  }

  private playerInfo() {
    return {
      pos: this.player.pos,
      state: this.player.state,
      hasPendingContactInput: this.player.hasPendingContactInput,
      isServing: this.player.isServing,
      isBlocking: this.player.isBlocking,
    };
  }
}
