import { Court } from '../game/Court';
import { Vec2, length, normalize } from '../utils/math';
import { AIM_DEADZONE } from '../game/constants';
import { InputMode, InputSnapshot, PressedAction, SwipeSample } from './actions';
import { ButtonMode, Buttons } from './Buttons';
import { Joystick } from './Joystick';
import { Keyboard } from './Keyboard';
import { Swipe } from './Swipe';

/**
 * Merges the touch controls and the keyboard into one per-frame snapshot, and
 * decides which of the two the player is actually using.
 *
 * Mode detection is deliberately dumb and therefore predictable: the last kind
 * of input wins. Touch the screen and the on-screen controls appear; press a
 * key and they disappear again. Both input paths stay live at all times - the
 * mode only governs what is *drawn*, so a stray touch on a hidden control can
 * never fire an action.
 *
 * Every direction leaving this class is already converted into court space by
 * Court.screenToCourt(), so no gameplay code ever deals with screen rotation.
 */
export class InputManager {
  mode: InputMode;

  private readonly touchLayer: HTMLDivElement;
  private readonly joystick: Joystick;
  private readonly buttons: Buttons;
  private readonly swipe: Swipe;
  private readonly keyboard: Keyboard;

  constructor(
    overlay: HTMLElement,
    swipeSurface: HTMLElement,
    private readonly court: Court,
  ) {
    this.touchLayer = document.createElement('div');
    this.touchLayer.id = 'touch-controls';
    Object.assign(this.touchLayer.style, {
      position: 'absolute',
      inset: '0',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    overlay.appendChild(this.touchLayer);

    const useTouch = () => this.setMode('touch');
    this.joystick = new Joystick(this.touchLayer, useTouch);
    this.buttons = new Buttons(this.touchLayer, useTouch);
    this.swipe = new Swipe(swipeSurface, useTouch);
    this.keyboard = new Keyboard(() => this.setMode('keyboard'));

    // First impression only - the first real input immediately corrects it.
    this.mode = window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'keyboard';
    this.applyMode();
  }

  /** Switches the touch cluster between the rally buttons and the single
   * Aufschlag button. No-op in keyboard mode beyond bookkeeping. */
  setButtonMode(mode: ButtonMode): void {
    this.buttons.setMode(mode);
  }

  /** Passes the player's airborne state to the button cluster, which uses it to
   * hand an aiming gesture starting on the Schmettern button through to the
   * swipe surface instead of consuming it. */
  setAiming(aiming: boolean): void {
    this.buttons.setAiming(aiming);
  }

  snapshot(): InputSnapshot {
    const pressed: PressedAction[] = [
      ...this.buttons.consumePressed(),
      ...this.keyboard.consumePressed(),
    ].sort((a, b) => a.at - b.at);

    // Touch and keyboard directions are both read every frame; whichever is
    // actually being used is non-zero, so no arbitration is needed.
    const stick = this.joystick.vector;
    const keys = this.keyboard.direction;
    const screenDir = length(stick) > length(keys) ? stick : keys;
    const magnitude = Math.min(1, length(screenDir));

    const courtDir = this.court.screenToCourt(normalize(screenDir));
    const move: Vec2 = { x: courtDir.x * magnitude, y: courtDir.y * magnitude };
    const aim: Vec2 | null = magnitude > AIM_DEADZONE ? courtDir : null;

    return {
      move,
      aim,
      pressed,
      swipe: this.toCourtSwipe(this.swipe.active),
      // A release is passed on even when the finger barely moved. Aiming needs
      // a real direction, so the live sample above still drops a stationary
      // touch - but the *release* is the trigger to hit, and a quick flick
      // that falls short of the swipe threshold should hit straight ahead
      // rather than do nothing at all.
      swipeReleased: this.toCourtSwipe(this.swipe.consumeRelease(), true),
      mode: this.mode,
    };
  }

  private toCourtSwipe(
    raw: { dir: Vec2; strength: number } | null,
    keepTap = false,
  ): SwipeSample | null {
    if (!raw) return null;
    if (!keepTap && raw.strength <= 0) return null;
    return { dir: this.court.screenToCourt(raw.dir), strength: raw.strength };
  }

  private setMode(mode: InputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.applyMode();
  }

  private applyMode(): void {
    this.touchLayer.style.display = this.mode === 'touch' ? 'block' : 'none';
  }
}
