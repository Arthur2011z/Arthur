// Court geometry, in meters (matches a real beach-volleyball court: 16m x 8m total,
// 8m x 8m per half). y grows "downward" on screen: the human team defends the bottom
// half (y in [NET_Y, COURT_LENGTH]), the net sits at y = NET_Y, opponents occupy the
// top half (y in [0, NET_Y]).
export const COURT_WIDTH = 8;
export const COURT_LENGTH = 16;
export const NET_Y = 8;

// How far Court.resize() is allowed to scale beyond a strict aspect-locked
// "contain" fit, to fill more of off-ratio viewports (reduces/removes visible
// letterbox bars) - capped so it can never crop into legitimately reachable
// play area (players are always clamped >= PLAYER_RADIUS from the true edge).
export const COURT_OVERSCAN_CAP = 1.05; // max 5% zoom-crop beyond "contain"

export const PLAYER_RADIUS = 0.35;
export const BALL_RADIUS = 0.15;

// Ball landing-spot marker: shown on the ground at ball.target (already
// exact - see Ball.launch()) while the ball is flying, distinct from the
// ball's own small traveling shadow drawn in drawBall().
export const LANDING_MARKER_RADIUS = 0.35;

// Movement speeds, in meters/second.
export const PLAYER_SPEED = 4.5;
export const TEAMMATE_SPEED = 4.2;
export const OPPONENT_SPEED = 3.8;

// Interaction ranges, in meters.
export const HIT_RANGE = 0.7;

// Wisch-Hechten (swipe-to-dive): how far away the nearest point of the ball's
// remaining flight path may be for a swipe to engage at all, and how
// forgiving the swipe direction has to be. This is the *big* one-shot dash
// for balls genuinely out of easy reach - distinct from the light continuous
// ASSIST_RANGE homing used by Pass/Notfall-Schlag/Jump below.
export const REACH_RANGE = 3;
export const REACH_AIM_TOLERANCE_COS = 0.5; // ~60 degree cone
// Below this distance to the intercept point, no aiming is required at all -
// the ball is basically already where the player stands.
export const REACH_AIMLESS_RANGE = HIT_RANGE;

export const DIVE_DASH_DURATION = 0.22;
export const DIVE_RECOVERY_DURATION = 0.5;

// Light automatic "the AI nudges you the last bit of the way" correction used
// by Pass, Notfall-Schlag and the Jump-Smash's in-air drift: much shorter
// range than REACH_RANGE's dash, walked smoothly at (a touch faster than)
// normal speed rather than dashed.
export const ASSIST_RANGE = 2.2;
export const ASSIST_SPEED_MULTIPLIER = 1.15;
// Even lighter: how far the Jump-Smash's in-air drift toward the ball may
// pull the player while airborne (smaller than ASSIST_RANGE on purpose - a
// jump's own correction is meant to be subtle, not a repositioning dash).
export const JUMP_ASSIST_RANGE = 1.6;

export const SPIKE_RANGE = 5;

export const WIN_SCORE = 21;
export const WIN_MARGIN = 2;

// Volleyball touch-limit: a team may touch the ball at most this many times
// before it must cross back over the net.
export const MAX_TEAM_TOUCHES = 3;

// Input buffering: Pass/Notfall-Schlag may be pressed before the ball is
// actually in range - the press is remembered for this long and resolved the
// moment the ball comes within HIT_RANGE (or ASSIST_RANGE homing brings the
// player to it), so timing never has to be split-second.
export const INPUT_BUFFER_WINDOW = 1.2;

// Opponent auto-serve (also the bootstrap/fallback serve at game start): fair
// and easy to react to - AUTO_SERVE_DELAY is only ever reached at the very
// first serve of a game, since every later serve is dispatched explicitly by
// beginServe() right after the point-scored pause.
export const AUTO_SERVE_DELAY = 2;
export const AUTO_SERVE_DURATION = 1.3;
export const AUTO_SERVE_PEAK_HEIGHT = 3;

