import { Vec2 } from '../utils/math';
import { COURT_FILL, COURT_LENGTH, COURT_WIDTH, Z_SCREEN_FACTOR } from './constants';

export type Orientation = 'portrait' | 'landscape';

/**
 * The single place that knows how court space maps onto the screen.
 *
 * The court is 8m x 16m - upright. On a phone held vertically that fits the
 * screen directly (net horizontal, the human team at the bottom). On a wide
 * screen it would leave most of the display empty, so the whole court is
 * rotated a quarter turn instead (net vertical, the human team on the left)
 * and fills the viewport just as well.
 *
 * Gameplay code never sees this. It works purely in court space and calls
 * toScreen() to draw and screenToCourt() to interpret input, so the rotation
 * costs the rest of the game nothing.
 */
export class Court {
  orientation: Orientation = 'portrait';
  /** CSS pixels per court meter. */
  scale = 1;
  /** CSS-pixel offset of the court's top-left corner within the viewport. */
  offset: Vec2 = { x: 0, y: 0 };
  /** Viewport size in CSS pixels (the canvas always covers it completely). */
  viewport: Vec2 = { x: 0, y: 0 };

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    this.viewport = { x: vw, y: vh };
    this.orientation = vw > vh ? 'landscape' : 'portrait';

    // Footprint of the court on screen, before scaling: rotated a quarter turn
    // in landscape, so the long axis follows the long axis of the display.
    const footprint =
      this.orientation === 'landscape'
        ? { x: COURT_LENGTH, y: COURT_WIDTH }
        : { x: COURT_WIDTH, y: COURT_LENGTH };

    this.scale = Math.min(vw / footprint.x, vh / footprint.y) * COURT_FILL;
    this.offset = {
      x: (vw - footprint.x * this.scale) / 2,
      y: (vh - footprint.y * this.scale) / 2,
    };

    this.canvas.style.width = `${vw}px`;
    this.canvas.style.height = `${vh}px`;
    this.canvas.width = Math.round(vw * dpr);
    this.canvas.height = Math.round(vh * dpr);

    // Everything is drawn in CSS pixels; the only transform is the device
    // pixel ratio. Court-space -> pixel conversion is toScreen()'s job.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** Court-space ground position -> CSS-pixel screen position. */
  toScreen(pos: Vec2): Vec2 {
    if (this.orientation === 'landscape') {
      // Quarter turn: the human baseline (y = COURT_LENGTH) ends up on the
      // left, the opponents' baseline (y = 0) on the right.
      return {
        x: this.offset.x + (COURT_LENGTH - pos.y) * this.scale,
        y: this.offset.y + pos.x * this.scale,
      };
    }
    return {
      x: this.offset.x + pos.x * this.scale,
      y: this.offset.y + pos.y * this.scale,
    };
  }

  /**
   * Screen offset that represents `z` meters of height.
   *
   * In portrait that is simply "up the screen". In landscape it cannot be:
   * the net line runs vertically there, so an upward offset would be parallel
   * to the net itself and the net's height would collapse into a single line.
   * The lift is therefore tilted toward the human baseline (screen-left) as
   * well, which keeps it perpendicular enough to the net to stay readable and
   * still reads as a jump for the figures.
   *
   * Everything with a height uses this one function - the net, the players and
   * the ball - so "is the ball above the net?" is answered the same way on
   * screen as it is in the physics.
   */
  heightOffset(z: number): Vec2 {
    const h = z * this.scale * Z_SCREEN_FACTOR;
    if (this.orientation === 'landscape') return { x: -h * 0.92, y: -h * 0.38 };
    return { x: 0, y: -h };
  }

  /** Court-space position plus a height -> CSS-pixel screen position. */
  toScreenElevated(pos: Vec2, z: number): Vec2 {
    const ground = this.toScreen(pos);
    const lift = this.heightOffset(z);
    return { x: ground.x + lift.x, y: ground.y + lift.y };
  }

  /**
   * Screen-space direction (as the player perceives it: up on the display is
   * {0,-1}) -> court-space direction. The inverse of the rotation applied by
   * toScreen(), so "push up" always means "toward the far end of the court"
   * in portrait and "push right" always means "toward the net" in landscape.
   */
  screenToCourt(dir: Vec2): Vec2 {
    if (this.orientation === 'landscape') {
      return { x: dir.y, y: -dir.x };
    }
    return { ...dir };
  }
}
