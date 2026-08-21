import { Vec2 } from '../utils/math';
import { Joystick } from './Joystick';
import { SwipeDetector } from './SwipeDetector';

export interface InputSnapshot {
  move: Vec2;
  /** Non-null only on the frame a swipe gesture just completed. */
  swipe: Vec2 | null;
}

/**
 * Bundles all touch input sources (joystick + swipe now; hit/jump buttons are
 * added in later build steps) and exposes a single per-frame snapshot for the
 * game loop to consume.
 */
export class InputManager {
  private readonly joystick: Joystick;
  private readonly swipeDetector: SwipeDetector;

  constructor(overlay: HTMLElement, playField: HTMLElement) {
    this.joystick = new Joystick(overlay);
    this.swipeDetector = new SwipeDetector(playField);
  }

  snapshot(): InputSnapshot {
    return { move: this.joystick.vector, swipe: this.swipeDetector.consume() };
  }
}
