import { COURT_LENGTH, COURT_OVERSCAN_CAP, COURT_WIDTH } from './constants';

/**
 * Sizes and positions the canvas (and, by extension, the DOM overlay that sits on
 * top of it) so that the court's fixed aspect ratio (COURT_WIDTH:COURT_LENGTH) is
 * always preserved via letterboxing, and the net stays horizontal regardless of
 * device orientation. After calling resize(), the canvas context's transform is set
 * up so that all drawing code can use raw court-unit coordinates directly (e.g.
 * ctx.arc(player.pos.x, player.pos.y, PLAYER_RADIUS, 0, Math.PI * 2)).
 */
export class Court {
  /** CSS pixels per court unit (meter), after fit-to-viewport scaling. */
  pixelsPerUnit = 1;

  constructor(
    private readonly viewportEl: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D,
  ) {}

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const courtAspect = COURT_WIDTH / COURT_LENGTH;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const [containW, containH] =
      vw / vh > courtAspect ? [vh * courtAspect, vh] : [vw, vw / courtAspect];

    // Beyond a strict aspect-locked "contain" fit, scale up a bit further
    // (like object-fit: cover) so the court reads as bigger/edge-to-edge on
    // off-ratio viewports, capped so it can never crop into legitimately
    // reachable play area (players stay clamped >= PLAYER_RADIUS from the
    // true edge regardless). #viewport's overflow:hidden clips the overscan.
    const coverRatio = Math.max(vw / containW, vh / containH);
    const overscan = Math.min(coverRatio, COURT_OVERSCAN_CAP);
    const cssW = containW * overscan;
    const cssH = containH * overscan;

    this.viewportEl.style.width = `${vw}px`;
    this.viewportEl.style.height = `${vh}px`;

    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.canvas.style.left = `${(vw - cssW) / 2}px`;
    this.canvas.style.top = `${(vh - cssH) / 2}px`;

    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);

    const scale = (cssW / COURT_WIDTH) * dpr;
    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);

    this.pixelsPerUnit = cssW / COURT_WIDTH;
  }

  /** CSS-pixel bounding box of the canvas within the viewport, for overlay positioning. */
  getCanvasRect(): { left: number; top: number; width: number; height: number } {
    return this.canvas.getBoundingClientRect();
  }
}
