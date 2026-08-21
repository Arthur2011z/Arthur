import { Vec2, normalize } from '../utils/math';
import {
  SWIPE_MAX_DURATION_S,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MIN_VELOCITY_PX_S,
} from '../game/constants';

/**
 * Detects a quick drag ("swipe") directly on the play field, used to trigger a
 * dive. Attached to the canvas itself: since the joystick and (later) the hit/jump
 * buttons are real, higher DOM elements layered on top, a touch that starts on
 * one of them never reaches this listener — no manual coordinate-exclusion math
 * needed.
 */
export class SwipeDetector {
  private pending: Vec2 | null = null;
  private pointerId: number | null = null;
  private startX = 0;
  private startY = 0;
  private startTime = 0;

  constructor(private readonly surface: HTMLElement) {
    this.surface.style.touchAction = 'none';
    this.surface.addEventListener('pointerdown', this.onPointerDown);
  }

  /** Returns the most recently detected swipe direction (normalized) and clears
   * it — an edge-triggered event, consumed at most once per gesture. */
  consume(): Vec2 | null {
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
    this.surface.setPointerCapture(e.pointerId);
    this.surface.addEventListener('pointerup', this.onPointerUp);
    this.surface.addEventListener('pointercancel', this.onPointerCancel);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    const dist = Math.hypot(dx, dy);
    const elapsed = (performance.now() - this.startTime) / 1000;
    if (
      dist >= SWIPE_MIN_DISTANCE_PX &&
      elapsed <= SWIPE_MAX_DURATION_S &&
      dist / elapsed >= SWIPE_MIN_VELOCITY_PX_S
    ) {
      // Screen space maps 1:1 to game space here: both axes grow in the same
      // direction (down/right), and the canvas is scaled uniformly.
      this.pending = normalize({ x: dx, y: dy });
    }
    this.cleanup();
  };

  private onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.cleanup();
  };

  private cleanup(): void {
    this.pointerId = null;
    this.surface.removeEventListener('pointerup', this.onPointerUp);
    this.surface.removeEventListener('pointercancel', this.onPointerCancel);
  }
}
