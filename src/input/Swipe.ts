import { Vec2, normalize } from '../utils/math';

/** Finger travel (px) that counts as a full-strength swipe. */
const FULL_STRENGTH_PX = 160;
/** Below this the gesture was a tap, not a swipe - reported with zero direction. */
const MIN_SWIPE_PX = 18;

interface RawSwipe {
  /** Screen-space direction (up on the display is {0,-1}). */
  dir: Vec2;
  strength: number;
}

/**
 * Swipe surface covering the playfield. Used only for aiming an attack while
 * airborne: the live drag steers the trajectory preview, and releasing the
 * finger is the touch equivalent of pressing the hit trigger a second time.
 *
 * It sits *behind* the joystick and the action buttons in the overlay, so a
 * touch that starts on a control is consumed by that control and never
 * reaches here.
 */
export class Swipe {
  private pointerId: number | null = null;
  private origin: Vec2 = { x: 0, y: 0 };
  private current: RawSwipe | null = null;
  private released: RawSwipe | null = null;

  constructor(
    private readonly surface: HTMLElement,
    private readonly onActivity: () => void,
  ) {
    this.surface.addEventListener('pointerdown', this.onPointerDown);
  }

  /** The drag in progress right now, or null. */
  get active(): RawSwipe | null {
    return this.current;
  }

  /** Edge-triggered read: the swipe released since the last call, if any. */
  consumeRelease(): RawSwipe | null {
    const v = this.released;
    this.released = null;
    return v;
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.origin = { x: e.clientX, y: e.clientY };
    this.current = { dir: { x: 0, y: 0 }, strength: 0 };
    this.surface.setPointerCapture(e.pointerId);
    this.surface.addEventListener('pointermove', this.onPointerMove);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerUp);
    this.onActivity();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.current = this.measure(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.released = this.measure(e);
    this.current = null;
    this.pointerId = null;
    this.surface.removeEventListener('pointermove', this.onPointerMove);
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerUp);
  };

  private measure(e: PointerEvent): RawSwipe {
    const dx = e.clientX - this.origin.x;
    const dy = e.clientY - this.origin.y;
    const travelled = Math.hypot(dx, dy);
    if (travelled < MIN_SWIPE_PX) return { dir: { x: 0, y: 0 }, strength: 0 };
    return {
      dir: normalize({ x: dx, y: dy }),
      strength: Math.min(1, travelled / FULL_STRENGTH_PX),
    };
  }
}
