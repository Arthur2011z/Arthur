import { Vec2 } from '../utils/math';
import { Joystick } from './Joystick';

export interface InputSnapshot {
  move: Vec2;
}

/**
 * Bundles all touch input sources (joystick now; swipe detector and hit/jump
 * buttons are added in later build steps) and exposes a single per-frame snapshot
 * for the game loop to consume.
 */
export class InputManager {
  private readonly joystick: Joystick;

  constructor(overlay: HTMLElement) {
    this.joystick = new Joystick(overlay);
  }

  snapshot(): InputSnapshot {
    return { move: this.joystick.vector };
  }
}
