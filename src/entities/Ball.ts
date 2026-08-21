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
 */
export class Ball {
  pos: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y };
  /** Visual-only vertical offset (not part of the 2D court plane). */
  height = 0;
  state: BallFlightState = 'idle';
  target: Vec2 = { ...this.pos };
  lastToucher: BallToucher = null;

  private start: Vec2 = { ...this.pos };
  private duration = 0;
  private elapsed = 0;
  private peakHeight = 0;

  launch(from: Vec2, to: Vec2, opts: LaunchOptions): void {
    this.start = { ...from };
    this.target = { ...to };
    this.pos = { ...from };
    this.height = 0;
    this.duration = opts.duration;
    this.elapsed = 0;
    this.peakHeight = opts.peakHeight;
    this.state = 'flying';
    this.lastToucher = opts.toucher;
  }

  update(dt: number): void {
    if (this.state !== 'flying') return;
    this.elapsed = Math.min(this.elapsed + dt, this.duration);
    const u = this.duration > 0 ? this.elapsed / this.duration : 1;
    this.pos = lerpVec2(this.start, this.target, u);
    this.height = this.peakHeight * 4 * u * (1 - u);
    if (u >= 1) {
      this.state = 'idle';
    }
  }

  /** Seconds left before this flight reaches its target; 0 when not flying. */
  get timeRemaining(): number {
    return this.state === 'flying' ? Math.max(0, this.duration - this.elapsed) : 0;
  }
}
