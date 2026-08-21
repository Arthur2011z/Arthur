import './style.css';
import { Court } from './game/Court';
import { Renderer } from './game/Renderer';

const viewportEl = document.getElementById('viewport') as HTMLDivElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('2D canvas context not available');
const ctx: CanvasRenderingContext2D = maybeCtx;

const court = new Court(viewportEl, canvas, ctx);
const renderer = new Renderer();

function resize(): void {
  court.resize();
  draw();
}

function draw(): void {
  renderer.clear(ctx);
  renderer.drawCourt(ctx);
}

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();
