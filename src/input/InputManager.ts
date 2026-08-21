import { Vec2 } from '../utils/math';
import { Buttons } from './Buttons';
import { Joystick } from './Joystick';
import { SwipeDetector } from './SwipeDetector';

export interface InputSnapshot {
  move: Vec2;
  /** Non-null only on the frame a swipe gesture just completed. */
  swipe: Vec2 | null;
  /** True only on the frame the Hit button was just pressed. */
  hit: boolean;
}

/**
 * Bundles all touch input sources (joystick, swipe, Hit button now; Jump is
 * added in step 4) and exposes a single per-frame snapshot for the game loop to
 * consume.
 */
export class InputManager {
  private readonly joystick: Joystick;
  private readonly swipeDetector: SwipeDetector;
  private readonly buttons: Buttons;

  constructor(overlay: HTMLElement, playField: HTMLElement) {
    this.joystick = new Joystick(overlay);
    this.swipeDetector = new SwipeDetector(playField);
    this.buttons = new Buttons(overlay);
  }

  snapshot(): InputSnapshot {
    return {
      move: this.joystick.vector,
      swipe: this.swipeDetector.consume(),
      hit: this.buttons.consumeHit(),
    };
  }
}
