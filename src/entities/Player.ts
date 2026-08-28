import { length } from '../utils/math';
import { HUMAN_HOMES, PLAYER_SPEED } from '../game/constants';
import { InputSnapshot } from '../input/actions';
import { Athlete } from './Athlete';

/**
 * The human-controlled athlete.
 *
 * At this stage it only walks: the stick (or WASD) steers it around its own
 * half, and letting go stops it instantly. Actions, jumping and ball contact
 * arrive in the following build steps and hang off this same class.
 */
export class Player extends Athlete {
  constructor() {
    super('player', 'human', HUMAN_HOMES[1]);
  }

  update(dt: number, input: InputSnapshot): void {
    this.moveBy(input.move, PLAYER_SPEED, dt);
    this.pose = length(input.move) > 1e-4 ? 'running' : 'idle';
  }
}
