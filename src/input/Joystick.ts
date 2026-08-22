import { Vec2 } from '../utils/math';

const BASE_SIZE = 152; // px, visual only
const KNOB_SIZE = 72; // px, visual only
const MAX_RADIUS = (BASE_SIZE - KNOB_SIZE) / 2 + 20; // allow the knob to travel a bit past its own edge
// Invisible activation zone, concentric with the visible base but noticeably
// bigger - a touch starting anywhere in here grabs the stick, not just one
// landing precisely on the drawn circle.
const HITZONE_SIZE = 232; // px

/**
 * Fixed virtual joystick, bottom-left. Built from plain DOM elements + raw Pointer
 * Events (no external library) so it inlines cleanly into a single-file build.
 * `vector` is the normalized [-1, 1] x/y input, read every frame by the game loop.
 * The visible base+knob are purely decorative children centered inside a larger
 * invisible hit-zone, which is the actual pointer-event target.
 */
export class Joystick {
  vector: Vec2 = { x: 0, y: 0 };

  private readonly hitZone: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private pointerId: number | null = null;

  constructor(container: HTMLElement) {
    this.hitZone = document.createElement('div');
    this.hitZone.id = 'joystick-hitzone';
    Object.assign(this.hitZone.style, {
      position: 'absolute',
      left: '16px',
      bottom: 'max(56px, calc(env(safe-area-inset-bottom) + 24px))',
      width: `${HITZONE_SIZE}px`,
      height: `${HITZONE_SIZE}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      touchAction: 'none',
    } satisfies Partial<CSSStyleDeclaration>);

    const base = document.createElement('div');
    base.id = 'joystick-base';
    Object.assign(base.style, {
      position: 'relative',
      width: `${BASE_SIZE}px`,
      height: `${BASE_SIZE}px`,
      borderRadius: '50%',
      background: 'rgba(255, 255, 255, 0.18)',
      border: '2px solid rgba(255, 255, 255, 0.35)',
      pointerEvents: 'none',
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

    base.appendChild(this.knob);
    this.hitZone.appendChild(base);
    container.appendChild(this.hitZone);

    this.hitZone.addEventListener('pointerdown', this.onPointerDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.pointerId !== null) return;
    this.pointerId = e.pointerId;
    this.hitZone.setPointerCapture(e.pointerId);
    this.hitZone.addEventListener('pointermove', this.onPointerMove);
    this.hitZone.addEventListener('pointerup', this.onPointerUp);
    this.hitZone.addEventListener('pointercancel', this.onPointerUp);
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
    this.hitZone.removeEventListener('pointermove', this.onPointerMove);
    this.hitZone.removeEventListener('pointerup', this.onPointerUp);
    this.hitZone.removeEventListener('pointercancel', this.onPointerUp);
  };

  private updateFromEvent(e: PointerEvent): void {
    const rect = this.hitZone.getBoundingClientRect();
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
