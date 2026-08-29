import { Vec2, Vec3, clamp, length, randomBetween, sub } from '../utils/math';
import {
  AI_CONTACT_HEIGHT,
  AI_HUMAN_PRIORITY_MARGIN,
  AI_SETTLE_RANGE,
  AI_ZONE_TRACKING,
  AI_ATTACK_MAX_DEPTH,
  AI_ATTACK_MIN_DEPTH,
  AI_MIN_SET_DISTANCE,
  AI_SPIKE_MAX_NET_DISTANCE,
  AI_SPIKE_MIN_HEIGHT,
  AiProfile,
  BACK_ZONE_HOME_DEPTH,
  BLOCK_NET_RANGE,
  COURT_WIDTH,
  MAX_TOUCHES_PER_TEAM,
  NET_ZONE_HOME_DEPTH,
  NET_Y,
  ZONE_SPLIT_DEPTH,
} from '../game/constants';
import { debugLog } from '../game/Debug';
import { predictAtHeight } from '../game/Physics';
import { Rally } from '../game/Rally';
import { aiAttackShot, blockShot, farHalfY, passShot, passTarget } from '../game/Shots';
import { Athlete, AthleteId, TeamId } from './Athlete';
import { Ball } from './Ball';
import { ContactKind } from './Player';

export interface AiContext {
  ball: Ball;
  rally: Rally;
  /** The other athlete on this AI's team - human or AI. */
  partner: Athlete;
  /** The other team, for reading an incoming attack. */
  rivals: Athlete[];
  /** True while the ball is still in a server's hand. */
  awaitingServe: boolean;
  /** True if this particular AI is the one holding serve. */
  isServer: boolean;
}

type AiState = 'holding' | 'chasing' | 'blocking';

/**
 * Both AI figures - the human's partner and the two opponents - are this one
 * class with different numbers. They share their positioning, their approach
 * to the ball, their contact rule and their block; what differs is entirely in
 * the AiProfile, which is what keeps defensive skill and attacking skill from
 * ever leaking into one another.
 *
 * The contact rule is the same one the human plays under. Deciding to go for a
 * ball is this AI's equivalent of a buffered button press: the decision is made
 * in advance, and the effect on the ball happens only in the physics substep
 * where the hitboxes genuinely overlap.
 */
export class AiAthlete extends Athlete {
  state: AiState = 'holding';
  /** True once this AI has committed to playing the current ball. */
  committed = false;

  private reactionTimer = 0;
  private committedAt = 0;

  constructor(
    id: AthleteId,
    team: TeamId,
    home: Vec2,
    readonly profile: AiProfile,
  ) {
    super(id, team, home);
  }

  update(dt: number, nowMs: number, ctx: AiContext): void {
    // Holding serve means standing still on the base line. Without this the
    // server would wander off toward its zone with the ball still in hand.
    if (ctx.awaitingServe && ctx.isServer) {
      this.pos = this.clampToOwnHalf({ x: this.pos.x, y: this.baselineY });
      this.pose = 'serving';
      return;
    }

    this.updateBlock(dt);
    if (this.blocking) {
      this.pose = 'blocking';
      return; // committed to the jump
    }

    if (this.shouldBlock(ctx)) {
      this.startBlock(nowMs);
      this.state = 'blocking';
      return;
    }

    if (this.shouldChase(ctx)) {
      this.reactionTimer += dt;
      if (this.reactionTimer >= this.profile.reactionDelay) {
        if (!this.committed) {
          this.committed = true;
          this.committedAt = nowMs;
        }
        this.state = 'chasing';
        this.moveToward(this.interceptPoint(ctx.ball), dt);
        this.pose = 'running';
        return;
      }
    } else {
      this.reactionTimer = 0;
      this.committed = false;
    }

    this.state = 'holding';
    const home = this.zoneHome(ctx);
    const moved = this.moveToward(home, dt);
    this.pose = moved ? 'running' : 'idle';
  }

