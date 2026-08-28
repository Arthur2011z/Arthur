import { length, randomBetween } from '../utils/math';
import { COURT_WIDTH, HUMAN_HOMES, NET_Y, PLAYER_SPEED } from '../game/constants';
import { IntentBuffer } from '../game/Contact';
import { velocityToTarget } from '../game/Physics';
import { InputSnapshot } from '../input/actions';
import { Athlete } from './Athlete';
import { Ball } from './Ball';

/**
 * The human-controlled athlete.
 *
 * Pressing an action does not touch the ball. It records an intent in the
 * buffer, and that intent is redeemed only from playBall(), which the physics
 * integrator calls in the exact substep the hitboxes overlap. There is
 * deliberately no other route from input to the ball.
 *
 * The individual shots (pass, emergency, spike, serve, block) arrive in later
 * build steps; at this stage every action produces the same plain return, so
 * that the timing machinery underneath can be verified on its own.
 */
export class Player extends Athlete {
  readonly intents = new IntentBuffer(this);

  constructor() {
    super('player', 'human', HUMAN_HOMES[1]);
  }

  update(dt: number, input: InputSnapshot, nowMs: number): void {
    for (const press of input.pressed) this.intents.press(press.action, press.at);
    this.intents.tick(nowMs);
    this.moveBy(input.move, PLAYER_SPEED, dt);
    this.pose = length(input.move) > 1e-4 ? 'running' : 'idle';
  }

  /**
   * Called from inside the physics substep in which this player's hitbox and
   * the ball's actually overlap. Returns true if a buffered action was waiting
   * and the ball was therefore played; false means the ball passes by
   * untouched, which is what happens whenever nobody asked to play it.
   */
  playBall(ball: Ball, atMs: number): boolean {
    const intent = this.intents.peek(atMs);
    if (!intent) return false;

    // Placeholder shot - a plain return into the far half. Replaced by the
    // real pass/emergency/spike behaviour in the following steps.
    const target = {
      x: randomBetween(1, COURT_WIDTH - 1),
      y: randomBetween(1, NET_Y - 1),
    };
    ball.strike({ ...ball.pos }, velocityToTarget(ball.pos, target, 1.1), this.id);

    this.intents.redeem(intent.action, intent.pressedAt, atMs);
    return true;
  }
}
