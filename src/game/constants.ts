import { Vec2 } from '../utils/math';

// ---------------------------------------------------------------------------
// Court geometry, in meters (a real beach-volleyball court: 8m x 16m overall,
// 8m x 8m per half).
//
// Court space is always the same regardless of how the court is drawn on
// screen: x runs across the width, y runs along the length. The net lies at
// y = NET_Y. The human team defends y > NET_Y, the opponents y < NET_Y.
// Court.toScreen() is the only place that knows about screen orientation, so
// no gameplay code ever has to care whether the phone is held upright.
// ---------------------------------------------------------------------------
export const COURT_WIDTH = 8;
export const COURT_LENGTH = 16;
export const NET_Y = COURT_LENGTH / 2;

/** Regulation men's beach net height. The net is a real obstacle for the ball,
 * not just a line: anything crossing y = NET_Y below this is a net fault. */
export const NET_HEIGHT = 2.24;

/** Fraction of the available viewport the court is scaled to fill, leaving a
 * little breathing room for the HUD along the edges. */
export const COURT_FILL = 0.94;

/** How strongly a meter of height (z) is drawn as an upward screen offset.
 * Purely cosmetic - it makes height readable in a flat top-down view without
 * displacing figures so far that their ground position becomes ambiguous. */
export const Z_SCREEN_FACTOR = 0.55;

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------
export const PLAYER_RADIUS = 0.35;
export const BALL_RADIUS = 0.15;

/** How high a grounded player can reach (arms up). A jump adds its own height
 * on top of this - see Player.jumpHeight. */
export const PLAYER_REACH_HEIGHT = 2.2;

// ---------------------------------------------------------------------------
// Movement, in meters/second. Releasing the stick (or all of WASD) stops a
// player dead - there is no acceleration or glide anywhere in the game.
// ---------------------------------------------------------------------------
export const PLAYER_SPEED = 5;
export const TEAMMATE_SPEED = 4.6;
export const OPPONENT_SPEED = 4.6;

/** Stick magnitude below which no direction is considered held. */
export const AIM_DEADZONE = 0.15;

// ---------------------------------------------------------------------------
// Zone layout. Each half is split into a net zone and a back zone; the AI
// covers whichever one its human/AI partner is not occupying (see AiBase).
// ---------------------------------------------------------------------------
/** Distance from the net at which the net zone ends and the back zone begins. */
export const ZONE_SPLIT_DEPTH = 3.2;

/** Depth (from the net) of the home spots the AI returns to when idle. */
export const NET_ZONE_HOME_DEPTH = 1.8;
export const BACK_ZONE_HOME_DEPTH = 5.5;

/** Home spots for the two opponents, mirrored into the far half. */
export const OPPONENT_HOMES: Vec2[] = [
  { x: COURT_WIDTH * 0.5, y: NET_Y - NET_ZONE_HOME_DEPTH },
  { x: COURT_WIDTH * 0.5, y: NET_Y - BACK_ZONE_HOME_DEPTH },
];

/** Home spots for the human team, near side. */
export const HUMAN_HOMES: Vec2[] = [
  { x: COURT_WIDTH * 0.5, y: NET_Y + NET_ZONE_HOME_DEPTH },
  { x: COURT_WIDTH * 0.5, y: NET_Y + BACK_ZONE_HOME_DEPTH },
];

// ---------------------------------------------------------------------------
// Ball physics. The ball is a real projectile: it carries a velocity and falls
// under gravity. Nothing anywhere sets its position directly while it is live,
// which is what keeps the flight path continuous and makes the trajectory
// preview (see Physics.simulate) exact rather than approximate.
// ---------------------------------------------------------------------------
export const GRAVITY = 9.81;

/** Fixed integration step. Small enough that a 20 m/s spike advances under
 * 9cm per step, so it can never tunnel through a player, the net or the sand
 * between two frames. */
export const PHYSICS_SUBSTEP = 1 / 240;

/** Safety cap on how long a single flight may be simulated, for the
 * trajectory preview and as a stuck-ball guard. */
export const MAX_FLIGHT_TIME = 8;

