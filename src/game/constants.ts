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
// Contact (Hechten/Pass/Schlag/Schmetterschlag/Zuspiel, for every entity -
// player, teammate, opponent) additionally requires the ball's *current*
// flight height to be at or below this - HIT_RANGE alone only checks the
// ground-plane (x/y) distance to the ball's live position, which a high arc
// can satisfy while the ball is still meters overhead, nowhere near actually
// touchable. Both this height check AND the HIT_RANGE distance check use the
// ball's live pos/height, never ball.target (the landing-point prediction) -
// see Ball.height and the callers of Ball.launch() for how each shot's own
// peakHeight compares against this.
export const CATCHABLE_HEIGHT = 2.0;

// Hechten (dive button): how far away the nearest point of the ball's
// remaining flight path may be for the dive to engage at all. This is the
// one-shot dash for balls just out of easy reach - distinct from the light
// continuous ASSIST_RANGE homing used by Pass/Notfall-Schlag/Jump below. No
// aim tolerance constant accompanies this any more: the dive is
// button-triggered and its direction comes purely from the ball's own
// trajectory, so there is no swipe (or joystick) direction left to grade.
//
// Reduced from 3 as part of the general trimming of automatic movement help
// (see ASSIST_RANGE): a dive that covered 3m turned "get roughly near the
// ball" into "press the button from anywhere nearby". At 2m the player has to
// have done the running themselves before the dive can bail them out - it is
// still a real dive, covering nearly 3x HIT_RANGE at roughly twice running
// speed (2m over DIVE_DASH_DURATION vs. PLAYER_SPEED).
export const REACH_RANGE = 2;

// The dive is defined by its SPEED, not by a fixed duration. A fixed duration
// (it used to be a flat 0.22s for every dive, however short) meant the dash
// speed fell with the distance covered: a 0.8m dive crawled along at 3.6 m/s,
// i.e. slower than simply walking there (PLAYER_SPEED 4.5), and a 0.3m one at
// 1.4 m/s. Since most dives are short, the move almost always felt limp. With
// a fixed speed every dive is an equally sharp lunge and only its length
// varies.
export const DIVE_SPEED = 11; // m/s - roughly 2.4x running speed
// Floor and ceiling on the resulting duration: the floor keeps a near-zero
// dive from being an invisible teleport, the ceiling is a safety net.
export const DIVE_MIN_DURATION = 0.12;
export const DIVE_MAX_DURATION = 0.3;
// Visual-only hop (same mechanism as the jump's height): lifts the token and
// casts a shadow under it, so the move reads as leaving the ground rather than
// sliding along it.
export const DIVE_PEAK_HEIGHT = 0.35;
export const DIVE_RECOVERY_DURATION = 0.5;

// Light automatic "the AI nudges you the last bit of the way" correction used
// by Pass and Notfall-Schlag: much shorter range than REACH_RANGE's dash,
// walked smoothly rather than dashed.
//
// Deliberately small. At the old 2.2m this stopped being a nudge and became
// the primary way the player reached the ball: pressing Pass anywhere in the
// neighbourhood walked them in automatically, so manual positioning barely
// mattered. At 1.0m it only closes the last stride once the player has done
// the running - roughly the gap between HIT_RANGE (0.7) and "almost there".
export const ASSIST_RANGE = 1;
// 1.0 = exactly the player's own running speed. It used to be 1.15, i.e. the
// automatic correction physically out-ran manual control, which is backwards:
// the assist should never beat the player to a ball they could have run down
// themselves.
export const ASSIST_SPEED_MULTIPLIER = 1;
// Even lighter: how far the Jump-Smash's in-air drift toward the ball may
// pull the player while airborne (smaller than ASSIST_RANGE on purpose - a
// jump's own correction is meant to be subtle, not a repositioning glide).
// Cut from 1.6m, which let a jump slide the player over a metre and a half
// through the air onto a ball they had not actually got under. Kept a hair
// above HIT_RANGE (0.7) rather than equal to it: at exactly HIT_RANGE the
// drift could only ever engage for a ball already in reach, i.e. do nothing
// at all. This narrow band is the whole correction - a ball 0.8m out drifts
// only the ~0.1m needed to bring it inside HIT_RANGE, then contact fires.
export const JUMP_ASSIST_RANGE = 0.9;

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
export const AUTO_SERVE_DURATION = 2.2; // slowed down for reaction time - see HIT_DURATION's note
export const AUTO_SERVE_PEAK_HEIGHT = 3;

// Human serve: the ball rests "in hand" (tracks the player) until the
// Notfall-Schlag button sends it over - generous, so normal play never feels
// rushed - or this fallback timeout elapses, so the game can never get
// permanently stuck.
export const HUMAN_SERVE_TIMEOUT = 5; // seconds
export const HUMAN_SERVE_DURATION = 2.2; // seconds - same easy, reactable arc as the opponent auto-serve
export const HUMAN_SERVE_PEAK_HEIGHT = 3; // meters

