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

// --- Contact -------------------------------------------------------------
// The human player's contact condition, and the only one: the two hitboxes
// actually overlap. The renderer draws height as a y-offset (the ball at
// pos.y - ball.height, the player at pos.y - player.height), so the gap seen
// on screen between the two circles is the distance between those drawn
// centres - and they meet exactly here. See Player.hitboxesTouch.
//
// Deliberately the sum of the two radii and nothing more. It used to be
// HIT_RANGE (0.7) plus a separate ball-height ceiling of 2.0m, which is a
// *reach*, not a touch, and is what let a contact fire while the ball was
// still visibly clear of the player: measured at a drawn gap of 0.911m on a
// jump-smash, nearly twice the distance at which the circles meet.
export const TOUCH_DISTANCE = PLAYER_RADIUS + BALL_RADIUS; // 0.5m

// The AI's reach, which is a different thing and stays as it was: the teammate
// and the opponents play a ball within this ground-plane distance and below
// CATCHABLE_HEIGHT. They have no input buffer and no boost to compensate with,
// so holding them to the player's strict touch rule would only make them whiff
// and collapse every rally. Only the human player's own actions - Pass,
// Notfall-Schlag, Schmetterschlag - are judged by TOUCH_DISTANCE.
export const HIT_RANGE = 0.7;
// Contact (Block/Pass/Schlag/Schmetterschlag/Zuspiel, for every entity -
// player, teammate, opponent) additionally requires the ball's *current*
// flight height to be at or below this - HIT_RANGE alone only checks the
// ground-plane (x/y) distance to the ball's live position, which a high arc
// can satisfy while the ball is still meters overhead, nowhere near actually
// touchable. Both this height check AND the HIT_RANGE distance check use the
// ball's live pos/height, never ball.target (the landing-point prediction) -
// see Ball.height and the callers of Ball.launch() for how each shot's own
// peakHeight compares against this.
export const CATCHABLE_HEIGHT = 2.0;

// --- Block ---------------------------------------------------------------
// Blocken. No dash, no movement of any kind, no recovery pause: the block is
// played standing still and is over as quickly as it went up.
//
// A block is played standing at the net. Pressing it never moves the player a
// centimetre; instead it only intercepts anything at all while they are
// already within this distance of the net. That is the entire positional
// requirement, and what makes the move a read rather than a panic button.
export const BLOCK_NET_DISTANCE = 1.5;
// How long the wall stays up. The opponents' attack is a 0.6s flight that
// crosses the net around halfway through it, so a block thrown up as the
// attack is struck is still there when the ball arrives - while one pressed a
// beat too early or too late is not.
export const BLOCK_DURATION = 0.55;
export const BLOCK_RISE_DURATION = 0.12;
export const BLOCK_FALL_DURATION = 0.15;
// Visual-only lift, the same mechanism as the jump's height - deliberately
// higher than JUMP_PEAK_HEIGHT (0.6), since reaching above the net is the
// whole point of the move.
export const BLOCK_PEAK_HEIGHT = 0.85;

// The block zone, i.e. the wall itself. Laterally: how far to either side of
// the blocker it reaches.
export const BLOCK_HALF_WIDTH = 1.1;
// Along the court: how near the net line the ball has to be as it passes
// through. A block happens AT the net, never out in the court.
export const BLOCK_NET_BAND = 1.2;
// And vertically, the band a raised block actually covers. Under it the ball
// slips beneath the block (a dink beats it), over it the ball sails past (a
// high lob beats it). Tuned against the two things that actually cross the
// net: the opponents' attack peaks at OPPONENT_ATTACK_PEAK_HEIGHT (1.1) and so
// passes through the band, while their safe return peaks at
// OPPONENT_RETURN_PEAK_HEIGHT (2.7) and clears it. The block therefore beats
// attacks, not lobs.
export const BLOCK_MIN_HEIGHT = 0.45;
export const BLOCK_MAX_HEIGHT = 2.4;

// A blocked ball is not "received": it rebounds, hard and steep, straight back
// down onto the attacker's own side just past the net. Nothing else in the
// game flies like this - the flattest shot otherwise is the full-power spike
// at SPIKE_PEAK_HEIGHT (1.2), four times this arc.
export const BLOCK_RETURN_DURATION = 0.45;
export const BLOCK_RETURN_PEAK_HEIGHT = 0.3;
export const BLOCK_RETURN_DEPTH = 1.6; // metres past the net, on the attacker's side
export const BLOCK_RETURN_MARGIN = 0.4; // keeps the rebound inside the side lines

