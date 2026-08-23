import { Vec2, lerpVec2 } from '../utils/math';
import { COURT_WIDTH, NET_Y } from '../game/constants';

export type BallToucher = 'player' | 'teammate' | 'opponent1' | 'opponent2' | null;
/** 'idle': resting, untouched, ready for the next serve (scoring reacts to
 * reaching this from 'flying'). 'flying': in a parabolic arc. 'held': briefly
 * frozen mid-air by a successful dive-catch, on its way to being relaunched -
 * distinct from 'idle' precisely so that transient freeze isn't mistaken for a
 * real landing. */
export type BallFlightState = 'idle' | 'flying' | 'held';

export interface LaunchOptions {
  duration: number;
  peakHeight: number;
  toucher: BallToucher;
}

/**
 * Simple parabolic flight: linear interpolation in x/y, a parabola in height (no
 * aerodynamics). One formula drives every shot type in the game — only duration,
 * peak height and target differ (see the callers of launch()).
 *
 * A relaunch (a teammate/opponent/player contacting a still-flying ball) always
 * starts from the ball's own live position and height at that instant — never
 * from the catcher's position — so the trajectory stays visually continuous
 * instead of snapping. Position continuity comes from callers passing `pos` as
 * the new `from`; height continuity is handled here: `launch()` carries over
 * whatever height the ball already had into `initialHeight`, which decays
 * linearly to 0 over the new flight, blended with the new arc's own parabola.
 */
export class Ball {
  pos: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y };
  /** Visual-only vertical offset (not part of the 2D court plane). */
  height = 0;
  state: BallFlightState = 'idle';
  target: Vec2 = { ...this.pos };
  lastToucher: BallToucher = null;

  private start: Vec2 = { ...this.pos };
  private flightDuration = 0;
  private elapsed = 0;
  private peakHeight = 0;
  /** Height at the moment of launch (0 for a fresh serve off the ground; the
   * ball's own current height if it was still airborne when caught/redirected). */
  private initialHeight = 0;

  launch(from: Vec2, to: Vec2, opts: LaunchOptions): void {
    this.initialHeight = this.height;
    this.start = { ...from };
    this.target = { ...to };
    this.pos = { ...from };
    this.flightDuration = opts.duration;
    this.elapsed = 0;
    this.peakHeight = opts.peakHeight;
    this.state = 'flying';
    this.lastToucher = opts.toucher;
    this.height = this.initialHeight; // stays visually continuous this same frame
  }

  update(dt: number): void {
    if (this.state !== 'flying') return;
    this.elapsed = Math.min(this.elapsed + dt, this.flightDuration);
    const u = this.flightDuration > 0 ? this.elapsed / this.flightDuration : 1;
    this.pos = lerpVec2(this.start, this.target, u);
    this.height = this.peakHeight * 4 * u * (1 - u) + this.initialHeight * (1 - u);
    if (u >= 1) {
      this.state = 'idle';
    }
  }

  /** Seconds left before this flight reaches its target; 0 when not flying. */
  get timeRemaining(): number {
    return this.state === 'flying' ? Math.max(0, this.flightDuration - this.elapsed) : 0;
  }

  /** Total duration of the current flight, as launched (independent of how
   * far into it we are) - a proxy for how fast/hard this particular shot
   * was hit, since every shot type in the game uses a fixed duration (see
   * the callers of launch()): short = fast/hard, long = soft/easy. */
  get duration(): number {
    return this.flightDuration;
  }
}
