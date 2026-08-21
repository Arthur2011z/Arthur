const BUTTON_SIZE = 88; // px
const JUMP_BUTTON_SIZE = 72; // px, slightly smaller/secondary

const ENABLED_OPACITY = '1';
const DISABLED_OPACITY = '0.4';

/** Hit/jump action buttons, bottom-right. Jump sits just above-left of Hit and
 * is only usable near the net (see setJumpEnabled(), driven each frame from
 * player position) - visually dimmed and inert otherwise. */
export class Buttons {
  private hitPending = false;
  private jumpPending = false;
  private readonly hitEl: HTMLButtonElement;
  private readonly jumpEl: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.hitEl = document.createElement('button');
    this.hitEl.id = 'hit-btn';
    this.hitEl.type = 'button';
    this.hitEl.textContent = 'Schlag';
    Object.assign(this.hitEl.style, {
      position: 'absolute',
      right: '24px',
      bottom: 'max(24px, env(safe-area-inset-bottom))',
      width: `${BUTTON_SIZE}px`,
      height: `${BUTTON_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(230, 57, 70, 0.85)',
      color: '#fff',
      font: '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.jumpEl = document.createElement('button');
    this.jumpEl.id = 'jump-btn';
    this.jumpEl.type = 'button';
    this.jumpEl.textContent = 'Sprung';
    Object.assign(this.jumpEl.style, {
      position: 'absolute',
      right: `${24 + (BUTTON_SIZE - JUMP_BUTTON_SIZE) / 2}px`,
      bottom: `calc(max(24px, env(safe-area-inset-bottom)) + ${BUTTON_SIZE + 16}px)`,
      width: `${JUMP_BUTTON_SIZE}px`,
      height: `${JUMP_BUTTON_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(38, 70, 83, 0.85)',
      color: '#fff',
      font: '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
      opacity: DISABLED_OPACITY,
      pointerEvents: 'none',
      transition: 'opacity 0.1s linear',
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(this.hitEl);
    container.appendChild(this.jumpEl);
    this.hitEl.addEventListener('pointerdown', this.onHitPointerDown);
    this.jumpEl.addEventListener('pointerdown', this.onJumpPointerDown);
  }

  /** Called every frame from game state: enables/dims the Jump button to match
   * whether the player is currently close enough to the net to use it. */
  setJumpEnabled(enabled: boolean): void {
    this.jumpEl.style.opacity = enabled ? ENABLED_OPACITY : DISABLED_OPACITY;
    this.jumpEl.style.pointerEvents = enabled ? 'auto' : 'none';
  }

  /** Edge-triggered read: true only on the frame Hit was pressed. */
  consumeHit(): boolean {
    const v = this.hitPending;
    this.hitPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame Jump was pressed. */
  consumeJump(): boolean {
    const v = this.jumpPending;
    this.jumpPending = false;
    return v;
  }

  private onHitPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.hitPending = true;
  };

  private onJumpPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.jumpPending = true;
  };
}