// The AI teammate's own block: it reads a developing attack and goes to the
// net by itself, with nothing pressed.
// Where it stands to block - just off the net, on the ball's own column.
export const TEAMMATE_BLOCK_STANCE_Y = NET_Y + 0.55;
// Close enough to that stance to be able to jump into a block at all.
export const TEAMMATE_BLOCK_READY_DISTANCE = 1;
// How far out from the net the incoming attack has to be before the teammate
// commits and jumps. Up to that point it keeps sliding along with the ball's
// live column, because an attack travels diagonally: the column the hitter
// struck from and the column the ball actually comes through the net on are
// two different places. Comfortably outside BLOCK_NET_BAND, so the wall is
// already up by the time the ball reaches the band.
export const TEAMMATE_BLOCK_LEAD_DISTANCE = 1.8;
// Getting to the net late is the same as not going, so the approach is run at
// scramble pace rather than the teammate's cruising TEAMMATE_SPEED.
export const TEAMMATE_BLOCK_APPROACH_SPEED = 5.5;

// --- Bewegungs-Boost -----------------------------------------------------
// A short burst of extra pace, armed by pressing Pass or Notfall-Schlag. It
// is the help for balls sitting just outside comfortable reach.
//
// Deliberately dumb, and that is the point: it fires on EVERY press, with no
// check of whether the ball is reachable, whether one is even in flight, or
// whether the extra pace is needed. There is nothing to read and nothing to
// game - press, and you move faster for a fixed moment.
//
// It is a pure speed multiplier on the movement the game would have produced
// anyway - the joystick's own direction, or the existing ASSIST_RANGE
// correction (see Player.updateActive). It steers nothing, extends no range,
// and touches no contact condition: a boosted player still only plays a ball
// they physically reach (see Player.ballReachable).
export const MOVE_BOOST_DURATION = 0.4; // seconds - fixed, regardless of outcome
export const MOVE_BOOST_MULTIPLIER = 1.5; // +50% over PLAYER_SPEED

// Light automatic "the AI nudges you the last bit of the way" correction used
// by Pass and Notfall-Schlag: a short range, walked smoothly.
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

// How far a spike is aimed, at full swipe strength. Big enough that a
// full-blooded swipe from an attacking position can carry the ball past the
// opponents' baseline - i.e. genuinely out. That is deliberate: see
// computeSpikeTarget, which no longer clamps the target into the court.
export const SPIKE_RANGE = 9;
// ...and at the shortest swipe that still registers. A flick drops the ball
// in just past the net; a full drag sends it deep, with the risk that comes
// with that.
export const SPIKE_MIN_RANGE = 3;

// --- Aim swipe -----------------------------------------------------------
// Drag length (CSS px) mapped onto swipe strength 0..1.
export const AIM_SWIPE_MIN_PX = 30;
export const AIM_SWIPE_MAX_PX = 220;
// Strength used when the aim comes from something with no length to it - the
// keyboard's WASD or the joystick. 1 = the full-strength shot, which is what
// those inputs produced before swipe length meant anything.
export const DEFAULT_AIM_STRENGTH = 1;
// Swipe length also nudges the PACE, on top of the net-distance ramp. Kept
// deliberately secondary: the net-distance rule spans 0.5s..1.1s (a factor of
// 2.2) and remains the dominant term, while this only stretches the result by
// up to 25% at the shortest swipe. At full strength the factor is exactly 1,
// so a full swipe reproduces the pure net-distance value.
export const SPIKE_SWIPE_SLOW_FACTOR = 1.25;
// Nobody puts the ball exactly where they aimed. Small enough that aiming is
// still clearly worth doing, big enough to feel.
export const SPIKE_SCATTER_RADIUS = 0.55;
// Polyline resolution of the live trajectory preview.
export const AIM_PREVIEW_SEGMENTS = 28;

export const WIN_SCORE = 21;
export const WIN_MARGIN = 2;

// Volleyball touch-limit: a team may touch the ball at most this many times
// before it must cross back over the net.
export const MAX_TEAM_TOUCHES = 3;

// Input buffering. A press is remembered for this long and fires at the exact
// moment the hitboxes meet (see TOUCH_DISTANCE) - never before it, and never
// after the window has run out. The buffer is what makes a strict touch rule
// playable: the player presses *around* the touch rather than on its exact
// frame.
//
// 180ms is a little over ten frames at 60fps. It used to be 1.2s, which is not
// a timing aid at all: a press that old fires on a ball arriving most of a
// second later, which is exactly the "the action went off before the ball got
// here" complaint.
export const INPUT_BUFFER_WINDOW = 0.18;

