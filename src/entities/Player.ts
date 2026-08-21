import { Vec2, clamp, normalize } from '../utils/math';
import { COURT_LENGTH, COURT_WIDTH, NET_Y, PLAYER_RADIUS, PLAYER_SPEED } from '../game/constants';

/**
 * The human-controlled player. For now this only handles free movement inside the
 * player's own court half; dive/hit/jump states are added in later build steps.
 */
export class Player {
  pos: Vec2 = { x: COURT_WIDTH / 2, y: NET_Y + COURT_LENGTH / 4 };
  radius = PLAYER_RADIUS;

  update(dt: number, moveVector: Vec2): void {
    const move = normalize(moveVector);
    const speed = Math.min(1, Math.hypot(moveVector.x, moveVector.y));
    this.pos.x += move.x * PLAYER_SPEED * speed * dt;
    this.pos.y += move.y * PLAYER_SPEED * speed * dt;
    this.clampToOwnHalf();
  }

  private clampToOwnHalf(): void {
    this.pos.x = clamp(this.pos.x, this.radius, COURT_WIDTH - this.radius);
    this.pos.y = clamp(this.pos.y, NET_Y + this.radius, COURT_LENGTH - this.radius);
  }
}
