import { Vec2 } from '../utils/math';
import { Buttons } from './Buttons';
import { Joystick } from './Joystick';
import { SwipeInput } from './SwipeInput';

export interface InputSnapshot {
  move: Vec2;
  /** Swipe direction recognized this frame (Hechten while active, spike aim
   * while in slowmo_aim - Player decides which based on its own state), or
   * null if none. */
  swipe: Vec2 | null;
  /** True only on the frame the Sprung-Schmetterschlag button was just pressed. */
  jump: boolean;
  /** True only on the frame the Pass button was just pressed. */
  pass: boolean;
  /** True only on the frame the Notfall-Schlag button was just pressed. */
  hit: boolean;
}

/** Bundles all touch input - the joystick, the swipe gesture (on the canvas),
 * and the three action buttons (Sprung-Schmetterschlag, Pass, Notfall-Schlag)
 * - into a single per-frame snapshot for the game loop to consume. */
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
      hit: this.buttons.consumeHit(),
    };
  }
}
