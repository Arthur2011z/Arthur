import { Vec2 } from '../utils/math';
import { Buttons } from './Buttons';
import { Joystick } from './Joystick';

export interface InputSnapshot {
  move: Vec2;
  /** True only on the frame the Sprung/Hecht button was just pressed. */
  reach: boolean;
  /** True only on the frame the Schlag (attack) button was just pressed. */
  attack: boolean;
  /** True only on the frame the Pass button was just pressed. */
  pass: boolean;
}

/** Bundles all touch input - the joystick and the three action buttons
 * (Sprung/Hecht, Schlag, Pass) - into a single per-frame snapshot for the
 * game loop to consume. No gesture recognition of any kind: every action is
 * an edge-triggered button press. */
export class InputManager {
  private readonly joystick: Joystick;
  private readonly buttons: Buttons;

  constructor(overlay: HTMLElement) {
    this.joystick = new Joystick(overlay);
    this.buttons = new Buttons(overlay);
  }

  snapshot(): InputSnapshot {
    return {
      move: this.joystick.vector,
      reach: this.buttons.consumeReach(),
      attack: this.buttons.consumeAttack(),
      pass: this.buttons.consumePass(),
    };
  }
}
