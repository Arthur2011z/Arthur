import { Ball, flightHeightAt } from '../entities/Ball';
import { OpponentAI } from '../entities/OpponentAI';
import { Player } from '../entities/Player';
import { TeammateAI } from '../entities/TeammateAI';
import { Vec2 } from '../utils/math';
import {
  AIM_PREVIEW_SEGMENTS,
  BALL_RADIUS,
  BLOCK_HALF_WIDTH,
  BLOCK_PEAK_HEIGHT,
  COURT_LENGTH,
  COURT_WIDTH,
  LANDING_MARKER_RADIUS,
  NET_Y,
} from './constants';

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
// The live spike-trajectory preview: a soft white glow with a brighter core
// drawn over it, so it reads clearly against the sand without hiding the court.
const AIM_PREVIEW_GLOW_COLOR = 'rgba(255, 255, 255, 0.25)';
const AIM_PREVIEW_CORE_COLOR = 'rgba(255, 255, 255, 0.75)';
const AIM_PREVIEW_END_COLOR = 'rgba(255, 255, 255, 0.9)';

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

    if (player.state === 'slowmo_aim') {
      // The slow-motion aim window is open: a ring plus a short line showing
      // the current aim direction (driven live by the aim-swipe, or the
      // default straight-ahead direction until one is made).
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

  /**
   * The trajectory the spike would fly if struck right now, drawn live while
   * the player aims. Not a straight swipe trail: it samples the very same
   * flight model the ball itself uses (flightHeightAt), so the curve shows the
   * real parabola - rising away from the hand and sagging back down under
   * gravity - and updates as the swipe changes.
   *
   * Drawn the same way the ball is: ground position offset upward by the
   * flight height, which is what makes the arc visible at all in a top-down
   * view. A wide translucent stroke gives the glow, a narrow bright one the
   * core.
   */
  drawAimPreview(ctx: CanvasRenderingContext2D, player: Player): void {
    const preview = player.aimPreview;
    if (!preview) return;

    const { from, target, peakHeight, initialHeight } = preview;
    const points: Vec2[] = [];
    for (let i = 0; i <= AIM_PREVIEW_SEGMENTS; i++) {
      const u = i / AIM_PREVIEW_SEGMENTS;
      const h = flightHeightAt(u, peakHeight, initialHeight);
      points.push({
        x: from.x + (target.x - from.x) * u,
        y: from.y + (target.y - from.y) * u - h,
      });
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const [color, width] of [
      [AIM_PREVIEW_GLOW_COLOR, 0.22],
      [AIM_PREVIEW_CORE_COLOR, 0.07],
    ] as [string, number][]) {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';

    // A ring on the ground at the aimed landing point - the arc ends in the
    // air visually (height 0 there, but drawn at the ground y), so marking the
    // spot itself keeps the aim unambiguous.
    ctx.strokeStyle = AIM_PREVIEW_END_COLOR;
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(target.x, target.y, LANDING_MARKER_RADIUS * 0.7, 0, Math.PI * 2);
    ctx.stroke();
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
    if (teammate.height > 0) {
      ctx.fillStyle = BALL_SHADOW_COLOR;
      ctx.beginPath();
      ctx.ellipse(teammate.pos.x, teammate.pos.y, teammate.radius * 0.9, teammate.radius * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const lifted: Vec2 = { x: teammate.pos.x, y: teammate.pos.y - teammate.height };
    this.drawToken(ctx, lifted, teammate.radius, TEAMMATE_COLOR);
  }

  /** The block wall itself, drawn on the net line while a blocker has it up:
   * a bar spanning exactly the lateral reach the block actually covers
   * (BLOCK_HALF_WIDTH either side), lifted and faded in with the block's own
   * height so it rises and drops with the move. Without this the block would
   * be invisible in a top-down view - the whole move is vertical. */
  drawBlockWall(ctx: CanvasRenderingContext2D, pos: Vec2, height: number, color: string): void {
    if (height <= 0) return;
    const raised = height / BLOCK_PEAK_HEIGHT;

    ctx.save();
    ctx.globalAlpha = 0.35 + 0.45 * raised;
    ctx.strokeStyle = color;
    ctx.lineWidth = 0.16;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pos.x - BLOCK_HALF_WIDTH, NET_Y - height);
    ctx.lineTo(pos.x + BLOCK_HALF_WIDTH, NET_Y - height);
    ctx.stroke();

    // Two short uprights back to the net line, so the bar reads as being held
    // up above the net rather than floating on the sand behind it.
    ctx.lineWidth = 0.05;
    ctx.globalAlpha = 0.3 * raised;
    ctx.beginPath();
    for (const dx of [-BLOCK_HALF_WIDTH, BLOCK_HALF_WIDTH]) {
      ctx.moveTo(pos.x + dx, NET_Y);
      ctx.lineTo(pos.x + dx, NET_Y - height);
    }
    ctx.stroke();
    ctx.restore();
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