// Pass button: a controlled, medium touch straight to the AI teammate -
// available any time the ball is in HIT_RANGE (or brought into it via
// ASSIST_RANGE homing). The deliberate "safe" alternative to the Jump-Smash.
export const PASS_DURATION = 1.3; // slowed down for reaction time - see HIT_DURATION's note
export const PASS_PEAK_HEIGHT = 2.5;

// Notfall-Schlag (small emergency button): simple, weak, no-jump touch that
// always sends the ball back over the net to a generous, safe spot - the
// "get it over somehow" fallback when in trouble.
//
// This and every other *routine* ball flight in the game (both serves, Pass/
// Hechten, the AI teammate's set and emergency-set, the opponent's normal
// return) were slowed down together, on request, so the ball spends
// noticeably more time in the air and everyone (human or AI) has real time to
// move to the landing spot. The two deliberately fast/hard shots - the
// Jump-Smash spike and the opponent's aggressive attack (plus each one's own
// short, instant net-fault outcome) - are the sole exception, left exactly as
// fast as before: that speed is their intentional risk/reward payoff, not
// something needing more reaction time.
export const HIT_DURATION = 1.6;
export const HIT_PEAK_HEIGHT = 2.2;

// Random target margin (meters from the court edges) used whenever a return
// picks a generous, in-bounds spot rather than a precisely aimed one (serves,
// the AI teammate's emergency self-set, the Notfall-Schlag, the opponents'
// return).
export const RANDOM_TARGET_MARGIN = 2;

// Aimed spike (Jump-Smash, resolved at the end of the slow-motion aim
// window): at its best fast and flat - the reliable way to score, provided
// the net-fault risk roll (see NET_RISK_* below) doesn't intervene. Aim
// direction comes from the swipe performed during slowmo_aim, defaulting to
// straight over the net if no swipe was made before the window times out.
//
// These two are the FULL-POWER values, hit only when the player took off
// close to the net (see SPIKE_POWER_* below) - not a flat guarantee.
export const SPIKE_DURATION = 0.5;
export const SPIKE_PEAK_HEIGHT = 1.2;
export const SPIKE_TARGET_MARGIN = 0.3;

// Spike power falls off with how far from the net the player took off, so a
// smash from deep in the back court is no longer the same near-certain point
// as one struck at the net. Full power at/below SPIKE_POWER_FULL_DISTANCE,
// linearly weakening to the SPIKE_WEAK_* values at/beyond
// SPIKE_POWER_MIN_DISTANCE. A weakened spike is slower (longer duration, so
// less ball speed) and loopier (higher arc) - both give the opponents real
// time to read it and get under it, which is exactly what makes it
// defendable. The aim itself (SPIKE_RANGE/computeSpikeTarget) is deliberately
// NOT scaled: a weak spike still goes where it was aimed, it just arrives
// slower and higher.
//
// Deliberately the same two distances as the NET_RISK_* ramp below, so both
// consequences of jumping from deep - more net-fault risk AND less power -
// ramp in together over the same stretch of court rather than at odds.
export const SPIKE_POWER_FULL_DISTANCE = 2; // meters from the net: full power at/below this
export const SPIKE_POWER_MIN_DISTANCE = 7; // meters from the net: weakest at/beyond this
export const SPIKE_WEAK_DURATION = 1.1; // vs. 0.5 at full power - noticeably slower
// vs. 1.2 at full power - a loopier, readable arc, but deliberately kept
// under CATCHABLE_HEIGHT (2.0): an arc that peaks above it is briefly
// *untouchable* rather than merely weak, which works against the whole point
// of this ramp. Measured: at 2.4 the weakened spike was still unreturnable on
// deep targets (15/20 defended), at 1.9 it is consistently defendable (20/20)
// while a full-power spike stays a real weapon (11/20).
export const SPIKE_WEAK_PEAK_HEIGHT = 1.9;

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

// How much closer to the ball the player must be than the teammate before the
// teammate defers to them on proximity alone (see playerHasPriority's third
// rule in TeammateAI). Without a margin here, a player a mere centimeter
// closer already claimed the ball - including when they had no intention of
// playing it at all (nothing pressed, not diving), so the teammate would stand
// by and let balls drop. This is deliberately only the *proximity* rule's
// tolerance: an active claim (mid-Hechten-dive, or Pass/Notfall-Schlag pressed
// within ASSIST_RANGE) still wins outright, at any distance, with no margin
// required. Sits between HIT_RANGE and ASSIST_RANGE: large enough that a
// near-tie goes to the teammate (who will actually play it), small enough that
// a genuinely better-placed player still gets their ball.
export const TEAMMATE_YIELD_MARGIN = 1.5;
// Close enough to home to snap and stop, instead of asymptotically creeping in.
export const TEAMMATE_RETURN_EPSILON = 0.1;

