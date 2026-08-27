const JUMP_SIZE = 88; // px, primary action - jump-smash
const PASS_SIZE = 76; // px, primary action - controlled pass
const DIVE_SIZE = 68; // px, primary action - Hechten
const HIT_SIZE = 56; // px, secondary/"emergency" action - small on purpose
const SERVE_SIZE = 104; // px, the only button on screen while serving - big and unmissable

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
 * aim the spike during the Jump-Smash's slow-motion window.
 *
 * While the human team is preparing to serve, all four are hidden and a single
 * Aufschlag button takes their place (see setServeMode) - so there is exactly
 * one thing to press, and no way to accidentally fire an action that has no
 * meaning at the baseline. */
export class Buttons {
  private jumpPending = false;
  private passPending = false;
  private divePending = false;
  private hitPending = false;
  private servePending = false;

  private readonly jumpEl: HTMLButtonElement;
  private readonly passEl: HTMLButtonElement;
  private readonly diveEl: HTMLButtonElement;
  private readonly hitEl: HTMLButtonElement;
  private readonly serveEl: HTMLButtonElement;
  /** Mirrors the DOM so setServeMode is a no-op on the vast majority of frames
   * (it is called every frame from the game loop). */
  private serveMode = false;

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

    // The serve button sits where the thumb already is - centred over the
    // Schmetter/Pass pair, since it is the only button on screen while it is
    // shown. Hidden by default; the game switches it on (see setServeMode).
    this.serveEl = document.createElement('button');
    this.serveEl.id = 'serve-btn';
    this.serveEl.type = 'button';
    this.serveEl.textContent = 'Aufschlag';
    Object.assign(this.serveEl.style, {
      position: 'absolute',
      right: `${EDGE + (JUMP_SIZE + GAP + PASS_SIZE - SERVE_SIZE) / 2}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${(JUMP_SIZE - SERVE_SIZE) / 2}px)`,
      width: `${SERVE_SIZE}px`,
      height: `${SERVE_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.7)',
      background: 'rgba(233, 196, 106, 0.9)',
      color: '#264653',
      font: '700 16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
      display: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(this.passEl);
    container.appendChild(this.hitEl);
    container.appendChild(this.diveEl);
    container.appendChild(this.jumpEl);
    container.appendChild(this.serveEl);
    this.jumpEl.addEventListener('pointerdown', this.onJumpPointerDown);
    this.passEl.addEventListener('pointerdown', this.onPassPointerDown);
    this.diveEl.addEventListener('pointerdown', this.onDivePointerDown);
    this.hitEl.addEventListener('pointerdown', this.onHitPointerDown);
    this.serveEl.addEventListener('pointerdown', this.onServePointerDown);
  }

  /** Serve UI: exactly one button on screen, and the four normal actions gone
   * - not merely greyed out. Idempotent, so the game loop can call it on every
   * frame. Any press still pending on a button that is about to disappear is
   * dropped: it belonged to the other UI. */
  setServeMode(active: boolean): void {
    if (active === this.serveMode) return;
    this.serveMode = active;

    const normal = active ? 'none' : '';
    this.jumpEl.style.display = normal;
    this.passEl.style.display = normal;
    this.diveEl.style.display = normal;
    this.hitEl.style.display = normal;
    this.serveEl.style.display = active ? '' : 'none';

    this.jumpPending = false;
    this.passPending = false;
    this.divePending = false;
    this.hitPending = false;
    this.servePending = false;
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

  /** Edge-triggered read: true only on the frame the Aufschlag button was
   * pressed. */
  consumeServe(): boolean {
    const v = this.servePending;
    this.servePending = false;
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

  private onServePointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.servePending = true;
  };
}
