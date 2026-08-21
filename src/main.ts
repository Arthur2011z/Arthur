import './style.css';
import { Court } from './game/Court';
import { GameLoop } from './game/GameLoop';
import { GameState } from './game/GameState';
import { Renderer } from './game/Renderer';
import { InputManager } from './input/InputManager';

const viewportEl = document.getElementById('viewport') as HTMLDivElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('2D canvas context not available');
const ctx: CanvasRenderingContext2D = maybeCtx;

const court = new Court(viewportEl, canvas, ctx);
const renderer = new Renderer();
const input = new InputManager(overlay, canvas);
const gameState = new GameState();

function resize(): void {
  court.resize();
}

function draw(): void {
  renderer.clear(ctx);
  renderer.drawCourt(ctx);
  renderer.drawTeammate(ctx, gameState.teammate);
  for (const opponent of gameState.opponents) renderer.drawOpponent(ctx, opponent);
  renderer.drawBall(ctx, gameState.ball);
  renderer.drawPlayer(ctx, gameState.player);
}

const loop = new GameLoop((dt) => {
  gameState.update(dt, input.snapshot());
  draw();
});

window.addEventListener('resize', resize);
window.addEventListener('orientationchange', resize);
resize();
loop.start();

// Debug hook for automated (Playwright) tests: harmless in a locally-opened
// single-file build, never sent anywhere.
declare global {
  interface Window {
    __game?: { state: GameState; court: Court };
  }
}
window.__game = { state: gameState, court };
