import {
  BANDS,
  MATERIALS,
  distance,
  inside,
  roomArea,
  wallLength,
} from "./model";
import type { Room, Vec3, Wall, MaterialId } from "./model";
export type SoundPath = {
  id: string;
  points: Vec3[];
  order: number;
  length: number;
  delay: number;
  gains: number[];
  surfaces: string[];
};
export type AcousticResult = {
  paths: SoundPath[];
  rt60: number[];
  baselineRT: number[];
  volume: number;
  absorption: number[];
  directDistance: number;
  directDelay: number;
  clarity: number;
  elapsedMs: number;
  testedPaths: number;
  provenance: "inferred" | "illustrative" | "fitted";
};
type Surface = { id: string; wall?: Wall; y?: number; material: MaterialId };
const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});
function reflect(p: Vec3, s: Surface): Vec3 {
  if (!s.wall) return { ...p, y: 2 * s.y! - p.y };
  const w = s.wall,
    dx = w.b.x - w.a.x,
    dz = w.b.z - w.a.z;
  const t = ((p.x - w.a.x) * dx + (p.z - w.a.z) * dz) / (dx * dx + dz * dz);
  return {
    x: 2 * (w.a.x + t * dx) - p.x,
    y: p.y,
    z: 2 * (w.a.z + t * dz) - p.z,
  };
}
function intersection(a: Vec3, b: Vec3, s: Surface, r: Room): Vec3 | null {
  let t: number;
  if (!s.wall) {
    if (Math.abs(b.y - a.y) < 1e-8) return null;
    t = (s.y! - a.y) / (b.y - a.y);
  } else {
    const w = s.wall,
      wx = w.b.x - w.a.x,
      wz = w.b.z - w.a.z,
      dx = b.x - a.x,
      dz = b.z - a.z;
    const den = dx * wz - dz * wx;
    if (Math.abs(den) < 1e-8) return null;
    t = ((w.a.x - a.x) * wz - (w.a.z - a.z) * wx) / den;
    const u = ((w.a.x - a.x) * dz - (w.a.z - a.z) * dx) / den;
    if (u < 0.0001 || u > 0.9999) return null;
  }
  if (t <= 0.00001 || t >= 0.99999) return null;
  const p = lerp(a, b, t);
  if (s.wall ? p.y < 0 || p.y > r.ceiling : !inside(p, r)) return null;
  return p;
}
function unobstructed(a: Vec3, b: Vec3, r: Room) {
  if (!inside(lerp(a, b, 0.5), r)) return false;
  return !r.walls.some((w) =>
    intersection(a, b, { id: w.id, wall: w, material: w.material }, r),
  );
}
export function hitMaterial(
  s: Surface,
  p: Vec3,
  r: Room,
  treated: boolean,
): MaterialId {
  if (!s.wall) {
    if (s.id === "floor")
      for (const f of r.furniture.filter((f) => f.kind === "rug")) {
        const dx = p.x - f.x,
          dz = p.z - f.z,
          x = dx * Math.cos(f.rotation) + dz * Math.sin(f.rotation),
          z = -dx * Math.sin(f.rotation) + dz * Math.cos(f.rotation);
        if (Math.abs(x) < f.width / 2 && Math.abs(z) < f.depth / 2)
          return f.material;
      }
    return s.material;
  }
  const offset = Math.hypot(p.x - s.wall.a.x, p.z - s.wall.a.z);
  if (treated)
    for (const t of r.treatments)
      if (
        t.wallId === s.id &&
        Math.abs(offset - t.offset) <= t.width / 2 &&
        Math.abs(p.y - r.ceiling / 2) <= t.height / 2
      )
        return t.material;
  for (const o of r.openings)
    if (
      o.wallId === s.id &&
      Math.abs(offset - o.offset) <= o.width / 2 &&
      p.y >= o.sill &&
      p.y <= o.sill + o.height
    )
      return o.material;
  return s.material;
}
// Integrate wall patches on a deterministic grid so overlapping treatments never double-count area.
export function absorption(r: Room, treated: boolean): number[] {
  const area = roomArea(r),
    A = BANDS.map(
      (_, i) =>
        area *
        (MATERIALS[r.floorMaterial].alpha[i] +
          MATERIALS[r.ceilingMaterial].alpha[i]),
    );
  for (const w of r.walls) {
    const len = wallLength(w),
      cols = Math.ceil(len / 0.15),
      rows = Math.ceil(r.ceiling / 0.15),
      da = (len * r.ceiling) / (cols * rows);
    for (let x = 0; x < cols; x++)
      for (let y = 0; y < rows; y++) {
        const p = {
          x: w.a.x + ((w.b.x - w.a.x) * (x + 0.5)) / cols,
          z: w.a.z + ((w.b.z - w.a.z) * (x + 0.5)) / cols,
          y: (r.ceiling * (y + 0.5)) / rows,
        };
        const m = hitMaterial(
          { id: w.id, wall: w, material: w.material },
          p,
          r,
          treated,
        );
        A.forEach((_, i) => (A[i] += da * MATERIALS[m].alpha[i]));
      }
  }
  for (const f of r.furniture) {
    const surface =
      f.kind === "rug"
        ? f.width * f.depth
        : (2 * f.height * (f.width + f.depth) + f.width * f.depth) * 0.65;
    A.forEach(
      (_, i) =>
        (A[i] +=
          surface *
          (MATERIALS[f.material].alpha[i] -
            (f.kind === "rug" ? MATERIALS[r.floorMaterial].alpha[i] : 0))),
    );
  }
  const scale = r.calibration?.applied ? r.calibration.scale : 1;
  return A.map((a) => Math.max(0.1, a * scale));
}
export function simulate(r: Room, treated: boolean, order = 2): AcousticResult {
  const start = performance.now(),
    volume = roomArea(r) * r.ceiling;
  const A = absorption(r, treated),
    baseA = absorption(r, false);
  const decay = (a: number[]) =>
    a.map((v, i) =>
      Math.max(
        0.08,
        Math.min(5, (0.161 * volume) / (v + 0.0004 * (i + 1) * volume)),
      ),
    );
  const rt60 = decay(A),
    baselineRT = decay(baseA),
    directDistance = distance(r.source, r.listener);
  const surfaces: Surface[] = [
    ...r.walls.map((w) => ({ id: w.id, wall: w, material: w.material })),
    { id: "floor", y: 0, material: r.floorMaterial },
    { id: "ceiling", y: r.ceiling, material: r.ceilingMaterial },
  ];
  const paths: SoundPath[] = [];
  if (unobstructed(r.source, r.listener, r))
    paths.push({
      id: "direct",
      points: [r.source, r.listener],
      order: 0,
      length: directDistance,
      delay: directDistance / 343,
      gains: BANDS.map(() => 1 / (1 + directDistance)),
      surfaces: [],
    });
  let testedPaths = 1;
  const solve = (sequence: Surface[]) => {
    testedPaths++;
    const images = [r.source];
    sequence.forEach((s) => images.push(reflect(images[images.length - 1], s)));
    let current = r.listener;
    const hits: Vec3[] = [];
    for (let i = sequence.length - 1; i >= 0; i--) {
      const hit = intersection(current, images[i + 1], sequence[i], r);
      if (!hit) return;
      hits.unshift(hit);
      current = hit;
    }
    const points = [r.source, ...hits, r.listener];
    if (points.slice(1).some((p, i) => !unobstructed(points[i], p, r))) return;
    const length = points
      .slice(1)
      .reduce((n, p, i) => n + distance(p, points[i]), 0);
    const gains = BANDS.map((_, b) =>
      hits.reduce(
        (amp, p, i) =>
          amp *
          Math.sqrt(
            1 - MATERIALS[hitMaterial(sequence[i], p, r, treated)].alpha[b],
          ),
        1 / (1 + length),
      ),
    );
    paths.push({
      id: sequence.map((s) => s.id).join("/"),
      points,
      order: sequence.length,
      length,
      delay: length / 343,
      gains,
      surfaces: sequence.map((s) => s.id),
    });
  };
  for (const a of surfaces) {
    solve([a]);
    if (order > 1) for (const b of surfaces) if (a.id !== b.id) solve([a, b]);
  }
  paths.sort((a, b) => a.delay - b.delay);
  const midRT = (rt60[2] + rt60[3]) / 2;
  const early = paths
    .filter((p) => p.delay < 0.05)
    .reduce((n, p) => n + p.gains[3] ** 2, 0);
  const late = Math.exp((-13.8155 * 0.05) / midRT) * 0.1 * midRT;
  return {
    paths,
    rt60,
    baselineRT,
    volume,
    absorption: A,
    directDistance,
    directDelay: directDistance / 343,
    clarity:
      10 * Math.log10(Math.max(0.00001, early) / Math.max(0.00001, late)),
    elapsedMs: performance.now() - start,
    testedPaths,
    provenance: r.calibration?.applied
      ? "fitted"
      : r.provenance === "illustrative"
        ? "illustrative"
        : "inferred",
  };
}
export function makeTail(rt60: number[], sampleRate: number, seed = 7341) {
  const size = Math.ceil(Math.min(3, Math.max(...rt60)) * sampleRate);
  const channels = [new Float32Array(size), new Float32Array(size)];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state / 4294967296) * 2 - 1;
  };
  for (const channel of channels) {
    for (let b = 0; b < BANDS.length; b++) {
      let low = 0,
        high = 0;
      const a =
          1 - Math.exp((-2 * Math.PI * BANDS[b] * Math.SQRT2) / sampleRate),
        c = 1 - Math.exp((-2 * Math.PI * BANDS[b]) / Math.SQRT2 / sampleRate);
      for (let i = 0; i < size; i++) {
        const noise = random();
        low += a * (noise - low);
        high += c * (noise - high);
        const t = i / sampleRate;
        if (t > 0.035)
          channel[i] +=
            (low - high) *
            Math.exp((-6.90776 * t) / rt60[b]) *
            Math.min(1, (t - 0.035) / 0.025) *
            0.032 *
            Math.sqrt(48000 / sampleRate);
      }
    }
  }
  return channels;
}
