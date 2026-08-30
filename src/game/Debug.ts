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

/**
 * What an AI did with one ball, recorded at the contact itself.
 *
 * `targetUsed` is deliberately not a copy of `targetComputed`: it is read back
 * out of the velocity the ball was actually given, by integrating that flight
 * forward. A target that is computed correctly and then lost, overwritten or
 * scattered somewhere else on the way to the ball shows up as a difference
 * between the two, which reading the intent alone could never reveal.
 */
export interface SetRecord {
  kind: 'set';
  at: number;
  athlete: AthleteId;
  /** Which branch of the decision this was. */
  decision: 'set_to_partner' | 'attack_last_contact' | 'attack_set_pointless';
  /** Where the setter stood at the moment of contact. */
  fromX: number;
  fromY: number;
  /** Where the partner it is setting to stood at that moment. */
  partnerX: number;
  partnerY: number;
  /** Distance from the net the partner had, before any lead is applied. */
  partnerNetDistance: number;
  /** The target the decision logic computed. */
  targetX: number;
  targetY: number;
  /** Where the launched ball actually arrives, integrated from its velocity. */
  usedX: number;
  usedY: number;
  /** Height at that arrival point. */
  usedZ: number;
  /** Contacts the team had used before this one. */
  touches: number;
}

export type DebugRecord = ContactRecord | ExpiredRecord | AimRecord | SetRecord;

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

  set(record: Omit<SetRecord, 'kind' | 'at'>): void {
    this.push({ kind: 'set', at: performance.now(), ...record });
  }

  clear(): void {
    this.records.length = 0;
  }

  private push(record: DebugRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_RECORDS) this.records.shift();
    if (!this.isEnabled()) return;

    if (record.kind === 'set') {
      const p = (x: number, y: number) => `(${x.toFixed(2)}, ${y.toFixed(2)})`;
      // eslint-disable-next-line no-console
      console.log(
        `[set] ${record.athlete} ${record.decision}` +
          ` touches=${record.touches}` +
          ` | KI ${p(record.fromX, record.fromY)}` +
          ` Partner ${p(record.partnerX, record.partnerY)}` +
          ` (Netzabstand ${record.partnerNetDistance.toFixed(2)}m)` +
          ` | Ziel berechnet ${p(record.targetX, record.targetY)}` +
          ` -> tatsächlich ${p(record.usedX, record.usedY)} auf z=${record.usedZ.toFixed(2)}m`,
      );
      return;
    }

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
