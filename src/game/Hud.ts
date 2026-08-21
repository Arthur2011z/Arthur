export interface Score {
  human: number;
  opponents: number;
}

export type GamePhase = 'playing' | 'point_scored' | 'game_over';

/** Score display (top-center) and the game-over overlay with a restart button. */
export class Hud {
  private readonly scoreEl: HTMLDivElement;
  private readonly overlayEl: HTMLDivElement;
  private readonly winnerTextEl: HTMLDivElement;
  private readonly restartBtn: HTMLButtonElement;
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
  }

  /** Edge-triggered read: true only on the frame Restart was pressed. */
  consumeRestart(): boolean {
    const v = this.restartPending;
    this.restartPending = false;
    return v;
  }

  update(score: Score, phase: GamePhase, winner: 'human' | 'opponents' | null): void {
    this.scoreEl.textContent = `Du ${score.human} : ${score.opponents} Gegner`;

    if (phase === 'game_over') {
      this.overlayEl.style.display = 'flex';
      this.winnerTextEl.textContent =
        winner === 'human' ? 'Gewonnen! 🏆' : 'Verloren — die Gegner haben gewonnen.';
    } else {
      this.overlayEl.style.display = 'none';
    }
  }

  private onRestartPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.restartPending = true;
  };
}
