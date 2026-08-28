import { Vec2 } from '../utils/math';

/**
 * The four things a player can ask for. Serving deliberately reuses 'jump':
 * the serve is a jump with a toss in front of it, and the serve button emits
 * the same action the Q key does, so there is exactly one code path from
 * "player asked to hit" to "the ball was actually struck".
 */
export type ActionType = 'pass' | 'emergency' | 'block' | 'jump';

export type InputMode = 'touch' | 'keyboard';

export interface SwipeSample {
  /** Court-space direction of the swipe. */
  dir: Vec2;
  /** 0..1, how far the finger travelled - feeds the spike's secondary power term. */
  strength: number;
}

export interface InputSnapshot {
  /** Court-space movement direction, magnitude 0..1. Zero the instant the
   * stick is released or every WASD key is up: players stop dead. */
  move: Vec2;
  /** Court-space aim direction currently held, or null if none. While airborne
   * this steers the spike instead of the player. */
  aim: Vec2 | null;
  /** Actions newly pressed this frame. */
  pressed: ActionType[];
  /** Live swipe currently in progress (touch aiming during slow motion). */
  swipe: SwipeSample | null;
  /** Set on the single frame a swipe was released - the touch equivalent of
   * pressing the hit trigger. */
  swipeReleased: SwipeSample | null;
  mode: InputMode;
}
