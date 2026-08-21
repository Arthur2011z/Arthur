import { Player } from '../entities/Player';
import { InputSnapshot } from '../input/InputManager';

/**
 * Single source of truth for the game world. Grows incrementally as build steps
 * land (ball, teammate, opponents, score/phase); for now it only owns the
 * human-controlled player.
 */
export class GameState {
  readonly player = new Player();

  update(dt: number, input: InputSnapshot): void {
    this.player.update(dt, input.move);
  }
}
