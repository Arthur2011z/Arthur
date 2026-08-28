import { ActionType, PressedAction } from './actions';

export type ButtonMode = 'play' | 'serve';

const EDGE = 22; // px from the screen edge
const SAFE_BOTTOM = `max(${EDGE}px, calc(env(safe-area-inset-bottom) + 12px))`;

interface ButtonSpec {
  id: string;
  label: string;
  action: ActionType;
  size: number;
  color: string;
  /** Offsets in px from the bottom-right corner of the safe area. */
  right: number;
  bottom: number;
}

/** The primary jump button anchors the cluster; everything else is placed
 * relative to it so the whole group can be resized from one number. */
const JUMP_SIZE = 92;
const BLOCK_SIZE = 76;
const PASS_SIZE = 80;
const EMERGENCY_SIZE = 62;
const GAP = 12;

const PLAY_BUTTONS: ButtonSpec[] = [
  {
    id: 'jump-btn',
    label: 'Schmettern',
    action: 'jump',
    size: JUMP_SIZE,
    color: 'rgba(230, 57, 70, 0.88)',
    right: 0,
    bottom: 0,
  },
  {
    id: 'block-btn',
    label: 'Block',
    action: 'block',
    size: BLOCK_SIZE,
    color: 'rgba(38, 70, 83, 0.88)',
    right: (JUMP_SIZE - BLOCK_SIZE) / 2,
    bottom: JUMP_SIZE + GAP,
  },
  {
    id: 'pass-btn',
    label: 'Pass',
    action: 'pass',
    size: PASS_SIZE,
    color: 'rgba(42, 157, 143, 0.88)',
    right: JUMP_SIZE + GAP,
    bottom: (JUMP_SIZE - PASS_SIZE) / 2,
  },
  {
    id: 'emergency-btn',
    label: 'Notfall',
    action: 'emergency',
    size: EMERGENCY_SIZE,
    color: 'rgba(233, 150, 55, 0.88)',
    right: JUMP_SIZE + GAP + PASS_SIZE + GAP,
    bottom: (JUMP_SIZE - EMERGENCY_SIZE) / 2,
  },
];

const SERVE_BUTTON: ButtonSpec = {
  id: 'serve-btn',
  label: 'Aufschlag',
  action: 'jump',
  size: 108,
  color: 'rgba(230, 57, 70, 0.9)',
  right: 0,
  bottom: 0,
};

/**
 * The touch action cluster, bottom-right.
 *
 * Two mutually exclusive layouts: during a rally all four action buttons are
 * shown; while this player is holding serve every one of them is hidden and a
 * single Aufschlag button takes their place, so nothing can be pressed that
 * would race the serve. The serve button emits the same 'jump' action the
 * Schmettern button does - the serve *is* a jump, and one action means one
 * code path down to the actual ball contact.
 */
export class Buttons {
  private pressed: PressedAction[] = [];
  private readonly playEls: HTMLButtonElement[];
  private readonly serveEl: HTMLButtonElement;
  private mode: ButtonMode = 'play';

  constructor(
    container: HTMLElement,
    private readonly onActivity: () => void,
  ) {
    this.playEls = PLAY_BUTTONS.map((spec) => this.createButton(container, spec));
    this.serveEl = this.createButton(container, SERVE_BUTTON);
    this.setMode('play');
  }

  setMode(mode: ButtonMode): void {
    this.mode = mode;
    for (const el of this.playEls) el.style.display = mode === 'play' ? 'block' : 'none';
    this.serveEl.style.display = mode === 'serve' ? 'block' : 'none';
  }

  /** Edge-triggered read: the actions newly pressed since the last call. */
  consumePressed(): PressedAction[] {
    const actions = this.pressed;
    this.pressed = [];
    return actions;
  }

  private createButton(container: HTMLElement, spec: ButtonSpec): HTMLButtonElement {
    const el = document.createElement('button');
    el.id = spec.id;
    el.type = 'button';
    el.textContent = spec.label;
    Object.assign(el.style, {
      position: 'absolute',
      right: `${EDGE + spec.right}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${spec.bottom}px)`,
      width: `${spec.size}px`,
      height: `${spec.size}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: spec.color,
      color: '#fff',
      font: `600 ${Math.round(spec.size / 6.2)}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`,
      touchAction: 'none',
      cursor: 'pointer',
      // The layer holding the controls is pointer-transparent so taps on bare
      // sand reach the swipe surface; the controls themselves opt back in.
      pointerEvents: 'auto',
    } satisfies Partial<CSSStyleDeclaration>);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation(); // never let a button press start a swipe as well
      this.pressed.push({ action: spec.action, at: performance.now() });
      this.onActivity();
    });

    container.appendChild(el);
    return el;
  }

  /** Exposed for tests and the HUD's control hints. */
  get currentMode(): ButtonMode {
    return this.mode;
  }
}
