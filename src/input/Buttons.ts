const BUTTON_SIZE = 88; // px

/**
 * Hit/jump action buttons, bottom-right. Only the Hit button exists for now;
 * step 4 adds Jump to this same file (positioned just above-left of Hit) rather
 * than restructuring it.
 */
export class Buttons {
  private hitPending = false;
  private readonly hitEl: HTMLButtonElement;

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

    container.appendChild(this.hitEl);
    this.hitEl.addEventListener('pointerdown', this.onHitPointerDown);
  }

  /** Non-null-safe edge-triggered read: true only on the frame Hit was pressed. */
  consumeHit(): boolean {
    const v = this.hitPending;
    this.hitPending = false;
    return v;
  }

  private onHitPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.hitPending = true;
  };
}
