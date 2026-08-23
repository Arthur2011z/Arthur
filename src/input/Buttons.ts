const JUMP_SIZE = 88; // px, primary action - jump-smash
const PASS_SIZE = 76; // px, primary action - controlled pass
const HIT_SIZE = 56; // px, secondary/"emergency" action - small on purpose

const GAP = 14; // px, between Jump and Pass
const EDGE = 24; // px, from the screen edge
const SAFE_BOTTOM = `max(${EDGE}px, env(safe-area-inset-bottom))`;

/** The three action buttons, bottom-right: Sprung-Schmetterschlag (jump) sits
 * in the corner as the biggest, most-used button, Pass to its left, the small
 * Notfall-Schlag (hit) above - reachable by thumb without moving the hand.
 * These are the only three discrete button presses in the game; Hechten and
 * the spike's aim direction are handled entirely by SwipeInput instead. */
export class Buttons {
  private jumpPending = false;
  private passPending = false;
  private hitPending = false;

  private readonly jumpEl: HTMLButtonElement;
  private readonly passEl: HTMLButtonElement;
  private readonly hitEl: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.jumpEl = document.createElement('button');
    this.jumpEl.id = 'jump-btn';
    this.jumpEl.type = 'button';
    this.jumpEl.textContent = 'Schmetter';
    Object.assign(this.jumpEl.style, {
      position: 'absolute',
      right: `${EDGE}px`,
      bottom: SAFE_BOTTOM,
      width: `${JUMP_SIZE}px`,
      height: `${JUMP_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(230, 57, 70, 0.85)',
      color: '#fff',
      font: '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.passEl = document.createElement('button');
    this.passEl.id = 'pass-btn';
    this.passEl.type = 'button';
    this.passEl.textContent = 'Pass';
    Object.assign(this.passEl.style, {
      position: 'absolute',
      right: `${EDGE + JUMP_SIZE + GAP}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${(JUMP_SIZE - PASS_SIZE) / 2}px)`,
      width: `${PASS_SIZE}px`,
      height: `${PASS_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(42, 157, 143, 0.85)',
      color: '#fff',
      font: '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.hitEl = document.createElement('button');
    this.hitEl.id = 'hit-btn';
    this.hitEl.type = 'button';
    this.hitEl.textContent = 'Notfall';
    Object.assign(this.hitEl.style, {
      position: 'absolute',
      right: `${EDGE + (JUMP_SIZE - HIT_SIZE) / 2}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${JUMP_SIZE + 16}px)`,
      width: `${HIT_SIZE}px`,
      height: `${HIT_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(38, 70, 83, 0.85)',
      color: '#fff',
      font: '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(this.passEl);
    container.appendChild(this.hitEl);
    container.appendChild(this.jumpEl);
    this.jumpEl.addEventListener('pointerdown', this.onJumpPointerDown);
    this.passEl.addEventListener('pointerdown', this.onPassPointerDown);
    this.hitEl.addEventListener('pointerdown', this.onHitPointerDown);
  }

  /** Edge-triggered read: true only on the frame the Jump-Smash button was
   * just pressed. */
  consumeJump(): boolean {
    const v = this.jumpPending;
    this.jumpPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame Pass was pressed. */
  consumePass(): boolean {
    const v = this.passPending;
    this.passPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame the Notfall-Schlag was
   * pressed. */
  consumeHit(): boolean {
    const v = this.hitPending;
    this.hitPending = false;
    return v;
  }

  private onJumpPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.jumpPending = true;
  };

  private onPassPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.passPending = true;
  };

  private onHitPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.hitPending = true;
  };
}
