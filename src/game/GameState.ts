import { AiAthlete, AiContext } from '../entities/AiAthlete';
import { Athlete, TeamId } from '../entities/Athlete';
import { Ball } from '../entities/Ball';
import { Player, PlayerContext } from '../entities/Player';
import { InputSnapshot } from '../input/actions';
import { Vec2, Vec3, randomBetween } from '../utils/math';
import {
  BALL_RADIUS,
  COURT_LENGTH,
  SLOWMO_MAX_REAL,
  SLOWMO_SCALE,
  COURT_WIDTH,
  HUMAN_HOMES,
  NET_Y,
  OPPONENT_HOMES,
  OPPONENT_PROFILE,
  SERVE_AI_FAULT_CHANCE,
  SERVE_TOSS_SPEED,
  TEAMMATE_PROFILE,
  WIN_MARGIN,
  WIN_SCORE,
} from './constants';
import { debugLog } from './Debug';
import { BallEvent, advance, simulate, velocityOverNet, velocityToTarget } from './Physics';
import { FaultReason, Rally, RallyResult } from './Rally';

export type GamePhase = 'rally' | 'point_scored' | 'game_over';

/** Pause after a point, long enough to read what happened. */
const POINT_PAUSE = 1.6;
/** Margin (m) kept away from the lines when picking a random serve target. */
const SERVE_MARGIN = 1.5;
/** Beat before an AI server puts the ball up, so a rally never opens abruptly. */
const SERVE_AI_DELAY = 0.8;

/**
 * Single source of truth for the game world: the four figures, the ball, the
 * rule book for the current rally, and the score.
 *
 * The loop is deliberately narrow. Physics reports what physically happened -
 * a contact, a net, a landing - and Rally turns that into a point. This class
 * only wires the two together and keeps the score.
 */
export class GameState {
  player = new Player();
  teammate = new AiAthlete('teammate', 'human', HUMAN_HOMES[0], TEAMMATE_PROFILE);
  opponents: AiAthlete[] = [
    new AiAthlete('opponent1', 'opponents', OPPONENT_HOMES[0], OPPONENT_PROFILE),
    new AiAthlete('opponent2', 'opponents', OPPONENT_HOMES[1], OPPONENT_PROFILE),
  ];
  ball = new Ball();

  score: Record<TeamId, number> = { human: 0, opponents: 0 };
  phase: GamePhase = 'rally';
  winner: TeamId | null = null;
  /** Whoever won the last rally serves the next one. */
  servingTeam: TeamId = 'opponents';
  rally = new Rally('opponents');
  /** Why the last point ended, for the HUD. */
  lastFault: FaultReason | null = null;
  lastEvent: BallEvent | null = null;

  /**
   * Which of each team's two players serves next. Real volleyball only
   * rotates the server of the team that *regains* the serve - a team that
   * keeps serving keeps the same server - so this changes in awardPoint()
   * only when the receiving side wins the rally.
   */
  serverIndex: Record<TeamId, 0 | 1> = { human: 0, opponents: 0 };
  /** True from the moment a rally opens until the serve has been struck. */
  awaitingServe = false;

  /** Tests switch this off to keep full control of what is in the air. */
  autoServe = true;
  /** Tests switch this off when they need the court to themselves. With the
   * AI frozen it never commits to a ball, so it never contacts one either. */
  aiEnabled = true;

  /**
   * How fast the world is running. 1 normally, SLOWMO_SCALE while the player
   * hangs at the top of an attack jump with the ball in reach.
   *
   * It scales the *whole* world - ball, players and opponents alike - so the
   * aiming time is never an advantage over anyone, only thinking room.
   */
  timeScale = 1;
  /** Game-time clock in ms. Ball-contact input buffers age on this rather than
   * on wall time; see Contact.Clock. */
  gameClockMs = 0;

  private pauseTimer = 0;
  private slowMoRealTimer = 0;
  /** True while the aiming window is open, so its start and end are logged
   * once each rather than every frame. */
  private aiming = false;
  private previewLogged = false;
  private aiServeTimer = 0;

