import { Athlete, TeamId } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Player } from '../entities/Player';
import { InputSnapshot } from '../input/actions';
import { Vec2, randomBetween } from '../utils/math';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  HUMAN_HOMES,
  NET_Y,
  OPPONENT_HOMES,
  WIN_MARGIN,
  WIN_SCORE,
} from './constants';
import { BallEvent, advance, velocityOverNet, velocityToTarget } from './Physics';
import { FaultReason, Rally, RallyResult } from './Rally';

export type GamePhase = 'rally' | 'point_scored' | 'game_over';

/** Pause after a point, long enough to read what happened. */
const POINT_PAUSE = 1.6;
/** Margin (m) kept away from the lines when picking a random serve target. */
const SERVE_MARGIN = 1.5;

/**
 * Single source of truth for the game world: the four figures, the ball, the
 * rule book for the current rally, and the score.
 *
 * The loop is deliberately narrow. Physics reports what physically happened -
 * a contact, a net, a landing - and Rally turns that into a point. This class
 * only wires the two together and keeps the score.
 */
export class GameState {
  player = new Player();
  teammate = new Athlete('teammate', 'human', HUMAN_HOMES[0]);
  opponents: Athlete[] = [
    new Athlete('opponent1', 'opponents', OPPONENT_HOMES[0]),
    new Athlete('opponent2', 'opponents', OPPONENT_HOMES[1]),
  ];
  ball = new Ball();

  score: Record<TeamId, number> = { human: 0, opponents: 0 };
  phase: GamePhase = 'rally';
  winner: TeamId | null = null;
  /** Whoever won the last rally serves the next one. */
  servingTeam: TeamId = 'opponents';
  rally = new Rally('opponents');
  /** Why the last point ended, for the HUD. */
  lastFault: FaultReason | null = null;
  lastEvent: BallEvent | null = null;

  /** Tests switch this off to keep full control of what is in the air. */
  autoServe = true;

  private pauseTimer = 0;

  get athletes(): Athlete[] {
    return [this.player, this.teammate, ...this.opponents];
  }

  update(dt: number, input: InputSnapshot, nowMs: number): void {
    if (this.phase === 'game_over') return;

    if (this.phase === 'point_scored') {
      this.pauseTimer += dt;
      if (this.pauseTimer >= POINT_PAUSE) this.beginRally();
      return;
    }

    this.player.update(dt, input, nowMs);

    const event = advance(
      this.ball,
      dt,
      this.athletes,
      {
        onTouch: (athlete, ball, atMs) => this.handleTouch(athlete, ball, atMs),
        onNetCross: (_ball, to) => this.rally.registerNetCross(to),
      },
      nowMs,
    );

    if (event) {
      this.lastEvent = event;
      this.awardPoint(this.rally.resolveEvent(event));
      return;
    }

    if (this.autoServe && this.ball.state === 'dead') this.serve();
  }

  restart(): void {
    this.score = { human: 0, opponents: 0 };
    this.winner = null;
    this.lastFault = null;
    this.lastEvent = null;
    this.servingTeam = 'opponents';
    this.player = new Player();
    this.ball.reset();
    this.beginRally();
  }

  /** Opens a fresh rally and puts the ball in play. */
  beginRally(): void {
    this.pauseTimer = 0;
    this.phase = 'rally';
    this.rally = new Rally(this.servingTeam);
    this.ball.reset();
    if (this.autoServe) this.serve();
  }

  /**
   * Places the serve. Still automatic for both teams at this step - the human
   * serve state with its own controls arrives in a later one - but it already
   * goes to whoever actually won the last rally.
   */
  serve(): void {
    const fromHuman = this.servingTeam === 'human';
    const origin = {
      x: randomBetween(2, COURT_WIDTH - 2),
      y: fromHuman ? COURT_LENGTH - 0.4 : 0.4,
      z: 2.2,
    };
    const target: Vec2 = {
      x: randomBetween(SERVE_MARGIN, COURT_WIDTH - SERVE_MARGIN),
      y: fromHuman
        ? randomBetween(SERVE_MARGIN, NET_Y - SERVE_MARGIN)
        : randomBetween(NET_Y + SERVE_MARGIN, COURT_LENGTH - SERVE_MARGIN),
    };
    this.ball.strike(origin, velocityOverNet(origin, target, 0.6), null);
  }

  /** Puts a specific ball into play - used by tests to set up a known flight. */
  launchBall(from: { x: number; y: number; z?: number }, target: Vec2, time: number): void {
    const origin = { x: from.x, y: from.y, z: from.z ?? BALL_RADIUS };
    this.ball.strike(origin, velocityToTarget(origin, target, time), null);
  }

  /**
   * A contact, offered from inside the physics substep where the hitboxes met.
   * The athlete decides whether they actually play it (they only do if an
   * action was buffered); the rule book then judges the contact that resulted.
   */
  private handleTouch(athlete: Athlete, ball: Ball, atMs: number): boolean {
    const played = athlete instanceof Player ? athlete.playBall(ball, atMs) : false;
    if (!played) return false;

    const fault = this.rally.registerTouch(athlete);
    if (fault) this.awardPoint(fault);
    return true;
  }

  private awardPoint(result: RallyResult): void {
    if (this.phase !== 'rally') return;

    this.ball.kill();
    this.score[result.winner] += 1;
    this.servingTeam = result.winner;
    this.lastFault = result.reason;

    const winning = this.score[result.winner];
    const losing = this.score[result.loser];
    if (winning >= WIN_SCORE && winning - losing >= WIN_MARGIN) {
      this.winner = result.winner;
      this.phase = 'game_over';
      return;
    }

    this.phase = 'point_scored';
    this.pauseTimer = 0;
  }
}
