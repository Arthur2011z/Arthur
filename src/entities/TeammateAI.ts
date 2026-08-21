import { Vec2 } from '../utils/math';
import { PLAYER_RADIUS, TEAMMATE_HOME } from '../game/constants';

/**
 * Stub for now: always sits at its home position and never reacts. Deliberately
 * created in this shape already (rather than in step 5) so the reactive
 * chase/set/save logic can be added to update() later without restructuring the
 * class or its callers.
 */
export class TeammateAI {
  readonly homePos: Vec2 = { ...TEAMMATE_HOME };
  pos: Vec2 = { ...TEAMMATE_HOME };
  radius = PLAYER_RADIUS;

  update(_dt: number): void {
    // No-op until step 5.
  }
}