  constructor() {
    // Open the first rally straight away. Without this the game sits forever
    // with the ball on its reset position in the middle of the court, because
    // every other route into beginRally() runs off the end of a *previous*
    // rally and there has not been one yet.
    this.beginRally();
  }

  get athletes(): Athlete[] {
    return [this.player, this.teammate, ...this.opponents];
  }

  /** The three computer-controlled figures. */
  get aiAthletes(): AiAthlete[] {
    return [this.teammate, ...this.opponents];
  }

  /**
   * The world as one AI needs to see it. `partner` is the other figure on its
   * own team - for the teammate that is the human, which is what makes it
   * defer to them and set the ball to them.
   */
  private aiContext(ai: AiAthlete): AiContext {
    const isHumanTeam = ai.team === 'human';
    return {
      ball: this.ball,
      rally: this.rally,
      partner: isHumanTeam
        ? ai.id === 'teammate'
          ? this.player
          : this.teammate
        : this.opponents[ai.id === 'opponent1' ? 1 : 0],
      rivals: isHumanTeam ? this.opponents : [this.player, this.teammate],
      awaitingServe: this.awaitingServe,
      isServer: this.server.id === ai.id,
    };
  }

  /** The athlete whose serve it is. */
  get server(): Athlete {
    return this.servingTeam === 'human'
      ? [this.player, this.teammate][this.serverIndex.human]
      : this.opponents[this.serverIndex.opponents];
  }

  /** Whether the human player is the one holding serve, which is what puts
   * the interface into its serve layout. */
  get humanIsServing(): boolean {
    return this.servingTeam === 'human' && this.serverIndex.human === 0;
  }

  /**
   * `realDt` is wall-clock delta. Everything downstream of the slow-motion
   * decision runs on the scaled delta instead, which is what makes the aiming
   * phase slow down the ball and the player together rather than one of them.
   */
  update(realDt: number, input: InputSnapshot, nowMs: number): void {
    if (this.phase === 'game_over') return;

    if (this.phase === 'point_scored') {
      this.pauseTimer += realDt;
      if (this.pauseTimer >= POINT_PAUSE) this.beginRally();
      return;
    }

    this.updateSlowMotion(realDt);
    const dt = realDt * this.timeScale;
    this.gameClockMs += dt * 1000;

    const ctx = this.playerContext(input.aim, nowMs);
    this.player.update(dt, input, ctx);
    if (this.aiEnabled) {
      for (const ai of this.aiAthletes) ai.update(dt, nowMs, this.aiContext(ai));
    }
    if (this.awaitingServe) this.updateServeHold(dt);

    const event = advance(
      this.ball,
      dt,
      this.athletes,
      {
        onTouch: (athlete, ball, atMs) => this.handleTouch(athlete, ball, atMs, ctx),
        onNetCross: (_ball, to) => this.rally.registerNetCross(to),
      },
      nowMs,
    );

    if (event) {
      this.lastEvent = event;
      // A tossed ball that reaches the ground untouched is a missed serve, not
      // an ordinary point: nobody has played it, so Rally is still in its
      // serving state and names the fault accordingly.
      const result =
        this.awaitingServe && this.ball.lastToucher === null
          ? this.rally.serveMissed(this.servingTeam)
          : this.rally.resolveEvent(event);
      this.awardPoint(result);
      return;
    }

    // A dead ball with nobody serving is not a state play can continue from:
    // it means a rally ended without another being opened. This has to come
    // after the event above - a landing kills the ball too, and jumping
    // straight to a new rally here would swallow the point it just decided.
    if (this.autoServe && !this.awaitingServe && this.ball.state === 'dead') {
      this.beginRally();
    }
  }

  restart(): void {
    this.score = { human: 0, opponents: 0 };
    this.winner = null;
    this.lastFault = null;
    this.lastEvent = null;
    this.servingTeam = 'opponents';
    this.serverIndex = { human: 0, opponents: 0 };
    this.player = new Player();
    this.ball.reset();
    this.beginRally();
  }

