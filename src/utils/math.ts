export interface Vec2 {
  x: number;
  y: number;
}

/** Court-space 3D point: x/y are the ground plane (see constants.ts), z is height
 * above the sand in meters. The game is played top-down, but the ball and the
 * players' reach are genuinely three-dimensional - contact tests and the net
 * both depend on z. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });

export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });

export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });

export const length = (a: Vec2): number => Math.hypot(a.x, a.y);

export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  if (l < 1e-6) return { x: 0, y: 0 };
  return { x: a.x / l, y: a.y / l };
};

export const distance = (a: Vec2, b: Vec2): number => length(sub(a, b));

export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerpVec2 = (a: Vec2, b: Vec2, t: number): Vec2 => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Rotates `v` by `radians` (positive = counter-clockwise in court space). Used
 * to apply the spike's random spread to an aim direction. */
export const rotate = (v: Vec2, radians: number): Vec2 => {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
};

/** Nearest point to `p` on the line segment from `a` to `b` (clamped to the
 * segment, not the infinite line). Used to find where along a ball's remaining
 * flight path a player's boosted approach should head toward. */
export const closestPointOnSegment = (p: Vec2, a: Vec2, b: Vec2): Vec2 => {
  const ab = sub(b, a);
  const abLenSq = dot(ab, ab);
  if (abLenSq < 1e-9) return { ...a };
  const t = clamp(dot(sub(p, a), ab) / abLenSq, 0, 1);
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
};

export const horizontalDistance = (a: Vec3, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);

/** Uniform random number in [min, max). */
export const randomBetween = (min: number, max: number): number =>
  min + Math.random() * (max - min);
