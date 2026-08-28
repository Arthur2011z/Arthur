import { Vec2, normalize } from '../utils/math';
import { ActionType } from './actions';

/** Keys that trigger an action once per press (no auto-repeat). */
const ACTION_KEYS: Record<string, ActionType> = {
  KeyE: 'pass',
  KeyF: 'emergency',
  Space: 'block',
  KeyQ: 'jump',
};

/**
 * Desktop controls. WASD produces a screen-space direction vector - what it
 * *means* is the game's decision, not this class's: on the ground it steers
 * running, in the air it aims the spike. Both readings come from the same
 * vector, so nothing here has to know which state the player is in.
 */
export class Keyboard {
  private readonly held = new Set<string>();
  private readonly pressed = new Set<ActionType>();

  constructor(private readonly onActivity: () => void) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  /** Screen-space direction (up on the display is {0,-1}), normalized. */
  get direction(): Vec2 {
    const raw: Vec2 = { x: 0, y: 0 };
    if (this.held.has('KeyW') || this.held.has('ArrowUp')) raw.y -= 1;
    if (this.held.has('KeyS') || this.held.has('ArrowDown')) raw.y += 1;
    if (this.held.has('KeyA') || this.held.has('ArrowLeft')) raw.x -= 1;
    if (this.held.has('KeyD') || this.held.has('ArrowRight')) raw.x += 1;
    return normalize(raw);
  }

  /** Edge-triggered read: the actions newly pressed since the last call. */
  consumePressed(): ActionType[] {
    const actions = [...this.pressed];
    this.pressed.clear();
    return actions;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const action = ACTION_KEYS[e.code];
    // repeat guard: holding a key must not machine-gun the action, but must
    // still keep the movement key registered as held.
    if (action && !e.repeat) this.pressed.add(action);
    this.held.add(e.code);
    if (action || e.code.startsWith('Key') || e.code.startsWith('Arrow')) {
      e.preventDefault();
      this.onActivity();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  /** Losing focus mid-stride would otherwise leave a key stuck down and the
   * player running forever. */
  private onBlur = (): void => {
    this.held.clear();
  };
}