  /**
   * Opens a fresh rally and hands the ball to whoever is due to serve.
   *
   * The human serving and an AI serving are the same state - the ball is held
   * at the server's hand and the rally has not started - they differ only in
   * what releases it.
   */
  beginRally(): void {
    this.pauseTimer = 0;
    this.phase = 'rally';
    this.rally = new Rally(this.servingTeam);
    this.ball.reset();
    this.player.resetForNewRally();
    for (const ai of this.aiAthletes) ai.resetForNewRally();
    if (!this.autoServe) return;

    const server = this.server;
    server.pos = server.clampToOwnHalf({ x: server.pos.x, y: server.baselineY });
    this.awaitingServe = true;
    this.aiServeTimer = SERVE_AI_DELAY;
    if (this.humanIsServing) this.player.beginServe();
    this.ball.hold(server.handPosition);
  }

  /**
   * Runs while the ball is still in the server's hand.
   *
   * For the human that means keeping the ball pinned to their hand until they
   * toss it; for an AI server it means a short beat and then an automatic
   * serve. The toss itself is just a normal launch - once it is up, the ball
   * is an ordinary projectile and the swing has to meet it like any other.
   */
  private updateServeHold(dt: number): void {
    if (this.humanIsServing) {
      if (this.player.pendingToss) {
        this.player.pendingToss = false;
        this.ball.strike(this.player.handPosition, { x: 0, y: 0, z: SERVE_TOSS_SPEED }, null);
      } else if (this.ball.state === 'held') {
        this.ball.hold(this.player.handPosition);
      }
      return;
    }

    // Only ever re-pin a ball that is genuinely still in hand. Anything else
    // in the air belongs to whatever put it there.
    if (this.ball.state !== 'held') return;
    this.ball.hold(this.server.handPosition);
    this.aiServeTimer -= dt;
    if (this.aiServeTimer <= 0) this.fireAiServe();
  }

  /** An automatic serve, with a small chance of being aimed somewhere it will
   * genuinely miss - the AI is allowed to serve into the net or long. */
  private fireAiServe(): void {
    const server = this.server;
    const origin = server.handPosition;
    const receiving: [number, number] =
      this.servingTeam === 'human'
        ? [SERVE_MARGIN, NET_Y - SERVE_MARGIN]
        : [NET_Y + SERVE_MARGIN, COURT_LENGTH - SERVE_MARGIN];

    const faulty = Math.random() < SERVE_AI_FAULT_CHANCE;
    const target: Vec2 = faulty
      ? {
          x: randomBetween(SERVE_MARGIN, COURT_WIDTH - SERVE_MARGIN),
          // Just past the far base line: out, and visibly so.
          y: this.servingTeam === 'human' ? randomBetween(-1.2, -0.3) : randomBetween(COURT_LENGTH + 0.3, COURT_LENGTH + 1.2),
        }
      : {
          x: randomBetween(SERVE_MARGIN, COURT_WIDTH - SERVE_MARGIN),
          y: randomBetween(receiving[0], receiving[1]),
        };

    this.ball.strike(origin, velocityOverNet(origin, target, 0.6), server.id);
    // The serve is the serving team's first contact; put it through the rule
    // book like any other so the server cannot immediately play it again.
    this.rally.registerTouch(server);
    this.awaitingServe = false;
  }

  /** Puts a specific ball into play - used by tests to set up a known flight. */
  launchBall(from: { x: number; y: number; z?: number }, target: Vec2, time: number): void {
    const origin = { x: from.x, y: from.y, z: from.z ?? BALL_RADIUS };
    this.ball.strike(origin, velocityToTarget(origin, target, time), null);
  }

