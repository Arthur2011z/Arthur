import { AthleteId } from '../entities/Athlete';
import { ActionType } from '../input/actions';

/** One completed action, from the moment the key went down to the moment the
 * ball's velocity actually changed. */
export interface ContactRecord {
  kind: 'contact';
  athlete: AthleteId;
  action: ActionType;
  /** performance.now() when the button/key was pressed. */
  pressedAt: number;
  /** performance.now() of the substep in which the hitboxes first overlapped. */
  touchedAt: number;
  /** performance.now() at which the ball's velocity was changed. */
  executedAt: number;
  /** How long the player waited for the ball after pressing. */
  waitMs: number;
  /** Delay between physical touch and effect. Must always be 0. */
  latencyMs: number;
}

/** An action that was pressed but never met the ball inside the buffer window. */
export interface ExpiredRecord {
  kind: 'expired';
  athlete: AthleteId;
  action: ActionType;
  pressedAt: number;
  expiredAt: number;
  heldMs: number;
}

/**
 * One link in the chain that turns an aiming swipe into a spike: the aim phase
 * opening, the finger going down, moving and lifting, the trajectory being
 * computed, and the preview line being drawn.
 *
 * Contact records answer "did the ball move at the right moment". These answer
 * a different question - "did the input reach the code that moves it at all" -
 * and that is a chain with six links, any one of which can quietly swallow the
 * gesture. Logging each one means the break can be located instead of guessed
 * at.
 */
export interface AimRecord {
  kind: 'aim';
  stage:
    | 'aim_phase_started'
    | 'aim_phase_ended'
    | 'swipe_down'
    | 'swipe_move'
    | 'swipe_up'
    | 'aim_applied'
    | 'trajectory_computed'
    | 'preview_drawn'
    | 'swing_started';
  at: number;
  /** Screen-space finger position, for the pointer stages. */
  x?: number;
  y?: number;
  /** Travel in px and the resulting 0..1 strength, for swipe_move / swipe_up. */
  travelPx?: number;
  strength?: number;
  /** Court-space aim direction once it has been applied to the player. */
  dirX?: number;
  dirY?: number;
  /** Points in the computed preview polyline. */
  points?: number;
  /** Free-text reason a stage did nothing. */
  note?: string;
}

export type DebugRecord = ContactRecord | ExpiredRecord | AimRecord;

const MAX_RECORDS = 200;

/**
 * Action-timing instrumentation.
 *
 * Ball contact is the part of this game that has historically gone wrong -
 * actions firing before the ball had physically arrived - so every action
 * records three timestamps: when it was asked for, when the hitboxes actually
 * met, and when the ball's velocity actually changed. The last two must always
 * be identical; if they ever are not, the contact rule has been bypassed.
 *
 * Records are always collected (the buffer is small and bounded), but they are
 * only printed when debugging is switched on - via `?debug=1` in the URL or by
 * setting `window.__debug = true` at runtime.
 */
class DebugLog {
  readonly records: DebugRecord[] = [];
  enabled = false;

  constructor() {
    try {
      this.enabled = new URLSearchParams(window.location.search).get('debug') === '1';
    } catch {
      this.enabled = false;
    }
  }

  contact(record: Omit<ContactRecord, 'kind' | 'waitMs' | 'latencyMs'>): void {
    this.push({
      kind: 'contact',
      ...record,
      waitMs: record.touchedAt - record.pressedAt,
      latencyMs: record.executedAt - record.touchedAt,
    });
  }

  expired(record: Omit<ExpiredRecord, 'kind' | 'heldMs'>): void {
    this.push({
      kind: 'expired',
      ...record,
      heldMs: record.expiredAt - record.pressedAt,
    });
  }

  aim(record: Omit<AimRecord, 'kind' | 'at'> & { at?: number }): void {
    this.push({ kind: 'aim', at: performance.now(), ...record });
  }

  clear(): void {
    this.records.length = 0;
  }

  private push(record: DebugRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    if (!this.isEnabled()) return;

    if (record.kind === 'aim') {
      const bits = [
        record.x !== undefined ? `at=(${record.x.toFixed(0)}, ${record.y?.toFixed(0)})` : '',
        record.travelPx !== undefined ? `travel=${record.travelPx.toFixed(0)}px` : '',
        record.strength !== undefined ? `strength=${record.strength.toFixed(2)}` : '',
        record.dirX !== undefined ? `dir=(${record.dirX.toFixed(2)}, ${record.dirY?.toFixed(2)})` : '',
        record.points !== undefined ? `points=${record.points}` : '',
        record.note ?? '',
      ].filter(Boolean);
      // eslint-disable-next-line no-console
      console.log(`[aim] ${record.stage} t=${record.at.toFixed(1)}ms ${bits.join(' ')}`);
      return;
    }

    if (record.kind === 'contact') {
      // eslint-disable-next-line no-console
      console.log(
        `[contact] ${record.athlete}/${record.action}` +
          ` pressed=${record.pressedAt.toFixed(1)}ms` +
          ` touched=${record.touchedAt.toFixed(1)}ms` +
          ` executed=${record.executedAt.toFixed(1)}ms` +
          ` | waited ${record.waitMs.toFixed(1)}ms for the ball,` +
          ` executed ${record.latencyMs.toFixed(1)}ms after touch`,
      );
    } else {
      // eslint-disable-next-line no-console
      console.log(
        `[expired] ${record.athlete}/${record.action}` +
          ` pressed=${record.pressedAt.toFixed(1)}ms` +
          ` - ball never arrived within ${record.heldMs.toFixed(1)}ms, input discarded`,
      );
    }
  }

  private isEnabled(): boolean {
    const override = (window as { __debug?: boolean }).__debug;
    return override ?? this.enabled;
  }
}

export const debugLog = new DebugLog();
