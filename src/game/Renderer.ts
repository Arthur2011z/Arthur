import { Ball } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { Vec2 } from '../utils/math';
import { BALL_RADIUS, COURT_LENGTH, COURT_WIDTH, NET_Y } from './constants';

const SAND_COLOR = '#e8c481';
const LINE_COLOR = '#1c4d6b';
const NET_COLOR = '#1c1c1c';
const PLAYER_COLOR = '#e63946';
const TEAMMATE_COLOR = '#2a9d8f';
const OPPONENT_COLOR = '#6d4c9c';
const BALL_COLOR = '#f4f4f0';
const BALL_SHADOW_COLOR = 'rgba(0, 0, 0, 0.25)';
const AIM_LINE_COLOR = 'rgba(255, 255, 255, 0.85)';
const AIM_TARGET_COLOR = 'rgba(255, 255, 255, 0.5)';

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

    const lineWidth = 0.06;
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
    ctx.lineWidth = 0.1;
    ctx.beginPath();
    ctx.moveTo(0, NET_Y);
    ctx.lineTo(COURT_WIDTH, NET_Y);
    ctx.stroke();
  }

  drawPlayer(ctx: CanvasRenderingContext2D, player: Player): void {
    this.drawToken(ctx, player.pos, player.radius, PLAYER_COLOR);
  }

  /** While the player is jumping, shows exactly where a spike would currently
   * land, tracking the live joystick-steered aim direction. */
  drawAimPreview(ctx: CanvasRenderingContext2D, player: Player): void {
    const target = player.getAimPreviewTarget();
    if (!target) return;

    ctx.strokeStyle = AIM_LINE_COLOR;
    ctx.lineWidth = 0.04;
    ctx.setLineDash([0.12, 0.1]);
    ctx.beginPath();
    ctx.moveTo(player.pos.x, player.pos.y);
    ctx.lineTo(target.x, target.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = AIM_TARGET_COLOR;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 0.2, 0, Math.PI * 2);
    ctx.fill();
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