// Opponent auto-serve (also the bootstrap/fallback serve at game start): fair
// and easy to react to - AUTO_SERVE_DELAY is only ever reached at the very
// first serve of a game, since every later serve is dispatched explicitly by
// beginServe() right after the point-scored pause.
export const AUTO_SERVE_DELAY = 2;
export const AUTO_SERVE_DURATION = 2.2; // slowed down for reaction time - see HIT_DURATION's note
export const AUTO_SERVE_PEAK_HEIGHT = 3;

// Human serve: the ball rests "in hand" (tracks the player) until the serve
// button starts the routine - generous, so normal play never feels rushed - or
// this fallback timeout elapses, so the game can never get permanently stuck.
export const HUMAN_SERVE_TIMEOUT = 5; // seconds

// The serve routine itself: press once, and the ball is tossed straight up
// while the player jumps to meet it at the top. The strike is then an ordinary
// Jump-Smash - same slow-motion aim window, same live trajectory preview, same
// swipe-length power, same scatter, same possibility of hitting it out.
export const SERVE_TOSS_DURATION = 1.4; // whole up-and-down of the toss
// Toss height and jump timing are a matched pair, and both follow from the
// strict touch rule: the ball has to come back down THROUGH the player's own
// height while they are still in the air, since a touch needs the two circles
// within TOUCH_DISTANCE (0.5m) of each other.
//
// With the old 2.8m toss it never could. Computed against the jump curve: the
// ball was still at 2.29m when the jump peaked at 0.6m - a gap of 1.69m - and
// had only fallen to 0.74m by the time the player was back on the ground. At
// 1.6m the toss is still comfortably out of reach at the top (1.53m clear of a
// standing player at the moment the jump starts, so it cannot be caught off
// the ground) and then descends through the jump's own height, leaving roughly
// 0.27s of overlap to strike in.
export const SERVE_TOSS_PEAK_HEIGHT = 1.6;
export const SERVE_JUMP_DELAY = 0.85;
// While preparing to serve the player is pinned to their own baseline and may
// only move along it. This is the y they are held at.
export const SERVE_BASELINE_Y = COURT_LENGTH - PLAYER_RADIUS;

// How far a serve is aimed - the serve's own version of SPIKE_MIN_RANGE /
// SPIKE_RANGE, and the one thing about the strike that is NOT shared with the
// ordinary Jump-Smash.
//
// It has to be its own band because of where a serve is struck from. The
// baseline sits SERVE_BASELINE_Y - NET_Y = 7.65m from the net, so the spike
// band (3..9m) spends almost all of itself merely reaching it: measured, a
// full-strength straight swipe landed at y=6.65 - a dink 1.35m past the net -
// and any diagonal at all (a 45-degree swipe reaches only 6.36m forward)
// failed to cross at all. That is not a serve.
//
// These two span the same 0..1 swipe strength over the distances that
// actually matter from back there, so everything the swipe controls behaves
// exactly as it does for a spike - it just covers a serve's distances:
// the shortest swipe drops the ball in just over the net, a full one carries
// it past the opponents' baseline, i.e. genuinely out. As with the spike the
// target is never clamped into the court (see Player.computeSpikeTarget) - the
// live trajectory preview is what tells the player where it is going.
export const SERVE_MIN_RANGE = 8.5; // straight ahead: lands 0.85m past the net
export const SERVE_MAX_RANGE = 16.5; // straight ahead: 0.85m past their baseline - out
// What the serve is aimed at when the player expresses no aim at all - no
// swipe, no stick - and the aim window simply times out. DEFAULT_AIM_STRENGTH
// (1, the spike's default) would be full range, which from the baseline is a
// serve that sails out on its own: an automatic fault for doing nothing, which
// is not a choice the player made. This lands it deep but comfortably in
// (straight ahead: y = 1.95, ~2m inside their baseline). Any aim the player
// DOES express still applies exactly as expressed - there is no correction,
// and a full-strength swipe still goes out.
export const SERVE_DEFAULT_AIM_STRENGTH = 0.65;

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
// the Pass, the AI teammate's set and emergency-set, the opponent's normal
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
// How far the ball may creep away from the point of contact during the
// slow-motion aim window before the strike is abandoned.
//
// The aim window is a stylised freeze of a contact that has ALREADY happened:
// it opens the instant the hitboxes meet, and it holds the player still while
// the ball creeps on at SLOWMO_FACTOR. Re-testing the strict touch at the end
// of it would therefore throw away almost every smash - measured, a set
// drifting 2cm during the window was enough to take the ball back out of the
// 0.5m hitbox and drop the strike entirely.
//
// So the resolve asks a different question: is this still the same ball, in
// essentially the same place? Over the window the ball covers speed * 0.099s
// (0.55s at 0.18x), so this threshold separates cleanly at ~8 m/s: a set or a
// pass creeps 0.2-0.4m and is struck, while a hard shot at 14 m/s travels
// 1.4m, is genuinely gone, and is correctly let fly on untouched.
export const SLOWMO_CONTACT_TOLERANCE = 0.8;

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
// "comes near" and "flies toward them".
export const TEAMMATE_REACT_RADIUS = 2.5;

