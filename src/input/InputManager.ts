import { Vec2, length, normalize } from '../utils/math';
import { AIM_SWIPE_MAX_PX, AIM_SWIPE_MIN_PX, DEFAULT_AIM_STRENGTH } from '../game/constants';
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
  /** True only on the frame the Aufschlag button (or Space/Q) was pressed.
   * Only ever acted on while preparing to serve - it starts the toss. */
  serve: boolean;
  /** Live aim while a spike is being aimed: the direction to hit in, plus how
   * hard, 0..1. Non-null on every frame the player is expressing an aim - a
   * finger held down mid-swipe, or WASD/the joystick held. This is what the
   * trajectory preview follows; it is NOT the trigger, which is still `swipe`
   * (touch) or `spike` (the second Q). Null when no aim is being expressed, in
   * which case the last aim stands. */
  aim: { dir: Vec2; strength: number } | null;
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
    const btnServe = this.buttons.consumeServe();

    const keyQ = this.keyboard.consumeQ();
    const keyPass = this.keyboard.consumePass();
    const keyDive = this.keyboard.consumeDive();
    const keyHit = this.keyboard.consumeHit();

    const stick = this.joystick.vector;
    const keys = this.keyboard.moveVector;
    const move = { x: stick.x + keys.x, y: stick.y + keys.y };

    return {
      move,
      aim: buildAim(this.swipe.drag, move),
      swipe: this.swipe.consumeSwipe(),
      // One Q edge feeds both fields; Player reads `jump` only while on the
      // ground and `spike` only while airborne, and those are mutually
      // exclusive - so a single press can never do both at once.
      jump: btnJump || keyQ,
      spike: keyQ,
      pass: btnPass || keyPass,
      dive: btnDive || keyDive,
      hit: btnHit || keyHit,
      // On the keyboard the serve reuses the two keys that are meaningless
      // while standing at the baseline anyway: Space (Hechten) and Q (jump).
      // Player only reads this in serve_ready, so they keep their normal jobs
      // everywhere else.
      serve: btnServe || keyDive || keyQ,
    };
  }

  /** Switches the on-screen UI between the serve layout (one single Aufschlag
   * button) and the normal four action buttons. Driven every frame from the
   * game's own serve state - see main.ts. */
  setServeMode(active: boolean): void {
    this.buttons.setServeMode(active);
  }
}

/** Turns whatever the player is currently expressing into an aim.
 *
 * A held swipe wins: its length is real information (how hard to hit), so it
 * maps onto strength between AIM_SWIPE_MIN_PX and AIM_SWIPE_MAX_PX. A drag
 * shorter than the minimum is not yet an aim at all - the player has barely
 * moved, and snapping the preview to a jittery one-pixel direction would be
 * noise rather than feedback.
 *
 * Otherwise WASD/the joystick provide direction only; they have no length to
 * read, so they use DEFAULT_AIM_STRENGTH - which is exactly the full-strength
 * shot those inputs produced before swipe length meant anything.
 */
function buildAim(drag: Vec2 | null, move: Vec2): { dir: Vec2; strength: number } | null {
  if (drag) {
    const px = length(drag);
    if (px >= AIM_SWIPE_MIN_PX) {
      const strength = Math.min(1, (px - AIM_SWIPE_MIN_PX) / (AIM_SWIPE_MAX_PX - AIM_SWIPE_MIN_PX));
      return { dir: normalize(drag), strength };
    }
    return null;
  }
  if (length(move) > 0.001) return { dir: normalize(move), strength: DEFAULT_AIM_STRENGTH };
  return null;
}
