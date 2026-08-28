import { FAULT_TEXT, FaultReason } from './Rally';
import { GamePhase } from './GameState';

export interface Score {
  human: number;
  opponents: number;
}

export interface HudModel {
  score: Score;
  phase: GamePhase;
  winner: 'human' | 'opponents' | null;
  /** Touches the side in possession has already used, 0-3. */
  touches: number;
  possession: 'human' | 'opponents';
  servingTeam: 'human' | 'opponents';
  lastFault: FaultReason | null;
}

/** Score display (top-center) and the game-over overlay with a restart button. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly winnerTextEl: HTMLDivElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly hintEl: HTMLDivElement;
  private readonly touchEl: HTMLDivElement;
  private readonly faultEl: HTMLDivElement;
  private restartPending = false;

  constructor(container: HTMLElement) {
    this.scoreEl = document.createElement('div');
    this.scoreEl.id = 'score-hud';
    Object.assign(this.scoreEl.style, {
      position: 'absolute',
      top: 'max(14px, env(safe-area-inset-top))',
      left: '50%',
      transform: 'translateX(-50%)',
      color: '#fff',
      background: 'rgba(0, 0, 0, 0.25)',
      padding: '6px 18px',
      borderRadius: '999px',
      width: 'max-content',
      whiteSpace: 'nowrap',
      font: '700 20px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      letterSpacing: '0.03em',
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.scoreEl);

    this.overlayEl = document.createElement('div');
    this.overlayEl.id = 'game-over-overlay';
    Object.assign(this.overlayEl.style, {
      position: 'absolute',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      gap: '18px',
      background: 'rgba(11, 61, 92, 0.88)',
    } satisfies Partial<CSSStyleDeclaration>);

    this.winnerTextEl = document.createElement('div');
    Object.assign(this.winnerTextEl.style, {
      color: '#fff',
      font: '700 28px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      textAlign: 'center',
      padding: '0 24px',
    } satisfies Partial<CSSStyleDeclaration>);

    this.restartBtn = document.createElement('button');
    this.restartBtn.id = 'restart-btn';
    this.restartBtn.type = 'button';
    this.restartBtn.textContent = 'Neu starten';
    Object.assign(this.restartBtn.style, {
      padding: '14px 32px',
      borderRadius: '999px',
      border: 'none',
      background: '#e63946',
      color: '#fff',
      font: '600 17px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    this.restartBtn.addEventListener('pointerdown', this.onRestartPointerDown);

    this.overlayEl.appendChild(this.winnerTextEl);
    this.overlayEl.appendChild(this.restartBtn);
    container.appendChild(this.overlayEl);

    this.touchEl = this.createBadge(container, 'touch-counter', 'max(52px, calc(env(safe-area-inset-top) + 42px))');
    this.faultEl = this.createBadge(container, 'fault-notice', 'max(88px, calc(env(safe-area-inset-top) + 78px))');

    this.hintEl = document.createElement('div');
    this.hintEl.id = 'control-hint';
    Object.assign(this.hintEl.style, {
      position: 'absolute',
      bottom: 'max(10px, env(safe-area-inset-bottom))',
      left: '50%',
      transform: 'translateX(-50%)',
      color: 'rgba(255, 255, 255, 0.72)',
      font: '500 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.hintEl);
  }

  /** Spells out the controls for whichever input device is currently in use,
   * so switching between phone and desktop never leaves the player guessing. */
  setHint(mode: 'touch' | 'keyboard'): void {
    this.hintEl.textContent =
      mode === 'keyboard'
        ? 'WASD Laufen · E Pass · F Notfall · Leertaste Block · Q Schmettern'
        : '';
  }

  /** Edge-triggered read: true only on the frame Restart was pressed. */
  consumeRestart(): boolean {
    const v = this.restartPending;
    this.restartPending = false;
    return v;
  }

  update(model: HudModel): void {
    const serve = model.servingTeam === 'human' ? '\u25C0' : '\u25B6';
    this.scoreEl.textContent =
      model.servingTeam === 'human'
        ? `${serve} Du ${model.score.human} : ${model.score.opponents} Gegner`
        : `Du ${model.score.human} : ${model.score.opponents} Gegner ${serve}`;

    // Touch counter: dots for the three contacts the side in possession has.
    const used = Math.min(model.touches, 3);
    this.touchEl.textContent =
      model.phase === 'rally' && used > 0
        ? `${model.possession === 'human' ? 'Ihr' : 'Gegner'}: ${'\u25CF'.repeat(used)}${'\u25CB'.repeat(3 - used)}`
        : '';

    this.faultEl.textContent =
      model.phase === 'point_scored' && model.lastFault ? FAULT_TEXT[model.lastFault] : '';

    if (model.phase === 'game_over') {
      this.overlayEl.style.display = 'flex';
      this.winnerTextEl.textContent =
        model.winner === 'human'
          ? `Gewonnen! ${model.score.human} : ${model.score.opponents} \u{1F3C6}`
          : `Verloren — ${model.score.human} : ${model.score.opponents}.`;
    } else {
      this.overlayEl.style.display = 'none';
    }
  }

  /** Small centered caption under the score, used for the touch counter and
   * the reason the last point ended. */
  private createBadge(container: HTMLElement, id: string, top: string): HTMLDivElement {
    const el = document.createElement('div');
    el.id = id;
    Object.assign(el.style, {
      position: 'absolute',
      top,
      left: '50%',
      transform: 'translateX(-50%)',
      color: '#fff',
      font: '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      textShadow: '0 1px 3px rgba(0, 0, 0, 0.55)',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(el);
    return el;
  }

  private onRestartPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    e.stopPropagation(); // must not also register as an aiming swipe
    this.restartPending = true;
  };
}
