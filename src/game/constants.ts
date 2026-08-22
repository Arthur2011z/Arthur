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
export const NET_PROXIMITY_RANGE = 1.5;

// Sprung/Hecht button: how far away the nearest point of the ball's remaining
// flight path may be for a press to engage at all, and how forgiving the
// joystick has to point toward it. Deliberately more generous than the old
// swipe-based dive (button + auto-movement to the ball needs less precision
// than a gesture aimed by hand).
export const REACH_RANGE = 3;
export const REACH_AIM_TOLERANCE_COS = 0.5; // ~60 degree cone
// Below this distance to the intercept point, no aiming is required at all -
// the ball is basically already where the player stands.
export const REACH_AIMLESS_RANGE = HIT_RANGE;
// Joystick magnitude below which "no direction held" is assumed (dead zone).
export const AIM_DEADZONE = 0.15;

// Timings, in seconds.
export const DIVE_DASH_DURATION = 0.22;
export const DIVE_RECOVERY_DURATION = 0.5;

export const SPIKE_RANGE = 5;
export const REACH_SAFETY_MARGIN = 0.85;
export const EMERGENCY_TIME_THRESHOLD = 0.35;

export const WIN_SCORE = 21;
export const WIN_MARGIN = 2;

// Input buffering: Schlag/Pass may be pressed before the ball is actually in
// range - the press is remembered for this long and resolved the moment the
// ball comes within HIT_RANGE, so timing never has to be split-second.
export const INPUT_BUFFER_WINDOW = 1.2;
// Extra grace period right after the jump's peak (into the fall) during which
// a buffered Schlag/Pass still resolves, so aiming a spike never feels like a
// single-frame deadline.
export const JUMP_SCHLAG_GRACE_DURATION = 0.15;

// Opponent auto-serve (also the bootstrap/fallback serve at game start): fair
// and easy to react to - AUTO_SERVE_DELAY is only ever reached at the very
// first serve of a game, since every later serve is dispatched explicitly by
// beginServe() right after the point-scored pause.
export const AUTO_SERVE_DELAY = 2;
export const AUTO_SERVE_DURATION = 1.3;
export const AUTO_SERVE_PEAK_HEIGHT = 3;

// Human serve: the ball rests "in hand" (tracks the player) until the Schlag
// button sends it over - generous, so normal play never feels rushed - or
// this fallback timeout elapses, so the game can never get permanently stuck.
export const HUMAN_SERVE_TIMEOUT = 5; // seconds
export const HUMAN_SERVE_DURATION = 1.3; // seconds - same easy, reactable arc as the opponent auto-serve
export const HUMAN_SERVE_PEAK_HEIGHT = 3; // meters

// Pass button: a controlled, medium touch straight to the AI teammate -
// available any time the ball is in HIT_RANGE, whether reached by walking,
// diving or jumping. The deliberate "safe" alternative to a Schlag attack.
export const PASS_DURATION = 0.7;
export const PASS_PEAK_HEIGHT = 2.5;

// Random target margin (meters from the court edges) used whenever a return
// picks a generous, in-bounds spot rather than a precisely aimed one (the AI
// teammate's emergency self-set, the opponents' return).
export const RANDOM_TARGET_MARGIN = 2;

// Aimed spike (Schlag button, only while jumping near the net): fast and flat
// - the reliable way to score. Aim direction comes from whatever the joystick
// is held toward during the jump (see Player.aimDir), defaulting to straight
// over the net if the stick is left centered the whole time.
export const SPIKE_DURATION = 0.5;
export const SPIKE_PEAK_HEIGHT = 1.2;
export const SPIKE_TARGET_MARGIN = 0.3;

// Sprung/Hecht button: pressing it while the joystick points roughly toward
// the ball's flight path sends the player into a brief automatic approach -
// a vertical hop (with hang time) if already near the net, a flat dash
// otherwise - toward the nearest point of that path; the exact positioning is
// handled by the game, not by the player's own precision. Schlag/Pass then
// resolve once the ball is actually within HIT_RANGE (see INPUT_BUFFER_WINDOW
// and JUMP_SCHLAG_GRACE_DURATION above for how forgiving the timing is).
export const JUMP_RISE_DURATION = 0.35; // seconds, press -> peak
export const JUMP_FALL_DURATION = 0.3; // seconds, peak -> back to 'active'
export const JUMP_PEAK_HEIGHT = 0.6; // meters, visual-only hop height

// AI teammate: reacts only once the ball is within this radius of its current
// position or of where the ball is actually headed (ball.target) - covers both
// "comes near" and "flies toward them" (including the human player's dive-pass,
// which always targets the teammate's position directly).
export const TEAMMATE_REACT_RADIUS = 2.5;
// Close enough to home to snap and stop, instead of asymptotically creeping in.
export const TEAMMATE_RETURN_EPSILON = 0.1;

// Emergency self-set save (ball arrived too fast/direct to set up properly):
// low and quick, just enough to keep it alive over the net.
export const TEAMMATE_EMERGENCY_SET_DURATION = 0.5;
export const TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT = 1.5;

// Normal case: a high, easy set toward the net, to the human player's current
// position.
export const TEAMMATE_SET_DURATION = 0.85;
export const TEAMMATE_SET_PEAK_HEIGHT = 3.5;

// Opponent AI: simple return - once it reaches the ball, sends it back into a
// generous, random spot in the human half. No emergency/set distinction needed.
export const OPPONENT_RETURN_EPSILON = 0.1;
export const OPPONENT_RETURN_DURATION = 1.1;
export const OPPONENT_RETURN_PEAK_HEIGHT = 2.7;

// Shared inset margin for generating a random, in-bounds landing point on
// either side of the net (used by serves and the opponent's return).
export const SERVE_MARGIN = 2;

// Brief pause after a point is scored, so the score change reads clearly
// before the next serve goes up.
export const POINT_PAUSE_DURATION = 1.2;

// Fixed home/base positions the AI teammate and opponents return to when not
// actively playing the ball.
export const TEAMMATE_HOME: { x: number; y: number } = {
  x: COURT_WIDTH * 0.7,
  y: NET_Y + 3,
};
export const OPPONENT_HOMES: { x: number; y: number }[] = [
  { x: 2.5, y: 3 },
  { x: 5.5, y: 3 },
];
