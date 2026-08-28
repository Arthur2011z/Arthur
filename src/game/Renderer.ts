import { Athlete } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Player } from '../entities/Player';
import { Vec2, Vec3 } from '../utils/math';
import { Court } from './Court';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  COURT_WIDTH,
  NET_HEIGHT,
  NET_Y,
  Z_SCREEN_FACTOR,
} from './constants';

const SURROUND_COLOR = '#0b3d5c';
const SAND_COLOR = '#e8c481';
const SAND_SHADE = '#dfb972';
const LINE_COLOR = '#f7f3ea';
const NET_POST_COLOR = '#3b2f2a';
const NET_MESH_COLOR = 'rgba(28, 28, 28, 0.55)';
const NET_TAPE_COLOR = '#f4f4f0';
const SHADOW_COLOR = 'rgba(0, 0, 0, 0.22)';
const BALL_COLOR = '#fbfaf5';
const BLOCK_ZONE_FILL = 'rgba(255, 255, 255, 0.30)';
const BLOCK_ZONE_EDGE = 'rgba(255, 255, 255, 0.85)';
const AIM_LINE_COLOR = 'rgba(255, 255, 255, 0.92)';
const AIM_GLOW_COLOR = 'rgba(255, 255, 255, 0.28)';
const SLOWMO_TINT = 'rgba(120, 190, 255, 0.12)';

const TEAM_COLORS: Record<string, string> = {
  player: '#e63946',
  teammate: '#2a9d8f',
  opponent1: '#6d4c9c',
  opponent2: '#8a63c4',
};

/** Height of a drawn figure, in court meters, before the screen projection. */
const FIGURE_HEIGHT_M = 1.85;

/**
 * Draws everything in CSS-pixel screen space, converting court coordinates
 * through Court.toScreen(). Working in screen space (rather than setting a
 * rotated canvas transform) is what lets the figures stay upright and legible
 * when the court itself is rotated a quarter turn in landscape.
 */
export class Renderer {
  /** Free-running clock for idle/run animation only. */
  private animTime = 0;

  advance(dt: number): void {
    this.animTime += dt;
  }

  clear(ctx: CanvasRenderingContext2D, court: Court): void {
    ctx.fillStyle = SURROUND_COLOR;
    ctx.fillRect(0, 0, court.viewport.x, court.viewport.y);
  }