  /**
   * A contact, offered from inside the physics substep where the hitboxes met.
   * The athlete decides whether they actually play it (they only do if an
   * action was buffered); the rule book then judges the contact that resulted.
   */
  private handleTouch(
    athlete: Athlete,
    ball: Ball,
    atMs: number,
    ctx: PlayerContext,
  ): boolean {
    const kind =
      athlete instanceof Player
        ? athlete.playBall(ball, atMs, ctx)
        : athlete instanceof AiAthlete
          ? athlete.playBall(ball, atMs, this.aiContext(athlete))
          : null;
    if (!kind) return false;

    // Striking the toss ends the serve: the interface goes back to the rally
    // buttons and the server may move freely again.
    if (this.awaitingServe) {
      this.awaitingServe = false;
      this.player.endServe();
    }

    // A block is judged by a different rule than a normal contact: it costs no
    // touch and lets the blocker play the next ball.
    if (kind === 'block') {
      this.rally.registerBlock(athlete);
      return true;
    }

    const fault = this.rally.registerTouch(athlete);
    if (fault) this.awardPoint(fault);
    return true;
  }

  /**
   * The world as the human player needs to see it this frame. `mayTouch` is
   * the important part: it is false the moment the player has taken the last
   * contact, which is what stops the speed boost from dragging them back into
   * the ball for an illegal second touch.
   */
  private playerContext(aim: Vec2 | null, nowMs: number): PlayerContext {
    const state = this;
    return {
      ball: this.ball,
      partner: this.teammate,
      clock: { wallMs: nowMs, gameMs: this.gameClockMs },
      // A getter, not a snapshot: the answer changes the instant the player
      // takes a contact, and the boost has to notice within the same frame
      // rather than one frame later.
      get mayTouch(): boolean {
        return state.phase === 'rally' && state.rally.lastToucher !== state.player.id;
      },
      aim,
    };
  }

  /**
   * Slow motion runs on real seconds, not game seconds: it exists to give the
   * player thinking time, and a budget measured in slowed-down time would
   * stretch itself. It is also capped, so hanging at the top of a jump can
   * never freeze the game indefinitely.
   */
  private updateSlowMotion(realDt: number): void {
    const wants = this.phase === 'rally' && this.player.wantsAimTime(this.ball);
    if (!wants) {
      if (this.aiming) {
        this.aiming = false;
        this.previewLogged = false;
        debugLog.aim({ stage: 'aim_phase_ended' });
      }
      this.slowMoRealTimer = 0;
      this.timeScale = 1;
      return;
    }
    if (!this.aiming) {
      this.aiming = true;
      debugLog.aim({ stage: 'aim_phase_started', note: 'player hanging at the top of the jump with the ball in reach' });
    }
    this.slowMoRealTimer += realDt;
    this.timeScale = this.slowMoRealTimer <= SLOWMO_MAX_REAL ? SLOWMO_SCALE : 1;
  }

  /** The flight the player's current aim would produce, for the preview line.
   * Null whenever there is nothing to aim. */
  aimPreview(): Vec3[] | null {
    if (this.timeScale === 1 || this.ball.state !== 'live') return null;
    const path = simulate({ ...this.ball.pos }, this.player.previewSpike(this.ball));
    // Once per aiming window, for the same reason as Renderer.drawAimPath.
    if (!this.previewLogged) {
      this.previewLogged = true;
      debugLog.aim({ stage: 'trajectory_computed', points: path.length });
    }
    return path;
  }

  /** Ends the current rally with the given result: scores it, moves the serve
   * and, if the receiving side won, rotates their server. Public because it is
   * the one entry point for "this rally ended this way". */
  awardPoint(result: RallyResult): void {
    if (this.phase !== 'rally') return;

    this.ball.kill();
    this.score[result.winner] += 1;
    // Only a team that wins the serve back rotates its server; one that holds
    // serve keeps serving with the same player.
    if (result.winner !== this.servingTeam) {
      this.serverIndex[result.winner] = this.serverIndex[result.winner] === 0 ? 1 : 0;
    }
    this.servingTeam = result.winner;
    this.lastFault = result.reason;
    this.awaitingServe = false;
    this.player.endServe();

    const winning = this.score[result.winner];
    const losing = this.score[result.loser];
    if (winning >= WIN_SCORE && winning - losing >= WIN_MARGIN) {
      this.winner = result.winner;
      this.phase = 'game_over';
      return;
    }

    this.phase = 'point_scored';
    this.pauseTimer = 0;
    this.timeScale = 1;
    this.slowMoRealTimer = 0;
    this.player.standDown();
  }
}
