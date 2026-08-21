import { Vec2 } from '../utils/math';

const BASE_SIZE = 120; // px
const KNOB_SIZE = 56; // px
const MAX_RADIUS = (BASE_SIZE - KNOB_SIZE) / 2 + 20; // allow the knob to travel a bit past its own edge

/**
 * Fixed virtual joystick, bottom-left. Built from plain DOM elements + raw Pointer
 * Events (no external library) so it inlines cleanly into a single-file build.
 * `vector` is the normalized [-1, 1] x/y input, read every frame by the game loop.
 */
export class Joystick {
  vector: Vec2 = { x: 0, y: 0 };

  private readonly base: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointerId: number | null = null;

  constructor(container: HTMLElement) {
    this.base = document.createElement('div');
    this.base.id = 'joystick-base';
    Object.assign(this.base.style, {
      position: 'absolute',
      left: '24px',
      bottom: 'max(24px, env(safe-area-inset-bottom))',
      width: `${BASE_SIZE}px`,
      height: `${BASE_SIZE}px`,
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.18)',
      border: '2px solid rgba(255, 255, 255, 0.35)',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    this.knob = document.createElement('div');
    Object.assign(this.knob.style, {
      position: 'absolute',
      left: `${(BASE_SIZE - KNOB_SIZE) / 2}px`,
      top: `${(BASE_SIZE - KNOB_SIZE) / 2}px`,
      width: `${KNOB_SIZE}px`,
      height: `${KNOB_SIZE}px`,
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.75)',
      transition: 'transform 0.05s linear',
    } satisfies Partial<CSSStyleDeclaration>);

    this.base.appendChild(this.knob);
    container.appendChild(this.base);

    this.base.addEventListener('pointerdown', this.onPointerDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.base.setPointerCapture(e.pointerId);
    this.base.addEventListener('pointermove', this.onPointerMove);
    this.base.addEventListener('pointerup', this.onPointerUp);
    this.base.addEventListener('pointercancel', this.onPointerUp);
    this.updateFromEvent(e);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.updateFromEvent(e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.vector = { x: 0, y: 0 };
    this.knob.style.transform = 'translate(0, 0)';
    this.base.removeEventListener('pointermove', this.onPointerMove);
    this.base.removeEventListener('pointerup', this.onPointerUp);
    this.base.removeEventListener('pointercancel', this.onPointerUp);
  };

  private updateFromEvent(e: PointerEvent): void {
    const rect = this.base.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    const dist = Math.min(Math.hypot(dx, dy), MAX_RADIUS);
    const angle = Math.atan2(dy, dx);
    const kx = Math.cos(angle) * dist;
    const ky = Math.sin(angle) * dist;
    this.knob.style.transform = `translate(${kx}px, ${ky}px)`;
    this.vector = { x: kx / MAX_RADIUS, y: ky / MAX_RADIUS };
  }
}
