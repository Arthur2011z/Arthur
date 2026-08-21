// Court geometry, in meters (matches a real beach-volleyball court: 16m x 8m total,
// 8m x 8m per half). y grows "downward" on screen: the human team defends the bottom
// half (y in [NET_Y, COURT_LENGTH]), the net sits at y = NET_Y, opponents occupy the
// top half (y in [0, NET_Y]).
export const COURT_WIDTH = 8;
export const COURT_LENGTH = 16;
export const NET_Y = 8;

export const PLAYER_RADIUS = 0.35;
export const BALL_RADIUS = 0.15;

// Movement speeds, in meters/second.
export const PLAYER_SPEED = 4.5;
export const TEAMMATE_SPEED = 4.2;
export const OPPONENT_SPEED = 3.8;

// Interaction ranges, in meters.
export const HIT_RANGE = 0.7;
export const NET_PROXIMITY_RANGE = 1.5;
export const DIVE_RANGE = 2.5;
export const DIVE_AIM_TOLERANCE_COS = 0.7; // ~45 degree cone

// Timings, in seconds.
export const DIVE_DASH_DURATION = 0.22;
export const DIVE_RECOVERY_DURATION = 0.5;
export const JUMP_WINDOW_DURATION = 0.55;

export const SPIKE_RANGE = 5;
export const REACH_SAFETY_MARGIN = 0.85;
export const EMERGENCY_TIME_THRESHOLD = 0.35;

export const WIN_SCORE = 21;
export const WIN_MARGIN = 2;

// Swipe gesture thresholds (screen pixels / seconds) for detecting a dive.
export const SWIPE_MIN_DISTANCE_PX = 30;
export const SWIPE_MAX_DURATION_S = 0.35;
export const SWIPE_MIN_VELOCITY_PX_S = 500;

// How far a dive lunges when the swipe *doesn't* connect with the ball — shorter
// than DIVE_RANGE so a whiff reads as a real (failed) lunge, not a teleport.
export const DIVE_WHIFF_DISTANCE = 1.8;

// Auto-serve: while the ball has been idle this long, toss a fresh practice
// ball into the human half (no serve mechanic exists yet).
export const AUTO_SERVE_DELAY = 2;
export const AUTO_SERVE_DURATION = 1.3;
export const AUTO_SERVE_PEAK_HEIGHT = 3;

// Dive-save: the pass a successful dive automatically sends to the teammate.
export const DIVE_PASS_DURATION = 0.7;
export const DIVE_PASS_PEAK_HEIGHT = 2.5;

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
