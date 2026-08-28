import { Athlete } from '../entities/Athlete';
import { Player } from '../entities/Player';
import { InputSnapshot } from '../input/actions';
import { HUMAN_HOMES, OPPONENT_HOMES } from './constants';

export type GamePhase = 'playing' | 'point_scored' | 'game_over';
export type Team = 'human' | 'opponents';

/**
 * Single source of truth for the game world.
 *
 * At this build step it holds the four figures and moves the human one. The
 * ball, the rule engine and the AI arrive in the following steps; the three
 * non-player figures already exist here (standing on their zone home spots)
 * so the court reads correctly while the rest is built.
 */
export class GameState {
  player = new Player();
  teammate = new Athlete('teammate', 'human', HUMAN_HOMES[0]);
  opponents: Athlete[] = [
    new Athlete('opponent1', 'opponents', OPPONENT_HOMES[0]),
    new Athlete('opponent2', 'opponents', OPPONENT_HOMES[1]),
  ];

  score = { human: 0, opponents: 0 };
  phase: GamePhase = 'playing';
  winner: Team | null = null;

  /** Every athlete on the court, in a stable order. */
  get athletes(): Athlete[] {
    return [this.player, this.teammate, ...this.opponents];
  }

  update(dt: number, input: InputSnapshot): void {
    if (this.phase !== 'playing') return;
    this.player.update(dt, input);
  }
}
