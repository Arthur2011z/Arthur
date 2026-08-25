import { Vec2 } from '../utils/math';
import { Buttons } from './Buttons';
import { Joystick } from './Joystick';
import { SwipeInput } from './SwipeInput';

export interface InputSnapshot {
  move: Vec2;
  /** Swipe direction recognized this frame, used solely to aim the spike
   * during the Jump-Smash's slow-motion window (slowmo_aim); null if none.
   * Hechten is a button now (see `dive`), so a swipe outside that window has
   * no effect at all. */
  swipe: Vec2 | null;
  /** True only on the frame the Sprung-Schmetterschlag button was just pressed. */
  jump: boolean;
  /** True only on the frame the Pass button was just pressed. */
  pass: boolean;
  /** True only on the frame the Hechten button was just pressed. */
  dive: boolean;
  /** True only on the frame the Notfall-Schlag button was just pressed. */
  hit: boolean;
}

/** Bundles all touch input - the joystick, the swipe gesture (on the canvas,
 * spike aim only), and the four action buttons (Sprung-Schmetterschlag, Pass,
 * Hechten, Notfall-Schlag) - into a single per-frame snapshot for the game
 * loop to consume. */
export class InputManager {
  private readonly joystick: Joystick;
  private readonly swipe: SwipeInput;
  private readonly buttons: Buttons;

  constructor(overlay: HTMLElement, canvas: HTMLElement) {
    this.joystick = new Joystick(overlay);
    this.swipe = new SwipeInput(canvas);
    this.buttons = new Buttons(overlay);
  }

  snapshot(): InputSnapshot {
    return {
      move: this.joystick.vector,
      swipe: this.swipe.consumeSwipe(),
      jump: this.buttons.consumeJump(),
      pass: this.buttons.consumePass(),
      dive: this.buttons.consumeDive(),
      hit: this.buttons.consumeHit(),
    };
  }
}