  drawCourt(ctx: CanvasRenderingContext2D, court: Court): void {
    // Sand, drawn as the quad through the four court corners so it lands
    // correctly in either orientation.
    this.fillCourtQuad(ctx, court, { x: 0, y: 0 }, { x: COURT_WIDTH, y: COURT_LENGTH }, SAND_COLOR);
    // A slightly darker far half, so which side is which reads at a glance.
    this.fillCourtQuad(ctx, court, { x: 0, y: 0 }, { x: COURT_WIDTH, y: NET_Y }, SAND_SHADE);

    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = Math.max(2, court.scale * 0.06);
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    const corners: Vec2[] = [
      { x: 0, y: 0 },
      { x: COURT_WIDTH, y: 0 },
      { x: COURT_WIDTH, y: COURT_LENGTH },
      { x: 0, y: COURT_LENGTH },
    ];
    corners.forEach((c, i) => {
      const p = court.toScreen(c);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.stroke();
  }

  /** The net is a real obstacle with a real height, so it is drawn as one:
   * two posts, a mesh band, and a white tape along the top edge at
   * NET_HEIGHT. Everything is derived from the two net-line endpoints, which
   * keeps it correct in both orientations. */
  drawNet(ctx: CanvasRenderingContext2D, court: Court): void {
    const left = court.toScreen({ x: 0, y: NET_Y });
    const right = court.toScreen({ x: COURT_WIDTH, y: NET_Y });
    const lift = court.heightOffset(NET_HEIGHT);
    const top = (p: Vec2): Vec2 => ({ x: p.x + lift.x, y: p.y + lift.y });

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left.x, left.y);
    ctx.lineTo(right.x, right.y);
    ctx.lineTo(top(right).x, top(right).y);
    ctx.lineTo(top(left).x, top(left).y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fill();

    // Mesh: evenly spaced strands from the ground line to the tape.
    ctx.strokeStyle = NET_MESH_COLOR;
    ctx.lineWidth = 1;
    const cells = 26;
    for (let i = 0; i <= cells; i += 1) {
      const t = i / cells;
      const base: Vec2 = {
        x: left.x + (right.x - left.x) * t,
        y: left.y + (right.y - left.y) * t,
      };
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(base.x + lift.x, base.y + lift.y);
      ctx.stroke();
    }

    ctx.strokeStyle = NET_TAPE_COLOR;
    ctx.lineWidth = Math.max(3, court.scale * 0.1);
    ctx.beginPath();
    ctx.moveTo(top(left).x, top(left).y);
    ctx.lineTo(top(right).x, top(right).y);
    ctx.stroke();

    ctx.strokeStyle = NET_POST_COLOR;
    ctx.lineWidth = Math.max(3, court.scale * 0.09);
    for (const base of [left, right]) {
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(top(base).x, top(base).y);
      ctx.stroke();
    }
    ctx.restore();
  }

  /** A simple stick figure: ground shadow, then head/torso/arms/legs lifted by
   * whatever jump height the athlete currently has. Arms go up for blocks,
   * jumps and serves, which is all the animation the game needs to read. */
  drawAthlete(ctx: CanvasRenderingContext2D, court: Court, a: Athlete): void {
    const ground = court.toScreen(a.pos);
    const unit = court.scale;
    // The feet leave the shadow behind when jumping - same height convention
    // as the net and the ball, so the three stay comparable on screen.
    const lift = court.heightOffset(a.jumpHeight);
    const feet: Vec2 = { x: ground.x + lift.x, y: ground.y + lift.y };
    const h = FIGURE_HEIGHT_M * unit * Z_SCREEN_FACTOR;
    const color = TEAM_COLORS[a.id] ?? '#333';

    ctx.fillStyle = SHADOW_COLOR;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, a.radius * unit, a.radius * unit * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();

    const feetY = feet.y;
    const hipY = feetY - h * 0.45;
    const shoulderY = feetY - h * 0.78;
    const headY = feetY - h * 0.9;
    const headR = h * 0.11;
    const stride = a.pose === 'running' ? Math.sin(this.animTime * 11) * h * 0.14 : 0;

    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, h * 0.075);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Torso
    ctx.beginPath();
    ctx.moveTo(feet.x, hipY);
    ctx.lineTo(feet.x, shoulderY);
    ctx.stroke();

    // Legs
    const legSpread = h * 0.13;
    ctx.beginPath();
    ctx.moveTo(feet.x, hipY);
    ctx.lineTo(feet.x - legSpread + stride, feetY);
    ctx.moveTo(feet.x, hipY);
    ctx.lineTo(feet.x + legSpread + stride, feetY);
    ctx.stroke();

    this.drawArms(ctx, a, feet.x, shoulderY, h);

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(feet.x, headY - headR * 0.3, headR, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * The wall a raised block puts up, drawn from the blocker's actual hitbox
   * so what the player sees is what the physics tests against - including the
   * part that reaches across the net.
   */
  drawBlockZone(ctx: CanvasRenderingContext2D, court: Court, player: Player): void {
    if (!player.blocking) return;
    const box = player.hitbox;

    const base = court.toScreenElevated(box.center, box.floor);
    const top = court.toScreenElevated(box.center, box.ceiling);
    const halfWidth = (box.radius + BALL_RADIUS) * court.scale;

    ctx.save();
    ctx.fillStyle = BLOCK_ZONE_FILL;
    ctx.strokeStyle = BLOCK_ZONE_EDGE;
    ctx.lineWidth = Math.max(1.5, court.scale * 0.03);
    ctx.beginPath();
    ctx.moveTo(base.x - halfWidth, base.y);
    ctx.lineTo(base.x + halfWidth, base.y);
    ctx.lineTo(top.x + halfWidth, top.y);
    ctx.lineTo(top.x - halfWidth, top.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The glowing line shown while aiming an attack: the actual flight the ball
   * would take if it were struck right now, produced by running the same
   * integrator the live ball uses. It bends under gravity because it is a real
   * parabola, not a straight line drawn toward a target, and it updates every
   * frame as the aim and the ball both move.
   */
  drawAimPath(ctx: CanvasRenderingContext2D, court: Court, path: Vec3[] | null): void {
    if (!path || path.length < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path.forEach((p, i) => {
      const s = court.toScreenElevated(p, p.z);
      if (i === 0) ctx.moveTo(s.x, s.y);
      else ctx.lineTo(s.x, s.y);
    });
    // Two passes: a soft wide glow, then a crisp core on top.
    ctx.strokeStyle = AIM_GLOW_COLOR;
    ctx.lineWidth = Math.max(6, court.scale * 0.22);
    ctx.stroke();
    ctx.strokeStyle = AIM_LINE_COLOR;
    ctx.lineWidth = Math.max(2, court.scale * 0.07);
    ctx.stroke();

    // Where it would come down.
    const end = path[path.length - 1];
    const mark = court.toScreen(end);
    const r = court.scale * 0.35;
    ctx.strokeStyle = AIM_LINE_COLOR;
    ctx.lineWidth = Math.max(2, court.scale * 0.05);
    ctx.beginPath();
    ctx.arc(mark.x, mark.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** A gentle wash over the court while the world is slowed down, so the
   * aiming phase is unmistakable. */
  drawSlowMotionTint(ctx: CanvasRenderingContext2D, court: Court, active: boolean): void {
    if (!active) return;
    ctx.fillStyle = SLOWMO_TINT;
    ctx.fillRect(0, 0, court.viewport.x, court.viewport.y);
  }

  /** The ball plus a ground shadow. The shadow is the anchor: it sits at the
   * ball's true court position, so its distance from the ball itself is the
   * only reliable read of how high the ball currently is. */
  drawBall(ctx: CanvasRenderingContext2D, court: Court, ball: Ball): void {
    if (ball.state === 'dead' && ball.pos.z <= BALL_RADIUS * 1.01) {
      // Resting in the sand: just a flat mark, no floating ball.
      const rest = court.toScreen(ball.ground);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
      ctx.beginPath();
      ctx.ellipse(rest.x, rest.y, BALL_RADIUS * court.scale, BALL_RADIUS * court.scale * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    const ground = court.toScreen(ball.ground);
    const air = court.toScreenElevated(ball.ground, ball.pos.z);
    const r = BALL_RADIUS * court.scale;

    // Shadow shrinks and fades as the ball climbs - a second, redundant cue so
    // height stays readable even when the ball overlaps a figure.
    const shrink = 1 / (1 + ball.pos.z * 0.22);
    ctx.fillStyle = `rgba(0, 0, 0, ${0.26 * shrink})`;
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y, r * shrink, r * shrink * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = BALL_COLOR;
    ctx.beginPath();
    ctx.arc(air.x, air.y, r * (1 + ball.pos.z * 0.03), 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = Math.max(1, r * 0.16);
    ctx.stroke();
  }

  private drawArms(
    ctx: CanvasRenderingContext2D,
    a: Athlete,
    x: number,
    shoulderY: number,
    h: number,
  ): void {
    const reach = h * 0.34;
    ctx.beginPath();
    switch (a.pose) {
      case 'blocking':
      case 'jumping':
      case 'serving':
        // Both arms straight up - the universal "I am contesting this ball".
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x - reach * 0.35, shoulderY - reach);
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x + reach * 0.35, shoulderY - reach);
        break;
      case 'swinging':
        // One arm cocked high, the other out for balance.
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x + reach * 0.6, shoulderY - reach * 1.05);
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x - reach * 0.85, shoulderY + reach * 0.2);
        break;
      default: {
        const swing = a.pose === 'running' ? Math.sin(this.animTime * 11) * reach * 0.4 : 0;
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x - reach * 0.7, shoulderY + reach * 0.55 - swing);
        ctx.moveTo(x, shoulderY);
        ctx.lineTo(x + reach * 0.7, shoulderY + reach * 0.55 + swing);
      }
    }
    ctx.stroke();
  }

  private fillCourtQuad(
    ctx: CanvasRenderingContext2D,
    court: Court,
    from: Vec2,
    to: Vec2,
    color: string,
  ): void {
    const corners: Vec2[] = [
      { x: from.x, y: from.y },
      { x: to.x, y: from.y },
      { x: to.x, y: to.y },
      { x: from.x, y: to.y },
    ];
    ctx.fillStyle = color;
    ctx.beginPath();
    corners.forEach((c, i) => {
      const p = court.toScreen(c);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.closePath();
    ctx.fill();
  }
}
