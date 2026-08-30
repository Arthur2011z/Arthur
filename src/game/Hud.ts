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
  /** The ball is still in a server's hand. */
  awaitingServe: boolean;
  /** ...and it is the human's hand. */
  humanIsServing: boolean;
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
      // Centred by auto margins, not by left:50% and a transform. Anchored at
      // 50% the box is only ever offered *half* the screen to lay itself out
      // in - the transform moves it afterwards but never gives that width back
      // - so the hint wrapped as if the window were half its real width.
      left: '0',
      right: '0',
      margin: '0 auto',
      width: 'max-content',
      color: 'rgba(255, 255, 255, 0.82)',
      font: '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      // Shrinks a little before it wraps at all. Allowed to wrap as plain text
      // at a fixed size, the full control list turns into three lines in a
      // narrow window and climbs off the letterbox band into the court.
      fontSize: 'clamp(9px, 2.4vw, 12px)',
      maxWidth: 'min(94vw, 660px)',
      // One entry per flex item, so a break can only ever fall between two
      // entries. Wrapping the same string as text breaks at whatever word
      // happens to be near the edge and leaves most of a line empty, which is
      // what pushed it onto a third line.
      display: 'flex',
      flexWrap: 'wrap',
      justifyContent: 'center',
      columnGap: '0.55em',
      rowGap: '0.1em',
      // It has to sit somewhere, and plain white text is unreadable exactly
      // where it lands - on the sand - so it carries the same backing as the
      // score rather than relying on dark background being under it.
      background: 'rgba(0, 0, 0, 0.25)',
      padding: '4px 12px',
      borderRadius: '999px',
      textAlign: 'center',
      lineHeight: '1.4',
      pointerEvents: 'none',
    } satisfies Partial<CSSStyleDeclaration>);
    container.appendChild(this.hintEl);
  }

  /** Spells out the controls for whichever input device is currently in use,
   * so switching between phone and desktop never leaves the player guessing. */
  setHint(mode: 'touch' | 'keyboard'): void {
    const entries =
      mode === 'keyboard'
        ? [
            'WASD Laufen',
            'E Pass',
            'F Notfall',
            'Leertaste Block',
            'Q Schmettern/Aufschlag',
          ]
        : [];

    this.hintEl.textContent = '';
    entries.forEach((entry, i) => {
      const el = document.createElement('span');
      // The separator rides along with its entry so it can never be left
      // stranded at the start of a wrapped line.
      el.textContent = i === entries.length - 1 ? entry : `${entry} ·`;
      el.style.whiteSpace = 'nowrap';
      this.hintEl.appendChild(el);
    });

    // Touch play has no hint, and an empty pill is just a dark blob on the sand.
    this.hintEl.style.display = entries.length === 0 ? 'none' : 'flex';
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

    if (model.phase === 'point_scored' && model.lastFault) {
      this.faultEl.textContent = FAULT_TEXT[model.lastFault];
    } else if (model.awaitingServe) {
      this.faultEl.textContent = model.humanIsServing
        ? 'Dein Aufschlag'
        : 'Aufschlag der Gegenseite';
    } else {
      this.faultEl.textContent = '';
    }

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
