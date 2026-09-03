/**
 * Thin indirection around Math.random() so every probabilistic decision in the
 * game (serve/emergency-set targets, the jump-smash net-fault risk roll, the
 * opponent's error/attack roll) can be made deterministic in tests without
 * touching the global Math object. Production code always uses the default;
 * tests swap it via setRandom() (exposed as window.__setRandom in main.ts).
 */
let rngFn: () => number = Math.random;

export function random(): number {
  return rngFn();
}

/** Overrides the RNG used by random(). Pass Math.random to restore default. */
export function setRandom(fn: () => number): void {
  rngFn = fn;
}