  /** Clears everything belonging to the rally just finished. */
  resetForNewRally(): void {
    this.committed = false;
    this.reactionTimer = 0;
    this.state = 'holding';
    this.jumpHeight = 0;
    this.blockCooldown = 0;
    if (this.blocking) this.endBlock();
    this.pose = 'idle';
  }

  /**
   * Called from inside the physics substep where the hitboxes actually
   * overlap. Returns null unless this AI had already committed to playing the
   * ball - the same "decide first, act only on contact" rule the human plays
   * under, and the reason an AI can miss a ball it went for.
   */
  playBall(ball: Ball, atMs: number, ctx: AiContext): ContactKind {
    if (this.blocking) {
      ball.strike({ ...ball.pos }, blockShot(this, ball), this.id);
      this.logContact('block', this.blockStartedAt, atMs);
      this.endBlock();
      return 'block';
    }

    if (!this.committed) return null;
    if (ctx.rally.lastToucher === this.id) return null;

    ball.strike({ ...ball.pos }, this.chooseShot(ball, ctx), this.id);
    this.logContact('play', this.committedAt, atMs);
    this.committed = false;
    this.reactionTimer = 0;
    this.pose = 'swinging';
    return 'play';
  }

  // -------------------------------------------------------------------------
  // Deciding what to do
  // -------------------------------------------------------------------------

  /**
   * Whether to go for this ball. Every condition has to hold, and the first of
   * them is the double-contact rule: an AI that just played the ball does not
   * even set off after it, which is the difference between obeying the rule and
   * merely being refused by it later.
   */
  private shouldChase(ctx: AiContext): boolean {
    const { ball, rally } = ctx;
    if (ball.state !== 'live' || ctx.awaitingServe) return false;
    if (rally.lastToucher === this.id) return false;
    if (rally.touches >= MAX_TOUCHES_PER_TEAM && rally.possession === this.team) return false;

    const spot = this.interceptPoint(ball);
    if (!this.ownsSide(spot)) return false;
    if (length(sub(spot, this.pos)) > this.profile.defenceReach) return false;

    return this.isClosest(spot, ctx);
  }

  /**
   * Whether this AI, rather than its partner, should take the ball.
   *
   * Against the human the test is deliberately asymmetric: the AI only takes a
   * ball it is *clearly* closer to, so a tie - or merely jogging past the spot
   * on the way to its zone - leaves the play to the player. Taking a ball off
   * the person holding the controller is worse than letting one drop.
   */
  private isClosest(spot: Vec2, ctx: AiContext): boolean {
    // A partner who just played the ball may not touch it again, so however
    // close they are standing they are not an option. Without this the AI
    // politely defers to someone who physically cannot come - and since a set
    // lands near whoever played it, that is exactly the situation after every
    // set. The ball then drops between the two of them.
    if (ctx.rally.lastToucher === ctx.partner.id) return true;

    const mine = length(sub(spot, this.pos));
    const theirs = length(sub(spot, ctx.partner.pos));
    if (ctx.partner.id === 'player') return mine <= theirs - AI_HUMAN_PRIORITY_MARGIN;
    return mine <= theirs;
  }

  /** Reads an attack coming from the other side: someone airborne near the
   * net, on their own half, is about to hit. */
  private shouldBlock(ctx: AiContext): boolean {
    if (!this.canBlock() || ctx.ball.state !== 'live') return false;
    const attacker = ctx.rivals.find((r) => r.jumpHeight > 0.2 && r.distanceToNet <= BLOCK_NET_RANGE + 0.6);
    if (!attacker) return false;
    // Has to already be at the net - there is no sprinting into a block.
    if (this.distanceToNet > BLOCK_NET_RANGE) return false;
    if (Math.abs(attacker.pos.x - this.pos.x) > 1.4) return false;
    return Math.random() < this.profile.blockChance;
  }

  /** Where on the ground this ball becomes playable. */
  private interceptPoint(ball: Ball): Vec2 {
    const predicted = predictAtHeight(ball, AI_CONTACT_HEIGHT);
    const raw = predicted ? predicted.pos : { x: ball.pos.x, y: ball.pos.y };
    return this.clampToOwnHalf(raw);
  }