// Emergency self-set save (ball arrived too fast/direct to set up properly,
// or this is the team's mandatory final touch): low and quick, just enough to
// keep it alive over the net.
export const TEAMMATE_EMERGENCY_SET_DURATION = 0.8; // slowed down for reaction time - see HIT_DURATION's note
export const TEAMMATE_EMERGENCY_SET_PEAK_HEIGHT = 1.5;
// "Arrived too fast/direct" is judged by the incoming flight's own total
// duration (Ball.duration - fixed per shot type, independent of how far into
// the flight contact happens - see the callers of launch()), NOT by how much
// of that flight's clock happens to be left at the moment of contact: the
// latter also swings low for a routine, un-hurried touch (e.g. a Pass aimed
// squarely at the teammate is, by construction, almost always caught right
// as it arrives) and was making this branch fire far too often. Only the
// genuinely fast/hard shots - a spike (SPIKE_DURATION) or an opponent's
// attack (OPPONENT_ATTACK_DURATION) - are shorter than this; every routine
// return/set/pass/serve is at or above PASS_DURATION (1.3s) and stays clear.
export const EMERGENCY_DURATION_THRESHOLD = 0.65;

// Normal case: a high, easy set toward the net, aimed to land close to the
// human player's own current position AND, purposefully, pulled some of the
// way toward the net - not squarely on top of wherever they happen to be
// standing. A set that just lands at the player's raw current position gives
// them zero run-up: if they're deep in the back zone when it arrives, a
// Sprung-Schmetterschlag from there eats heavy net-fault risk (see
// NET_RISK_*). TEAMMATE_SET_NET_APPROACH_Y sits comfortably inside
// NET_RISK_SAFE_DISTANCE, so blending the target toward it gives the player a
// short, realistic distance to close before jumping - see TeammateAI.playBall.
export const TEAMMATE_SET_DURATION = 1.5; // slowed down for reaction time - see HIT_DURATION's note
export const TEAMMATE_SET_PEAK_HEIGHT = 3.5;
export const TEAMMATE_SET_NET_APPROACH_Y = NET_Y + 1.5;
export const TEAMMATE_SET_NET_BLEND = 0.7; // 0 = pure player position, 1 = pure near-net point

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
export const OPPONENT_RETURN_DURATION = 1.9; // slowed down for reaction time - see HIT_DURATION's note
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

// The opponent half (y in [0, NET_Y]) is split into two zones the same way
// the human half is (see ZONE_SPLIT_Y above): a net/front zone and a back
// zone. One opponent covers each - the classic beach-volleyball blocker /
// back-court defender pairing - instead of both standing side by side at the
// same depth, which left the whole back court unattended and made whichever
// of the two happened to be nearer the landing spot dart across the court on
// every ball.
export const OPPONENT_ZONE_SPLIT_Y = NET_Y / 2;
export const OPPONENT_NET_ZONE_CENTER_Y = OPPONENT_ZONE_SPLIT_Y + (NET_Y - OPPONENT_ZONE_SPLIT_Y) / 2;
export const OPPONENT_BACK_ZONE_CENTER_Y = OPPONENT_ZONE_SPLIT_Y / 2;
// Staggered across the width (rather than both on the centre line) so the two
// between them cover more of the court laterally as well.
export const OPPONENT_NET_ZONE_X = COURT_WIDTH * 0.35;
export const OPPONENT_BACK_ZONE_X = COURT_WIDTH * 0.65;

/** Base position each opponent holds when not actively playing the ball -
 * the centre of its own zone. Index 0 covers the net zone, index 1 the back
 * zone (see OpponentAI's `zone`). */
export const OPPONENT_HOMES: { x: number; y: number }[] = [
  { x: OPPONENT_NET_ZONE_X, y: OPPONENT_NET_ZONE_CENTER_Y },
  { x: OPPONENT_BACK_ZONE_X, y: OPPONENT_BACK_ZONE_CENTER_Y },
];

// How much closer to the ball's landing spot the out-of-zone opponent must be
// before it takes a ball that belongs to the other's zone. Zone ownership is
// the rule; this margin is the sanity valve for a ball landing just barely
// across the zone line with the wrong defender standing right on top of it.
// Without it, strict zone ownership produces exactly the kind of illogical
// run the zones were introduced to remove.
export const OPPONENT_ZONE_OVERRIDE_MARGIN = 1.5;

// The human player's starting position each game/rally cycle - shared with
// TeammateAI so its own initial position can be derived from the same point
// without needing a live Player reference at construction time.
export const PLAYER_START_POS: { x: number; y: number } = {
  x: COURT_WIDTH / 2,
  y: NET_Y + COURT_LENGTH / 4,
};