// Human serve: the ball rests "in hand" (tracks the player) until the
// Notfall-Schlag button sends it over - generous, so normal play never feels
// rushed - or this fallback timeout elapses, so the game can never get
// permanently stuck.
export const HUMAN_SERVE_TIMEOUT = 5; // seconds
export const HUMAN_SERVE_DURATION = 1.3; // seconds - same easy, reactable arc as the opponent auto-serve
export const HUMAN_SERVE_PEAK_HEIGHT = 3; // meters

// Pass button: a controlled, medium touch straight to the AI teammate -
// available any time the ball is in HIT_RANGE (or brought into it via
// ASSIST_RANGE homing). The deliberate "safe" alternative to the Jump-Smash.
export const PASS_DURATION = 0.7;
export const PASS_PEAK_HEIGHT = 2.5;

// Notfall-Schlag (small emergency button): simple, weak, no-jump touch that
// always sends the ball back over the net to a generous, safe spot - the
// "get it over somehow" fallback when in trouble.
export const HIT_DURATION = 0.9;
export const HIT_PEAK_HEIGHT = 2.2;

// Random target margin (meters from the court edges) used whenever a return
// picks a generous, in-bounds spot rather than a precisely aimed one (serves,
// the AI teammate's emergency self-set, the Notfall-Schlag, the opponents'
// return).
export const RANDOM_TARGET_MARGIN = 2;

// Aimed spike (Jump-Smash, resolved at the end of the slow-motion aim
// window): fast and flat - the reliable way to score, provided the net-fault
// risk roll (see NET_RISK_* below) doesn't intervene. Aim direction comes
// from the swipe performed during slowmo_aim, defaulting to straight over the
// net if no swipe was made before the window times out.
export const SPIKE_DURATION = 0.5;
export const SPIKE_PEAK_HEIGHT = 1.2;
export const SPIKE_TARGET_MARGIN = 0.3;

// Jump-Smash: works from anywhere, anytime (not just near the net) - pressing
// it always jumps. A light in-air drift (JUMP_ASSIST_RANGE above) nudges the
// player toward the ball's predicted intercept point while rising.
export const JUMP_RISE_DURATION = 0.35; // seconds, press -> peak
export const JUMP_FALL_DURATION = 0.3; // seconds, peak -> back to 'active' (no contact made)
export const JUMP_PEAK_HEIGHT = 0.6; // meters, visual-only hop height

// Slow-motion aim window: opens the instant the ball actually reaches
// HIT_RANGE while airborne. Both the ball (frozen via BallFlightState =
// 'held') and the player's own animation slow down together for this long in
// *real* wall-clock time (deliberately not scaled itself, so the window
// always feels the same short-but-clear length regardless of SLOWMO_FACTOR).
// A swipe during the window sets the spike's aim and resolves immediately;
// otherwise it resolves automatically at the end with the default aim.
export const SLOWMO_FACTOR = 0.18;
export const SLOWMO_REAL_DURATION = 0.55; // seconds, real time

// Risk/reward: the further from the net the player was standing at the
// moment they jumped, the higher the chance the resulting spike nets out
// instead of clearing - linear ramp between the two distances below, capped
// at NET_RISK_MAX.
export const NET_RISK_SAFE_DISTANCE = 2; // meters from the net: 0% risk at/below this
export const NET_RISK_MAX_DISTANCE = 7; // meters from the net: risk caps here
export const NET_RISK_MAX = 0.55;

// A failed net-risk roll: a short, low shot that thuds into the net and
// drops back on the hitter's own side - lands just past the net line on their
// own half, so the existing landed-in-which-half scoring logic (see
// GameState.handleBallLanded) attributes the point correctly with no special
// "fault" state needed.
export const NET_FAULT_DURATION = 0.22;
export const NET_FAULT_PEAK_HEIGHT = 0.4;
export const NET_FAULT_OWN_SIDE_MARGIN = 0.3;

