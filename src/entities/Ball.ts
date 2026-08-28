import { Vec2, Vec3 } from '../utils/math';
import { BALL_RADIUS, CONTACT_LOCK, COURT_WIDTH, NET_Y } from '../game/constants';
import { AthleteId } from './Athlete';

/**
 * 'dead'  - out of play, waiting for the next serve.
 * 'held'  - resting in a server's hand: it tracks them and ignores gravity.
 * 'live'  - a real projectile, moving under gravity.
 */
export type BallState = 'dead' | 'held' | 'live';

/**
 * The ball carries a position and a velocity, and nothing else moves it: while
 * it is live, only Physics.advance() ever changes its position, one fixed
 * substep at a time. There is no interpolation toward a predetermined landing
 * spot anywhere in the game, which is why the flight path is always a real
 * parabola, a shot can genuinely land out, and the aiming preview can be
 * computed by running the very same integrator forward.
 */
export class Ball {
  pos: Vec3 = { x: COURT_WIDTH / 2, y: NET_Y, z: BALL_RADIUS };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  state: BallState = 'dead';
  radius = BALL_RADIUS;

  /** Who touched it last. Drives the double-contact rule and, once a rally
   * ends, decides which team conceded the point. */
  lastToucher: AthleteId | null = null;
  /** Seconds of immunity left after a contact - see CONTACT_LOCK. */
  contactLock = 0;

  /** Sends the ball off from `origin` with `velocity`. The only way a live
   * ball's motion ever changes. */
  strike(origin: Vec3, velocity: Vec3, toucher: AthleteId | null): void {
    this.pos = { ...origin };
    this.vel = { ...velocity };
    this.state = 'live';
    this.lastToucher = toucher;
    this.contactLock = CONTACT_LOCK;
  }

  /** Parks the ball in a server's hand: no gravity, no contact, position owned
   * by whoever is holding it. */
  hold(at: Vec3): void {
    this.pos = { ...at };
    this.vel = { x: 0, y: 0, z: 0 };
    this.state = 'held';
    this.contactLock = 0;
  }

  /** Takes the ball out of play where it lies. */
  kill(): void {
    this.state = 'dead';
    this.vel = { x: 0, y: 0, z: 0 };
  }

  reset(): void {
    this.pos = { x: COURT_WIDTH / 2, y: NET_Y, z: BALL_RADIUS };
    this.vel = { x: 0, y: 0, z: 0 };
    this.state = 'dead';
    this.lastToucher = null;
    this.contactLock = 0;
  }

  get ground(): Vec2 {
    return { x: this.pos.x, y: this.pos.y };
  }

  /** Which half of the court the ball is currently over. */
  get side(): 'human' | 'opponents' {
    return this.pos.y > NET_Y ? 'human' : 'opponents';
  }
}
