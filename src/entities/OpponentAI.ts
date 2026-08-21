import { Vec2 } from '../utils/math';
import { PLAYER_RADIUS } from '../game/constants';

/**
 * Stub for now: sits statically at its home position. Created early (rather than
 * in step 6) purely so the court reads as visually complete already; the
 * chase-and-return logic is added to update() in step 6 without restructuring
 * the class or its two instances.
 */
export class OpponentAI {
  readonly homePos: Vec2;
  pos: Vec2;
  radius = PLAYER_RADIUS;

  constructor(homePos: Vec2) {
    this.homePos = { ...homePos };
    this.pos = { ...homePos };
  }

  update(_dt: number): void {
    // No-op until step 6.
  }
}