// ---------------------------------------------------------------------------
// Ball contact
// ---------------------------------------------------------------------------
/** How long a press is remembered while waiting for the ball to arrive. Short
 * enough that it never feels like the game is playing itself, long enough that
 * nobody has to hit a single frame. */
export const INPUT_BUFFER_MS = 180;

/** After a successful contact, the same ball cannot be touched again for this
 * long - the striker is still standing inside the ball's hitbox for a few
 * frames after sending it away. */
export const CONTACT_LOCK = 0.12;

// ---------------------------------------------------------------------------
// Speed boost. Pressing Pass or Notfall does two things at once: it buffers
// the action, and it throws the player at the ball for a short burst, so a
// ball that was just out of reach becomes playable.
//
// The burst is hard-limited in time and cancelled the instant the player is no
// longer allowed to touch the ball - otherwise it would drag them into a
// double contact they never asked for.
// ---------------------------------------------------------------------------
export const BOOST_DURATION = 0.4;
export const BOOST_MULTIPLIER = 1.55;
/** Height at which the boost aims to meet the ball - roughly chest height, so
 * the run ends where a contact is actually comfortable. */
export const BOOST_INTERCEPT_HEIGHT = 1.3;

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------
/** Pass: a set delivered to the partner's side of the net, high enough and
 * close enough to the tape that they can attack it. */
export const PASS_NET_DEPTH = 2.2; // meters from the net
export const PASS_ARRIVAL_HEIGHT = 2.9;
export const PASS_TIME = 1.05;
export const PASS_SPREAD_RAD = 0.035;
export const PASS_SPEED_JITTER = 0.03;

/** Notfall: a plain shot over the net from anywhere, steered by whatever
 * direction is being held. Pushing toward the net drops it short, pulling back
 * sends it deep. */
export const EMERGENCY_SHORT_DEPTH = 1.6; // meters past the net
export const EMERGENCY_DEEP_DEPTH = 6.8;
export const EMERGENCY_LATERAL = 3.6;
export const EMERGENCY_SPREAD_RAD = 0.075;
export const EMERGENCY_SPEED_JITTER = 0.05;

/** How long the swing pose is held after a contact, purely visual. */
export const SWING_POSE_DURATION = 0.25;

// ---------------------------------------------------------------------------
// Block. Unlike every other action, the block is a *state* rather than a
// buffered instant: the arms go up and stay up for BLOCK_WINDOW, and anything
// that comes through the zone in that time is rejected.
//
// That is not an exception to the contact rule. The block state never touches
// the ball; it only changes the shape of the blocker's hitbox. The rebound
// still happens in exactly the substep the ball and that hitbox overlap.
// ---------------------------------------------------------------------------
/** How close to the net a player must be for a block to be possible at all. */
export const BLOCK_NET_RANGE = 1.3;
export const BLOCK_WINDOW = 0.55;
export const BLOCK_COOLDOWN = 0.45;
export const BLOCK_JUMP_HEIGHT = 0.8;
export const BLOCK_RISE = 0.12;
export const BLOCK_FALL = 0.18;

/** How far the blocker reaches across the net, and how much wider the raised
 * arms make them. Without the overreach the ball would have to be on the
 * blocker's own side already, which is far too late to block anything. */
export const BLOCK_OVERREACH = 0.45;
export const BLOCK_WIDTH_BONUS = 0.18;

/** Only balls at or above the tape can be blocked - a block is played over
 * the net, not scooped from underneath it. */
export const BLOCK_FLOOR = NET_HEIGHT;

/** Fraction of the incoming speed sent back, and the floor under it so a soft
 * ball is still returned with authority. */
export const BLOCK_DAMPING = 0.55;
export const BLOCK_MIN_SPEED = 5;
/** How hard a well-cleared block is driven downward, and how much of the
 * incoming sideways motion is carried through. */
export const BLOCK_DOWNWARD = 4.5;
export const BLOCK_LATERAL_KEEP = 0.35;

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
export const WIN_SCORE = 21;
export const WIN_MARGIN = 2;
export const MAX_TOUCHES_PER_TEAM = 3;
