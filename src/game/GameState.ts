import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Player } from '../entities/Player';
import { InputSnapshot } from '../input/actions';
import { Vec2, randomBetween } from '../utils/math';
import { BALL_RADIUS, COURT_WIDTH, HUMAN_HOMES, NET_Y, OPPONENT_HOMES } from './constants';
import { BallEvent, advance, velocityToTarget } from './Physics';

export type GamePhase = 'playing' | 'point_scored' | 'game_over';
export type Team = 'human' | 'opponents';

/** How long the ball lies in the sand before the next one is put into play.
 * Replaced by the real serve sequence in a later step. */
const RESTART_DELAY = 1.4;

/**
 * Single source of truth for the game world.
 *
 * At this build step it owns the ball physics and the contact resolution: the
 * ball is advanced in fixed substeps, and each substep offers any overlapping
 * athlete the chance to play it. Whether they do is entirely up to whether
 * they have a buffered intent waiting - see Player.playBall().
 *
 * Scoring, the three-touch rule and the AI arrive in the following steps.
 */
export class GameState {
  player = new Player();
  teammate = new Athlete('teammate', 'human', HUMAN_HOMES[0]);
  opponents: Athlete[] = [
    new Athlete('opponent1', 'opponents', OPPONENT_HOMES[0]),
    new Athlete('opponent2', 'opponents', OPPONENT_HOMES[1]),
  ];
  ball = new Ball();

  score = { human: 0, opponents: 0 };
  phase: GamePhase = 'playing';
  winner: Team | null = null;
  /** The event that ended the last flight, kept for debugging and tests. */
  lastEvent: BallEvent | null = null;
  /** Tests switch this off to keep full control of what is in the air. */
  autoServe = true;

  private restartTimer = 0;

  get athletes(): Athlete[] {
    return [this.player, this.teammate, ...this.opponents];
  }

  update(dt: number, input: InputSnapshot, nowMs: number): void {
    if (this.phase !== 'playing') return;

    this.player.update(dt, input, nowMs);

    const event = advance(this.ball, dt, this.athletes, {
      onTouch: (athlete, ball, atMs) =>
        athlete instanceof Player ? athlete.playBall(ball, atMs) : false,
    }, nowMs);

    if (event) this.lastEvent = event;

    if (this.ball.state === 'dead') {
      this.restartTimer += dt;
      if (this.autoServe && this.restartTimer >= RESTART_DELAY) this.putBallInPlay();
    } else {
      this.restartTimer = 0;
    }
  }

  /** Temporary stand-in for the serve: drops a fair, easy ball into the human
   * half from the far side so the contact machinery has something to chew on.
   * Replaced by the real serve state in a later step. */
  putBallInPlay(): void {
    this.restartTimer = 0;
    const origin = { ...this.opponents[0].pos, z: 1.9 };
    const target: Vec2 = {
      x: randomBetween(1.5, COURT_WIDTH - 1.5),
      y: randomBetween(NET_Y + 1.5, NET_Y + 6),
    };
    this.ball.strike(origin, velocityToTarget(origin, target, 1.5), null);
  }

  /** Puts a specific ball into play - used by tests to set up a known flight. */
  launchBall(from: { x: number; y: number; z?: number }, target: Vec2, time: number): void {
    this.restartTimer = 0;
    const origin = { x: from.x, y: from.y, z: from.z ?? BALL_RADIUS };
    this.ball.strike(origin, velocityToTarget(origin, target, time), null);
  }
}