  private ownsSide(spot: Vec2): boolean {
    return this.team === 'human' ? spot.y > NET_Y : spot.y < NET_Y;
  }

  /**
   * The zone this AI holds. The half is split into a net zone and a back zone,
   * and the AI takes whichever one its partner is not in - so when the human
   * comes forward to attack, the back of the court is covered behind them.
   */
  private zoneHome(ctx: AiContext): Vec2 {
    const partnerAtNet = ctx.partner.distanceToNet <= ZONE_SPLIT_DEPTH;
    const depth = partnerAtNet ? BACK_ZONE_HOME_DEPTH : NET_ZONE_HOME_DEPTH;
    const forward = this.towardNet;
    // Drift sideways with the ball so nobody ends up rooted in a corner.
    const x = clamp(
      COURT_WIDTH / 2 + (ctx.ball.pos.x - COURT_WIDTH / 2) * AI_ZONE_TRACKING,
      1,
      COURT_WIDTH - 1,
    );
    return this.clampToOwnHalf({ x, y: NET_Y + forward.y * -depth });
  }

  private moveToward(target: Vec2, dt: number): boolean {
    const offset = sub(target, this.pos);
    if (length(offset) < AI_SETTLE_RANGE) return false;
    this.moveBy(offset, this.profile.speed, dt);
    return true;
  }

  // -------------------------------------------------------------------------
  // Choosing a shot
  // -------------------------------------------------------------------------

  /**
   * First and second contact go to the partner; the third has to cross - and
   * so does any contact where setting would be pointless.
   *
   * That second case matters more than it sounds. A player standing at the net
   * *is* where a set would land, so "set to the partner" would mean lobbing the
   * ball straight up onto their own head and watching it come down on their own
   * side. The net player has nobody to set to; their job is to attack.
   *
   * The attack is made fallible only through the profile's attacking numbers:
   * a displaced target and extra scatter. The shot itself is an ordinary
   * launch, and nothing corrects it afterwards - which is why an AI attack can
   * land out or hit the net for exactly the reason a human's can.
   */
  private chooseShot(ball: Ball, ctx: AiContext): Vec3 {
    const mustCross = ctx.rally.touches >= MAX_TOUCHES_PER_TEAM - 1;
    const setSpot = passTarget(this, ctx.partner);
    const setIsWorthIt = length(sub(setSpot, this.pos)) >= AI_MIN_SET_DISTANCE;

    if (!mustCross && setIsWorthIt) return passShot(this, ball, ctx.partner);

    const spike =
      this.distanceToNet < AI_SPIKE_MAX_NET_DISTANCE &&
      ball.pos.z > AI_SPIKE_MIN_HEIGHT &&
      Math.random() < this.profile.attackSpikeChance;

    return aiAttackShot(this, ball, this.attackTarget(), spike, this.profile.attackScatter);
  }

  /**
   * Where this AI is trying to put the ball: somewhere in the far half, moved
   * off that spot by however sloppy an aimer the profile makes it.
   *
   * The displacement is deliberately not clamped back inside the lines. A poor
   * attacker genuinely picks worse targets and sometimes picks one that is
   * out, rather than being handed a scripted miss.
   */
  private attackTarget(): Vec2 {
    const slop = this.profile.attackTargetSlop;
    const depth = randomBetween(AI_ATTACK_MIN_DEPTH, AI_ATTACK_MAX_DEPTH);
    return {
      x: randomBetween(1.2, COURT_WIDTH - 1.2) + randomBetween(-slop, slop),
      y: farHalfY(this, depth) + randomBetween(-slop, slop),
    };
  }

  private logContact(action: 'play' | 'block', pressedAt: number, atMs: number): void {
    debugLog.contact({
      athlete: this.id,
      action: action === 'block' ? 'block' : 'pass',
      pressedAt,
      touchedAt: atMs,
      executedAt: atMs,
    });
  }
}
