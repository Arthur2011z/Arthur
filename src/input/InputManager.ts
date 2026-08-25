import { Vec2 } from '../utils/math';
import { Buttons } from './Buttons';
import { Joystick } from './Joystick';
import { Keyboard } from './Keyboard';
import { SwipeInput } from './SwipeInput';

export interface InputSnapshot {
  /** Combined joystick + WASD direction. On the ground this drives movement;
   * while airborne it aims the smash instead (see Player.updateAirborneAim). */
  move: Vec2;
  /** Swipe direction recognized this frame, used solely to aim the spike
   * during the Jump-Smash's slow-motion window (slowmo_aim); null if none.
   * Hechten is a button now (see `dive`), so a swipe outside that window has
   * no effect at all. */
  swipe: Vec2 | null;
  /** True only on the frame the Sprung-Schmetterschlag was started - the
   * on-screen jump button, or a Q press made while on the ground. */
  jump: boolean;
  /** True only on the frame a smash *hit* was requested: the second Q press,
   * made while airborne. Player only acts on it if the ball is genuinely in
   * reach at that instant - it never fires into empty air. */
  spike: boolean;
  /** True only on the frame the Pass button (or E) was pressed. */
  pass: boolean;
  /** True only on the frame the Hechten button (or Space) was pressed. */
  dive: boolean;
  /** True only on the frame the Notfall-Schlag button (or F) was pressed. */
  hit: boolean;
}

/** Bundles all input - the joystick, the swipe gesture (on the canvas, spike
 * aim only), the four action buttons, and the keyboard - into a single
 * per-frame snapshot for the game loop to consume. Touch and keyboard are
 * live simultaneously; neither disables the other. */
export class InputManager {
  private readonly joystick: Joystick;
  private readonly swipe: SwipeInput;
  private readonly buttons: Buttons;
  private readonly keyboard: Keyboard;

  constructor(overlay: HTMLElement, canvas: HTMLElement) {
    this.joystick = new Joystick(overlay);
    this.swipe = new SwipeInput(canvas);
    this.buttons = new Buttons(overlay);
    this.keyboard = new Keyboard();
  }

  snapshot(): InputSnapshot {
    // Every consume* is read unconditionally rather than short-circuited
    // behind ||: a pending press that went unread would survive into the next
    // frame and fire late.
    const btnJump = this.buttons.consumeJump();
    const btnPass = this.buttons.consumePass();
    const btnDive = this.buttons.consumeDive();
    const btnHit = this.buttons.consumeHit();

    const keyQ = this.keyboard.consumeQ();
    const keyPass = this.keyboard.consumePass();
    const keyDive = this.keyboard.consumeDive();
    const keyHit = this.keyboard.consumeHit();

    const stick = this.joystick.vector;
    const keys = this.keyboard.moveVector;

    return {
      move: { x: stick.x + keys.x, y: stick.y + keys.y },
      swipe: this.swipe.consumeSwipe(),
      // One Q edge feeds both fields; Player reads `jump` only while on the
      // ground and `spike` only while airborne, and those are mutually
      // exclusive - so a single press can never do both at once.
      jump: btnJump || keyQ,
      spike: keyQ,
      pass: btnPass || keyPass,
      dive: btnDive || keyDive,
      hit: btnHit || keyHit,
    };
  }
}
