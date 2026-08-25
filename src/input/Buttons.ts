const JUMP_SIZE = 88; // px, primary action - jump-smash
const PASS_SIZE = 76; // px, primary action - controlled pass
const DIVE_SIZE = 68; // px, primary action - Hechten
const HIT_SIZE = 56; // px, secondary/"emergency" action - small on purpose

const GAP = 14; // px, between Jump and Pass
const EDGE = 24; // px, from the screen edge
const ROW_GAP = 16; // px, between the bottom row and the row above it
const SAFE_BOTTOM = `max(${EDGE}px, env(safe-area-inset-bottom))`;

/** The four action buttons, bottom-right, in two rows - all reachable by
 * thumb without moving the hand:
 *
 *   [ Hechten ]  [ Notfall ]     <- upper row
 *   [  Pass   ]  [ Schmetter ]   <- bottom row (Schmetter in the corner)
 *
 * These are the only discrete button presses in the game. The swipe gesture
 * (SwipeInput) is no longer an input for Hechten - it now serves solely to
 * aim the spike during the Jump-Smash's slow-motion window. */
export class Buttons {
  private jumpPending = false;
  private passPending = false;
  private divePending = false;
  private hitPending = false;

  private readonly jumpEl: HTMLButtonElement;
  private readonly passEl: HTMLButtonElement;
  private readonly diveEl: HTMLButtonElement;
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
      bottom: `calc(${SAFE_BOTTOM} + ${JUMP_SIZE + ROW_GAP}px)`,
      width: `${HIT_SIZE}px`,
      height: `${HIT_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(38, 70, 83, 0.85)',
      color: '#fff',
      font: '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    // Upper row, left of Notfall - centered over Pass, the same row height as
    // Notfall so the two read as one row.
    this.diveEl = document.createElement('button');
    this.diveEl.id = 'dive-btn';
    this.diveEl.type = 'button';
    this.diveEl.textContent = 'Hechten';
    Object.assign(this.diveEl.style, {
      position: 'absolute',
      right: `${EDGE + JUMP_SIZE + GAP + (PASS_SIZE - DIVE_SIZE) / 2}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${JUMP_SIZE + ROW_GAP}px)`,
      width: `${DIVE_SIZE}px`,
      height: `${DIVE_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(244, 162, 97, 0.85)',
      color: '#fff',
      font: '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(this.passEl);
    container.appendChild(this.hitEl);
    container.appendChild(this.diveEl);
    container.appendChild(this.jumpEl);
    this.jumpEl.addEventListener('pointerdown', this.onJumpPointerDown);
    this.passEl.addEventListener('pointerdown', this.onPassPointerDown);
    this.diveEl.addEventListener('pointerdown', this.onDivePointerDown);
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

  /** Edge-triggered read: true only on the frame the Hechten button was
   * pressed. */
  consumeDive(): boolean {
    const v = this.divePending;
    this.divePending = false;
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

  private onDivePointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.divePending = true;
  };

  private onHitPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.hitPending = true;
  };
}
