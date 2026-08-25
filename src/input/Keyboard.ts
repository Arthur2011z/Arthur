import { Vec2 } from '../utils/math';

/** WASD -> court directions. y grows "downward" on screen and toward the
 * human team's own baseline, so W (up the court, toward the net) is -y. */
const MOVE_KEYS: Record<string, Vec2> = {
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};

/**
 * Keyboard controls, the desktop counterpart to the on-screen joystick and
 * buttons. Both are live at once and merge into the same InputSnapshot, so
 * neither disables the other.
 *
 *   W A S D  run on the ground; while airborne they aim the smash instead
 *   Space    Hechten (dive) - same auto-aimed dash as the on-screen button
 *   Q        first press jumps; a second press while airborne hits the smash
 *   E        Pass
 *   F        Notfall-Schlag
 *
 * Q is reported as a single edge (see consumeQ). It is InputManager that maps
 * that one edge onto both the `jump` and `spike` snapshot fields; Player then
 * reads whichever applies to the state it is actually in - `jump` only on the
 * ground, `spike` only in the air. Those states are mutually exclusive, so one
 * physical press can never do both.
 */
export class Keyboard {
  private readonly held = new Set<string>();

  private divePending = false;
  private qPending = false;
  private passPending = false;
  private hitPending = false;

  constructor(target: EventTarget = window) {
    target.addEventListener('keydown', this.onKeyDown as EventListener);
    target.addEventListener('keyup', this.onKeyUp as EventListener);
    // A focus loss swallows the matching keyup, which would otherwise leave
    // the player running in that direction forever.
    target.addEventListener('blur', this.onBlur);
  }

  /** Combined direction of the currently-held WASD keys. Two keys at once
   * give a diagonal of length sqrt(2); Player clamps the magnitude to 1, the
   * same as it does for a joystick pushed to its rim. */
  get moveVector(): Vec2 {
    const v = { x: 0, y: 0 };
    for (const code of Object.keys(MOVE_KEYS)) {
      if (this.held.has(code)) {
        v.x += MOVE_KEYS[code].x;
        v.y += MOVE_KEYS[code].y;
      }
    }
    return v;
  }

  /** Edge-triggered read: true only on the frame Space was pressed. */
  consumeDive(): boolean {
    const v = this.divePending;
    this.divePending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame Q was pressed. Auto-repeat
   * from holding the key down is filtered out, so holding Q cannot machine-gun
   * a jump and its smash in consecutive frames - each hit needs its own press. */
  consumeQ(): boolean {
    const v = this.qPending;
    this.qPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame E was pressed. */
  consumePass(): boolean {
    const v = this.passPending;
    this.passPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame F was pressed. */
  consumeHit(): boolean {
    const v = this.hitPending;
    this.hitPending = false;
    return v;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.code in MOVE_KEYS) {
      this.held.add(e.code);
      e.preventDefault();
      return;
    }

    // Auto-repeat must not produce fresh action edges.
    if (e.repeat) return;

    switch (e.code) {
      case 'Space':
        this.divePending = true;
        e.preventDefault(); // Space would otherwise scroll the page
        break;
      case 'KeyQ':
        this.qPending = true;
        e.preventDefault();
        break;
      case 'KeyE':
        this.passPending = true;
        e.preventDefault();
        break;
      case 'KeyF':
        this.hitPending = true;
        e.preventDefault();
        break;
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.held.delete(e.code);
  };

  private onBlur = (): void => {
    this.held.clear();
  };
}
