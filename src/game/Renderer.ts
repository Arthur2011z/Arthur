import { Ball } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { Vec2 } from '../utils/math';
import { BALL_RADIUS, COURT_LENGTH, COURT_WIDTH, LANDING_MARKER_RADIUS, NET_Y } from './constants';

const SAND_COLOR = '#e8c481';
const LINE_COLOR = '#1c4d6b';
const NET_COLOR = '#1c1c1c';
const PLAYER_COLOR = '#e63946';
const TEAMMATE_COLOR = '#2a9d8f';
const OPPONENT_COLOR = '#6d4c9c';
const BALL_COLOR = '#f4f4f0';
const BALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.25)';
const JUMP_READY_RING_COLOR = 'rgba(255, 255, 255, 0.9)';
const LANDING_MARKER_COLOR = 'rgba(255, 209, 102, 0.9)';

/**
 * Draws the game world in court-unit coordinates (see Court.resize() for the
 * canvas transform that makes this possible). Methods are added incrementally as
 * new entities land, so each build step only ever adds to this file rather than
 * restructuring it.
 */
export class Renderer {
  clear(ctx: CanvasRenderingContext2D): void {
    ctx.clearRect(0, 0, COURT_WIDTH, COURT_LENGTH);
  }

  drawCourt(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = SAND_COLOR;
    ctx.fillRect(0, 0, COURT_WIDTH, COURT_LENGTH);

    const lineWidth = 0.08;
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(
      lineWidth / 2,
      lineWidth / 2,
      COURT_WIDTH - lineWidth,
      COURT_LENGTH - lineWidth,
    );

    // Net: drawn as a thicker horizontal line across the middle of the court.
    ctx.strokeStyle = NET_COLOR;
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.moveTo(0, NET_Y);
    ctx.lineTo(COURT_WIDTH, NET_Y);
    ctx.stroke();
  }

  drawPlayer(ctx: CanvasRenderingContext2D, player: Player): void {
    if (player.height > 0) {
      // Same ground-shadow-plus-lift trick as drawBall(), so the hop reads
      // visually even in a flat top-down view.
      ctx.fillStyle = BALL_SHADOW_COLOR;
      ctx.beginPath();
      ctx.ellipse(player.pos.x, player.pos.y, player.radius * 0.9, player.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const liftedPos: Vec2 = { x: player.pos.x, y: player.pos.y - player.height };
    this.drawToken(ctx, liftedPos, player.radius, PLAYER_COLOR);

    if (player.state === 'jumping_up') {
      // "The Schlag window is open" ring, plus a short line showing the
      // current aim direction (driven live by the joystick - see Player.aimDir).
      ctx.strokeStyle = JUMP_READY_RING_COLOR;
      ctx.lineWidth = 0.05;
      ctx.beginPath();
      ctx.arc(liftedPos.x, liftedPos.y, player.radius + 0.15, 0, Math.PI * 2);
      ctx.stroke();

      const aimLen = player.radius + 0.5;
      ctx.beginPath();
      ctx.moveTo(liftedPos.x, liftedPos.y);
      ctx.lineTo(liftedPos.x + player.aimDir.x * aimLen, liftedPos.y + player.aimDir.y * aimLen);
      ctx.stroke();
    }
  }

  /** While the ball is in flight, marks exactly where it's headed
   * (ball.target is exact - we control every launch, no prediction needed).
   * Deliberately distinct from the ball's own small traveling shadow: this is
   * the *destination*, not the ball's current position. */
  drawLandingMarker(ctx: CanvasRenderingContext2D, ball: Ball): void {
    if (ball.state !== 'flying') return;
    const { x, y } = ball.target;

    ctx.strokeStyle = LANDING_MARKER_COLOR;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(x, y, LANDING_MARKER_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    const r = LANDING_MARKER_RADIUS * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.stroke();
  }

  drawTeammate(ctx: CanvasRenderingContext2D, teammate: TeammateAI): void {
    this.drawToken(ctx, teammate.pos, teammate.radius, TEAMMATE_COLOR);
  }

  drawOpponent(ctx: CanvasRenderingContext2D, opponent: OpponentAI): void {
    this.drawToken(ctx, opponent.pos, opponent.radius, OPPONENT_COLOR);
  }

  drawBall(ctx: CanvasRenderingContext2D, ball: Ball): void {
    // Shadow stays on the ground plane, flattened, so height reads visually
    // even though the game itself is a flat top-down view.
    ctx.fillStyle = BALL_SHADOW_COLOR;
    ctx.beginPath();
    ctx.ellipse(ball.pos.x, ball.pos.y, BALL_RADIUS * 0.9, BALL_RADIUS * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    const liftedPos: Vec2 = { x: ball.pos.x, y: ball.pos.y - ball.height };
    const drawRadius = BALL_RADIUS * (1 + ball.height * 0.15);
    this.drawToken(ctx, liftedPos, drawRadius, BALL_COLOR);
  }

  /** Generic colored-circle token, reused for every figure (player, teammate,
   * opponents) so each build step only needs to pick a color and a position. */
  drawToken(ctx: CanvasRenderingContext2D, pos: Vec2, radius: number, color: string): void {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.03;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.stroke();
  }
}
