/** requestAnimationFrame-driven loop with clamped delta-time (avoids a "spiral of
 * death" after the tab is backgrounded and resumes with a huge elapsed gap). */
export class GameLoop {
  private rafId = 0;
  private lastTime = 0;

  constructor(private readonly tick: (dt: number, nowMs: number) => void) {}

  start(): void {
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    cancelAnimationFrame(this.rafId);
  }

  private frame = (time: number): void => {
    const dt = Math.min((time - this.lastTime) / 1000, 0.05);
    this.lastTime = time;
    this.tick(dt, time);
    this.rafId = requestAnimationFrame(this.frame);
  };
}