// AI teammate: reacts only once the ball is within this radius of its current
// position or of where the ball is actually headed (ball.target) - covers both
// "comes near" and "flies toward them" (including the human player's dive-pass,
// which always targets the teammate's position directly).
export const TEAMMATE_REACT_RADIUS = 2.5;
// Close enough to home to snap and stop, instead of asymptotically creeping in.
export const TEAMMATE_RETURN_EPSILON = 0.1;

// Emergency self-set save (ball arrived too fast/direct to set up properly,
// or this is the team's mandatory final touch): low and quick, just enough to
// keep it alive over the net.
export const TEAMMATE_EMERGENCY_SET_DURATION = 0.5;
export const TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT = 1.5;
export const EMERGENCY_TIME_THRESHOLD = 0.35;

// Normal case: a high, easy set toward the net, to the human player's current
// position.
export const TEAMMATE_SET_DURATION = 0.85;
export const TEAMMATE_SET_PEAK_HEIGHT = 3.5;

// Two zones within the human half the player and AI teammate dynamically
// split between (net/front vs. back) - see TeammateAI's home-position logic.
// The teammate always covers whichever zone the player's current position
// (< ZONE_SPLIT_Y = net zone, >= it = back zone) is *not* in, re-evaluated
// every frame - a situational base, not a fixed spot.
export const ZONE_SPLIT_Y = NET_Y + (COURT_LENGTH - NET_Y) / 2;
export const NET_ZONE_CENTER_Y = NET_Y + (ZONE_SPLIT_Y - NET_Y) / 2;
export const BACK_ZONE_CENTER_Y = ZONE_SPLIT_Y + (COURT_LENGTH - ZONE_SPLIT_Y) / 2;
// Off-center on purpose (rather than the same x as the player), so the two
// don't end up standing on top of each other when both drift toward the net.
export const TEAMMATE_HOME_X = COURT_WIDTH * 0.7;

// Opponent AI: once it reaches the ball, sends it back - usually a safe,
// generous return, sometimes an aggressive attack, occasionally a mechanical
// error (see OpponentAI.playBall for the probabilities).
export const OPPONENT_RETURN_EPSILON = 0.1;
export const OPPONENT_RETURN_DURATION = 1.1;
export const OPPONENT_RETURN_PEAK_HEIGHT = 2.7;
export const OPPONENT_ATTACK_CHANCE = 0.25;
export const OPPONENT_ATTACK_DURATION = 0.6;
export const OPPONENT_ATTACK_PEAK_HEIGHT = 1.1;
export const OPPONENT_ATTACK_TARGET_MARGIN = 0.6;
export const OPPONENT_ERROR_CHANCE = 0.15;
export const OPPONENT_FAULT_DURATION = 0.22;
export const OPPONENT_FAULT_PEAK_HEIGHT = 0.4;
export const OPPONENT_FAULT_OWN_SIDE_MARGIN = 0.3;

// Shared inset margin for generating a random, in-bounds landing point on
// either side of the net (used by serves and the opponent's normal return).
export const SERVE_MARGIN = 2;

// Brief pause after a point is scored, so the score change reads clearly
// before the next serve goes up.
export const POINT_PAUSE_DURATION = 1.2;

// Fixed home/base positions the AI opponents return to when not actively
// playing the ball.
export const OPPONENT_HOMES: { x: number; y: number }[] = [
  { x: 2.5, y: 3 },
  { x: 5.5, y: 3 },
];

// The human player's starting position each game/rally cycle - shared with
// TeammateAI so its own initial position can be derived from the same point
// without needing a live Player reference at construction time.
export const PLAYER_START_POS: { x: number; y: number } = {
  x: COURT_WIDTH / 2,
  y: NET_Y + COURT_LENGTH / 4,
};
