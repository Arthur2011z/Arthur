import { Vec2 } from '../utils/math';

// A swipe must cover at least this many CSS px from its pointerdown origin...
const MIN_SWIPE_DISTANCE_PX = 40;
// ...within this many ms of the pointerdown, or it's ignored (too slow/held).
const MAX_SWIPE_DURATION_MS = 600;

/**
 * Recognizes a swipe gesture directly on the game canvas - the one and only
 * gesture surface in the game (Hechten in Player.active, and the spike's
 * aim-swipe in Player.slowmo_aim; which one applies is decided by whoever
 * reads the emitted direction, based on the player's current state).
 *
 * Attached to the canvas element itself, not the #overlay div: #overlay has
 * pointer-events:none except on its direct children (the joystick hit-zone,
 * the three buttons), so a touch starting on any of those never reaches the
 * canvas - no extra exclusion logic needed here for "don't swipe on the
 * controls".
 *
 * Recognition fires as soon as the movement threshold is crossed (not only on
 * pointerup), so it reads instantly even inside the brief slow-motion aiming
 * window. One emission per pointer id; a further move of the same pointer
 * after that is ignored until a fresh pointerdown starts a new gesture.
 */
export class SwipeInput {
  private pending: Vec2 | null = null;

  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;
  private emitted = false;

  constructor(private readonly surface: HTMLElement) {
    this.surface.addEventListener('pointerdown', this.onPointerDown);
  }

  /** Edge-triggered read: the swipe direction recognized this frame, or null. */
  consumeSwipe(): Vec2 | null {
    const v = this.pending;
    this.pending = null;
    return v;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startTime = performance.now();
    this.emitted = false;
    this.surface.setPointerCapture(e.pointerId);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerEnd);
    this.surface.addEventListener('pointercancel', this.onPointerEnd);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId || this.emitted) return;

    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dist = Math.hypot(dx, dy);
    const elapsed = performance.now() - this.startTime;
    if (dist < MIN_SWIPE_DISTANCE_PX || elapsed > MAX_SWIPE_DURATION_MS) return;

    this.emitted = true;
    this.pending = { x: dx / dist, y: dy / dist };
  };

  private onPointerEnd = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerEnd);
    this.surface.removeEventListener('pointercancel', this.onPointerEnd);
  };
}
