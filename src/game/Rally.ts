import { Athlete, AthleteId, TeamId } from '../entities/Athlete';
import { MAX_TOUCHES_PER_TEAM } from './constants';
import { BallEvent } from './Physics';

export type FaultReason =
  | 'four_touches'
  | 'double_contact'
  | 'net'
  | 'out'
  | 'grounded'
  | 'serve_missed';

export interface RallyResult {
  winner: TeamId;
  loser: TeamId;
  reason: FaultReason;
}

export const other = (team: TeamId): TeamId => (team === 'human' ? 'opponents' : 'human');

/** Human-readable explanations, shown in the HUD after each point. */
export const FAULT_TEXT: Record<FaultReason, string> = {
  four_touches: 'Vierter Ballkontakt',
  double_contact: 'Zweimal hintereinander berührt',
  net: 'Ball ins Netz',
  out: 'Ball im Aus',
  grounded: 'Ball im Feld aufgekommen',
  serve_missed: 'Aufschlagfehler',
};

/**
 * The rule book for a single rally.
 *
 * It owns three pieces of state - who has possession, how many touches they
 * have used, and who touched last - and turns every event the physics reports
 * into either "play on" or a finished rally with a reason. Nothing else in the
 * game decides who won a point.
 *
 * The contact rules follow real volleyball rather than a simplified stand-in:
 * a team gets three touches before the ball must cross, and no player may
 * touch the ball twice in a row - but a player *may* take the first and third
 * touch, with their partner in between.
 */
export class Rally {
  /** Team currently entitled to touches, i.e. the side the ball is on. */
  possession: TeamId;
  touches = 0;
  lastToucher: AthleteId | null = null;
  /** True while the serve is still in flight and has not yet crossed. */
  serving = true;

  constructor(servingTeam: TeamId) {
    this.possession = servingTeam;
  }

  /**
   * Registers a normal contact. Returns a result if the contact itself was a
   * fault, otherwise null.
   *
   * Note that a fault is registered, not prevented: touching the ball twice in
   * a row is a real thing a player can do, and losing the point for it is the
   * rule. Nothing here silently swallows a contact.
   */
  registerTouch(athlete: Athlete): RallyResult | null {
    if (this.lastToucher === athlete.id) {
      return this.fault(athlete.team, 'double_contact');
    }

    if (this.possession !== athlete.team) {
      // The ball came over without a crossing being seen (or a block put it
      // back on this side): this team starts a fresh set of touches.
      this.possession = athlete.team;
      this.touches = 0;
    }

    this.lastToucher = athlete.id;
    this.touches += 1;
    this.serving = false;

    if (this.touches > MAX_TOUCHES_PER_TEAM) {
      return this.fault(athlete.team, 'four_touches');
    }
    return null;
  }

  /**
   * Registers a block. Under the indoor rule chosen for this game a block is
   * not one of the three touches, and the blocker may play the very next ball
   * - so the touch count is reset and the "not twice in a row" lock is
   * deliberately released.
   */
  registerBlock(athlete: Athlete): void {
    this.possession = athlete.team;
    this.touches = 0;
    this.lastToucher = null;
    this.serving = false;
  }

  /** The ball legally passed over the net: the receiving team starts fresh. */
  registerNetCross(to: TeamId): void {
    this.possession = to;
    this.touches = 0;
    this.serving = false;
  }

  /** Turns the event that ended a flight into the point it decided. */
  resolveEvent(event: BallEvent): RallyResult {
    const striker = this.teamOf(this.lastToucher);

    if (event.type === 'net') {
      // Whoever put it into the net loses it; with nobody having touched it,
      // blame the side it was travelling from.
      return this.fault(striker ?? event.side, 'net');
    }

    if (!event.inBounds) {
      return this.fault(striker ?? event.side, 'out');
    }

    // In bounds and on the sand: the side it landed on failed to return it.
    // That also covers a team knocking the ball down on its own side.
    return this.fault(event.side, 'grounded');
  }

  /** The server jumped but never made contact. */
  serveMissed(servingTeam: TeamId): RallyResult {
    return this.fault(servingTeam, 'serve_missed');
  }

  /** Which team an athlete id belongs to, without needing the instance. */
  private teamOf(id: AthleteId | null): TeamId | null {
    if (id === null) return null;
    return id === 'player' || id === 'teammate' ? 'human' : 'opponents';
  }

  private fault(loser: TeamId, reason: FaultReason): RallyResult {
    return { winner: other(loser), loser, reason };
  }
}
