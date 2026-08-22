const ATTACK_SIZE = 88; // px, primary action
const REACH_SIZE = 72; // px, secondary
const PASS_SIZE = 76; // px, secondary

const GAP = 14; // px, between Schlag and Pass
const EDGE = 24; // px, from the screen edge
const SAFE_BOTTOM = `max(${EDGE}px, env(safe-area-inset-bottom))`;

/** The three action buttons, bottom-right: Schlag (attack) sits in the
 * corner, Pass to its left, Sprung/Hecht (reach) above - a small triangular
 * cluster reachable by thumb without moving the hand. All three are always
 * fully enabled; there is no gesture recognition anywhere in the game, just
 * these buttons plus the joystick. */
export class Buttons {
  private reachPending = false;
  private attackPending = false;
  private passPending = false;

  private readonly reachEl: HTMLButtonElement;
  private readonly attackEl: HTMLButtonElement;
  private readonly passEl: HTMLButtonElement;

  constructor(container: HTMLElement) {
    this.attackEl = document.createElement('button');
    this.attackEl.id = 'attack-btn';
    this.attackEl.type = 'button';
    this.attackEl.textContent = 'Schlag';
    Object.assign(this.attackEl.style, {
      position: 'absolute',
      right: `${EDGE}px`,
      bottom: SAFE_BOTTOM,
      width: `${ATTACK_SIZE}px`,
      height: `${ATTACK_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(230, 57, 70, 0.85)',
      color: '#fff',
      font: '600 15px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.passEl = document.createElement('button');
    this.passEl.id = 'pass-btn';
    this.passEl.type = 'button';
    this.passEl.textContent = 'Pass';
    Object.assign(this.passEl.style, {
      position: 'absolute',
      right: `${EDGE + ATTACK_SIZE + GAP}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${(ATTACK_SIZE - PASS_SIZE) / 2}px)`,
      width: `${PASS_SIZE}px`,
      height: `${PASS_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(42, 157, 143, 0.85)',
      color: '#fff',
      font: '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.reachEl = document.createElement('button');
    this.reachEl.id = 'reach-btn';
    this.reachEl.type = 'button';
    this.reachEl.textContent = 'Sprung';
    Object.assign(this.reachEl.style, {
      position: 'absolute',
      right: `${EDGE + (ATTACK_SIZE - REACH_SIZE) / 2}px`,
      bottom: `calc(${SAFE_BOTTOM} + ${ATTACK_SIZE + 16}px)`,
      width: `${REACH_SIZE}px`,
      height: `${REACH_SIZE}px`,
      borderRadius: '50%',
      border: '2px solid rgba(255, 255, 255, 0.5)',
      background: 'rgba(38, 70, 83, 0.85)',
      color: '#fff',
      font: '600 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    container.appendChild(this.passEl);
    container.appendChild(this.reachEl);
    container.appendChild(this.attackEl);
    this.attackEl.addEventListener('pointerdown', this.onAttackPointerDown);
    this.passEl.addEventListener('pointerdown', this.onPassPointerDown);
    this.reachEl.addEventListener('pointerdown', this.onReachPointerDown);
  }

  /** Edge-triggered read: true only on the frame Sprung/Hecht was pressed. */
  consumeReach(): boolean {
    const v = this.reachPending;
    this.reachPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame Schlag was pressed. */
  consumeAttack(): boolean {
    const v = this.attackPending;
    this.attackPending = false;
    return v;
  }

  /** Edge-triggered read: true only on the frame Pass was pressed. */
  consumePass(): boolean {
    const v = this.passPending;
    this.passPending = false;
    return v;
  }

  private onReachPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.reachPending = true;
  };

  private onAttackPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.attackPending = true;
  };

  private onPassPointerDown = (e: PointerEvent): void => {
    e.preventDefault();
    this.passPending = true;
  };
}