// How much closer to the ball the player must be than the teammate before the
// teammate defers to them on proximity alone (see playerHasPriority's third
// rule in TeammateAI). Without a margin here, a player a mere centimeter
// closer already claimed the ball - including when they had no intention of
// playing it at all (nothing pressed at all), so the teammate would stand
// by and let balls drop. This is deliberately only the *proximity* rule's
// tolerance: an active claim (Pass/Notfall-Schlag pressed within
// ASSIST_RANGE) still wins outright, at any distance, with no margin
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
// NET_RISK_*). SET_NET_APPROACH_Y sits comfortably inside
// NET_RISK_SAFE_DISTANCE, so blending the target toward it gives the player a
// short, realistic distance to close before jumping - see TeammateAI.playBall.
export const TEAMMATE_SET_DURATION = 1.5; // slowed down for reaction time - see HIT_DURATION's note
export const TEAMMATE_SET_PEAK_HEIGHT = 3.5;
// Used in BOTH directions now, because the set-up is the same geometric idea
// whichever way round it goes: the teammate setting the player up, and the
// player's Pass setting the teammate up (see Player.firePass). One shared pair
// of values so the two can never drift apart.
export const SET_NET_APPROACH_Y = NET_Y + 1.5;
export const SET_NET_BLEND = 0.7; // 0 = pure receiver position, 1 = pure near-net point

// Role swap: when the human player passes to the AI teammate, that pass is
// aimed near the net (SET_NET_* above) so the teammate can attack off it. On
// that touch the teammate picks its own shot rather than always setting back.
//
// A spike needs both the position and the ball for it: close enough to the net
// to hit down over it, and the ball high enough to actually strike downward
// rather than scoop. When both hold, TEAMMATE_SPIKE_CHANCE decides between the
// hard spike and the safer attacking hit - the "spontaneous" part, so the same
// situation doesn't always produce the same shot.
export const TEAMMATE_SPIKE_MAX_NET_DISTANCE = 3; // metres from the net
export const TEAMMATE_SPIKE_MIN_HEIGHT = 0.8; // metres of ball height at contact
export const TEAMMATE_SPIKE_CHANCE = 0.6;
// The safer alternative: a controlled attacking hit over the net. Slower and
// loopier than a spike, but it still aims at the gap in the opponents' defence
// rather than at a random spot.
export const TEAMMATE_ATTACK_HIT_DURATION = 1.2;
export const TEAMMATE_ATTACK_HIT_PEAK_HEIGHT = 2;
// Inset from the court edges when aiming an attack, so a shot at the gap still
// lands comfortably in bounds.
export const ATTACK_TARGET_MARGIN = 1;

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

// --- Defence only -------------------------------------------------------
// None of the following touches how the opponents ATTACK: their error rate,
// attack rate and shot parameters above are deliberately untouched, so they
// stay just as error-prone and beatable when it is their turn to hit.
//
// Scramble speed: against a genuinely hard incoming ball a defender digs at
// more than its cruising pace. Applies only while chasing such a ball - the
// walk back to base, and any normal-paced ball, still use OPPONENT_SPEED.
export const OPPONENT_DEFENSIVE_SPEED = 5.5;
// What counts as "hard": a flight arriving faster than this. A spike at the
// net is 0.5s and a fully-weakened one 1.1s, so this catches the dangerous
// half of the spike range plus the opponents' own attack pace, while a normal
// return (1.9s) or serve (2.2s) is not a scramble.
export const OPPONENT_HARD_BALL_DURATION = 1.2;
// Anticipation: while the ball is still on the human side - i.e. an attack is
// being built - the defenders shade sideways toward it instead of standing on
// their zone centre, so they start the dig from a better place. 0 = never
// move off the zone centre, 1 = line up exactly on the ball's column. Only x
// shades; the net/back zone split itself is left intact.
export const OPPONENT_READY_SHADE = 0.6;
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
