import { clamp, lerp } from '../utils/math';
import {
  SPIKE_DURATION,
  SPIKE_PEAK_HEIGHT,
  SPIKE_POWER_FULL_DISTANCE,
  SPIKE_POWER_MIN_DISTANCE,
  SPIKE_WEAK_DURATION,
  SPIKE_WEAK_PEAK_HEIGHT,
} from './constants';

/** How much power a spike has lost to the distance it was struck from:
 * 0 = at the net, full force; 1 = from SPIKE_POWER_MIN_DISTANCE or beyond, at
 * its weakest. Linear in between. */
export function spikeWeakness(netDistance: number): number {
  return clamp(
    (netDistance - SPIKE_POWER_FULL_DISTANCE) / (SPIKE_POWER_MIN_DISTANCE - SPIKE_POWER_FULL_DISTANCE),
    0,
    1,
  );
}

/** The flight parameters of a spike struck from `netDistance` metres out.
 * Shared by the human player and the AI teammate so the "closer to the net =
 * harder" rule is one rule, applied identically to whoever is attacking. */
export function spikeShot(netDistance: number): { duration: number; peakHeight: number } {
  const weakness = spikeWeakness(netDistance);
  return {
    duration: lerp(SPIKE_DURATION, SPIKE_WEAK_DURATION, weakness),
    peakHeight: lerp(SPIKE_PEAK_HEIGHT, SPIKE_WEAK_PEAK_HEIGHT, weakness),
  };
}
