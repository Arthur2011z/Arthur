import './style.css';
import { Court } from './game/Court';
import { debugLog } from './game/Debug';
import { GameLoop } from './game/GameLoop';
import { GameState } from './game/GameState';
import { Hud } from './game/Hud';
import { Renderer } from './game/Renderer';
import { simulate } from './game/Physics';
import { InputManager } from './input/InputManager';

const viewportEl = document.getElementById('viewport') as HTMLDivElement;
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const overlay = document.getElementById('overlay') as HTMLDivElement;

const maybeCtx = canvas.getContext('2d');
if (!maybeCtx) throw new Error('2D canvas context not available');
const ctx: CanvasRenderingContext2D = maybeCtx;

const court = new Court(canvas, ctx);
const renderer = new Renderer();
// The whole viewport doubles as the swipe surface; the overlay's controls sit
// on top of it and stop their own pointer events from reaching it.
const input = new InputManager(overlay, viewportEl, court);
const hud = new Hud(overlay);
const gameState = new GameState();

function draw(): void {
  renderer.clear(ctx, court);
  renderer.drawCourt(ctx, court);
  for (const athlete of gameState.athletes) renderer.drawAthlete(ctx, court, athlete);
  // The net is drawn after the figures so anyone standing right at it passes
  // behind the mesh, which is what sells it as a real vertical obstacle. The
  // ball goes on top of everything: it is the one thing that must never be
  // hidden.
  renderer.drawNet(ctx, court);
  renderer.drawBlockZone(ctx, court, gameState.player);
  renderer.drawAimPath(ctx, court, gameState.aimPreview());
  renderer.drawBall(ctx, court, gameState.ball);
  renderer.drawSlowMotionTint(ctx, court, gameState.timeScale < 1);
}

const loop = new GameLoop((dt, nowMs) => {
  gameState.update(dt, input.snapshot(), nowMs);
  renderer.advance(dt);
  // While the human holds serve, every other action button disappears and a
  // single Aufschlag button takes their place.
  input.setButtonMode(
    gameState.awaitingServe && gameState.humanIsServing ? 'serve' : 'play',
  );
  if (hud.consumeRestart()) gameState.restart();
  hud.update({
    score: gameState.score,
    phase: gameState.phase,
    winner: gameState.winner,
    touches: gameState.rally.touches,
    possession: gameState.rally.possession,
    servingTeam: gameState.servingTeam,
    lastFault: gameState.lastFault,
    awaitingServe: gameState.awaitingServe,
    humanIsServing: gameState.humanIsServing,
  });
  hud.setHint(input.mode);
  draw();
});

window.addEventListener('resize', () => court.resize());
window.addEventListener('orientationchange', () => court.resize());
court.resize();
loop.start();

// Debug hook for automated (Playwright) tests: harmless in a locally-opened
// single-file build, never sent anywhere.
declare global {
  interface Window {
    __game?: {
      state: GameState;
      court: Court;
      input: InputManager;
      debug: typeof debugLog;
      simulate: typeof simulate;
    };
  }
}
window.__game = { state: gameState, court, input, debug: debugLog, simulate };
