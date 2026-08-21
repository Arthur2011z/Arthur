import { COURT_LENGTH, COURT_WIDTH, NET_Y } from './constants';

const SAND_COLOR = '#e8c481';
const LINE_COLOR = '#1c4d6b';
const NET_COLOR = '#1c1c1c';

/**
 * Draws the game world in court-unit coordinates (see Court.resize() for the
 * canvas transform that makes this possible). Methods are added incrementally as
 * new entities land (drawCourt now; drawPlayer, drawBall, ... in later steps) so
 * each build step only ever adds to this file rather than restructuring it.
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
}
