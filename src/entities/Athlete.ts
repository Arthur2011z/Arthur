import { Vec2, clamp, length, normalize } from '../utils/math';
import { COURT_LENGTH, COURT_WIDTH, NET_Y, PLAYER_RADIUS, PLAYER_REACH_HEIGHT } from '../game/constants';

export type TeamId = 'human' | 'opponents';
export type AthleteId = 'player' | 'teammate' | 'opponent1' | 'opponent2';

/** What the renderer should draw. Purely cosmetic - no rule depends on it. */
export type Pose = 'idle' | 'running' | 'jumping' | 'blocking' | 'swinging' | 'serving';

/** The volume an athlete can play the ball in - see Athlete.hitbox. */
export interface Hitbox {
  center: Vec2;
  radius: number;
  /** Lowest ball height that can be reached, in meters. */
  floor: number;
  /** Highest ball height that can be reached, in meters. */
  ceiling: number;
}

/**
 * Everything that is true of all four figures on the court: where they stand,
 * how tall they can reach, and the walls they cannot pass.
 *
 * The court boundary is a hard wall on every side, including the net. Both
 * halves use the same rule, mirrored - which is why the clamp lives here once
 * rather than being copy-pasted into each entity.
 */
export class Athlete {
  pos: Vec2;
  radius = PLAYER_RADIUS;
  /** Extra height from a jump, in meters. Adds directly to the reach ceiling. */
  jumpHeight = 0;
  pose: Pose = 'idle';
  /** Court-space direction the figure is facing, for drawing. */
  facing: Vec2 = { x: 0, y: -1 };

  constructor(
    readonly id: AthleteId,
    readonly team: TeamId,
    home: Vec2,
  ) {
    this.pos = { ...home };
    this.facing = team === 'human' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }

  /** Top of this athlete's reach right now, in meters above the sand. */
  get reachHeight(): number {
    return PLAYER_REACH_HEIGHT + this.jumpHeight;
  }

  /**
   * The volume this athlete can currently play the ball in: a vertical
   * cylinder from `floor` to `ceiling`. Subclasses reshape it - a blocker's
   * reaches across the net and starts at the tape - but every contact in the
   * game is still tested against this one shape.
   */
  get hitbox(): Hitbox {
    return {
      center: { ...this.pos },
      radius: this.radius,
      // A player in the air cannot play a ball below their own feet.
      floor: Math.max(0, this.jumpHeight),
      ceiling: this.reachHeight,
    };
  }

  /** Moves along `dir` (court space, magnitude 0..1) and clamps back inside
   * the athlete's own half. Releasing the input means `dir` is zero, which
   * means no movement at all: nobody in this game glides. */
  moveBy(dir: Vec2, speed: number, dt: number): void {
    const magnitude = Math.min(1, length(dir));
    if (magnitude < 1e-4) return;
    const unit = normalize(dir);
    this.pos = this.clampToOwnHalf({
      x: this.pos.x + unit.x * speed * magnitude * dt,
      y: this.pos.y + unit.y * speed * magnitude * dt,
    });
    this.facing = unit;
  }

  /** Side lines, base line and net all act as solid walls. */
  clampToOwnHalf(p: Vec2): Vec2 {
    const [minY, maxY] =
      this.team === 'human'
        ? [NET_Y + this.radius, COURT_LENGTH - this.radius]
        : [this.radius, NET_Y - this.radius];
    return {
      x: clamp(p.x, this.radius, COURT_WIDTH - this.radius),
      y: clamp(p.y, minY, maxY),
    };
  }

  /** Signed depth into the own half: 0 at the net, growing toward the base line. */
  get distanceToNet(): number {
    return this.team === 'human' ? this.pos.y - NET_Y : NET_Y - this.pos.y;
  }
}
