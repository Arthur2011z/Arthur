import { Vec2, Vec3, clamp, length, normalize } from '../utils/math';
import {
  BLOCK_COOLDOWN,
  BLOCK_FALL,
  BLOCK_FLOOR,
  BLOCK_JUMP_HEIGHT,
  BLOCK_NET_RANGE,
  BLOCK_OVERREACH,
  BLOCK_RISE,
  BLOCK_WIDTH_BONUS,
  BLOCK_WINDOW,
  COURT_LENGTH,
  COURT_WIDTH,
  NET_Y,
  PLAYER_RADIUS,
  PLAYER_REACH_HEIGHT,
  SERVE_HAND_HEIGHT,
} from '../game/constants';

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
  /** True while the arms are up at the net. */
  blocking = false;

  protected blockTimer = 0;
  protected blockCooldown = 0;
  private blockPressedAt = 0;

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
   * The volume this athlete can currently play the ball in.
   *
   * Normally a vertical cylinder from the feet to the reach height. While
   * blocking it becomes a different shape entirely: it starts at the tape and
   * reaches across the net, because a block is played over the net rather than
   * on the blocker's own side. Every contact in the game is tested against
   * this one shape, human and AI alike.
   */
  get hitbox(): Hitbox {
    if (this.blocking) {
      const forward = this.towardNet;
      return {
        center: {
          x: this.pos.x + forward.x * BLOCK_OVERREACH,
          y: this.pos.y + forward.y * BLOCK_OVERREACH,
        },
        radius: this.radius + BLOCK_WIDTH_BONUS,
        floor: BLOCK_FLOOR,
        ceiling: this.reachHeight,
      };
    }
    return {
      center: { ...this.pos },
      radius: this.radius,
      // A player in the air cannot play a ball below their own feet.
      floor: Math.max(0, this.jumpHeight),
      ceiling: this.reachHeight,
    };
  }

  /** Unit vector from this athlete's own half toward the net. */
  get towardNet(): Vec2 {
    return this.team === 'human' ? { x: 0, y: -1 } : { x: 0, y: 1 };
  }

  // -------------------------------------------------------------------------
  // Block. Shared by the human and the AI so there is one definition of the
  // block zone, one window and one cooldown.
  // -------------------------------------------------------------------------

  /** Whether a block would engage from where this athlete is standing. */
  canBlock(): boolean {
    return this.blockCooldown <= 0 && !this.blocking && this.distanceToNet <= BLOCK_NET_RANGE;
  }

  /** Raises the arms, if close enough to the net and not still recovering from
   * the last attempt. Too far away it simply does nothing - there is no block
   * from midcourt. */
  startBlock(pressedAt: number): void {
    if (!this.canBlock()) return;
    this.blocking = true;
    this.blockTimer = 0;
    this.blockPressedAt = pressedAt;
  }

  /** When the arms went up, for the contact log. */
  get blockStartedAt(): number {
    return this.blockPressedAt;
  }

  updateBlock(dt: number): void {
    this.blockCooldown = Math.max(0, this.blockCooldown - dt);
    if (!this.blocking) return;

    this.blockTimer += dt;
    if (this.blockTimer >= BLOCK_WINDOW) {
      this.endBlock();
      return;
    }

    // Up fast, hold, back down - so the zone is actually open for most of the
    // window rather than only at one instant.
    const remaining = BLOCK_WINDOW - this.blockTimer;
    const rise = Math.min(1, this.blockTimer / BLOCK_RISE);
    const fall = Math.min(1, remaining / BLOCK_FALL);
    this.jumpHeight = BLOCK_JUMP_HEIGHT * Math.min(rise, fall);
  }

  endBlock(): void {
    this.blocking = false;
    this.blockTimer = 0;
    this.jumpHeight = 0;
    this.blockCooldown = BLOCK_COOLDOWN;
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

  /** Where this athlete's own base line runs, in court space. */
  get baselineY(): number {
    return this.team === 'human' ? COURT_LENGTH - this.radius : this.radius;
  }

  /** Where a held ball sits while this athlete is waiting to serve. */
  get handPosition(): Vec3 {
    return { x: this.pos.x, y: this.pos.y, z: SERVE_HAND_HEIGHT };
  }

  /** Signed depth into the own half: 0 at the net, growing toward the base line. */
  get distanceToNet(): number {
    return this.team === 'human' ? this.pos.y - NET_Y : NET_Y - this.pos.y;
  }

  /**
   * How fast this athlete is actually travelling, in m/s, measured from where
   * they were on the previous frame.
   *
   * Measured rather than declared: it then covers the human, the AI, the boost
   * and a player being clamped against a line alike, and it cannot drift out of
   * step with the position the way a separately maintained velocity would. A
   * set that leads its target needs where the receiver is *going*, not where
   * they happened to stand at the moment of contact.
   */
  velocity: Vec2 = { x: 0, y: 0 };

  /** Call once per update, after any movement, to refresh `velocity`. */
  trackVelocity(dt: number): void {
    if (dt > 1e-6) {
      this.velocity = {
        x: (this.pos.x - this.prevPos.x) / dt,
        y: (this.pos.y - this.prevPos.y) / dt,
      };
    }
    this.prevPos = { ...this.pos };
  }

  private prevPos: Vec2 = { x: 0, y: 0 };
}
