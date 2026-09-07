import { describe, it, expect } from "vitest";
import { absorption, makeTail, simulate } from "../src/acoustics";
import { analyzeSweep, estimateDecay, fft, generateSweep } from "../src/dsp";
import {
  demoRoom,
  MATERIALS,
  roomArea,
  validateRoom,
  validPolygon,
} from "../src/model";

describe("deterministic geometry and image-source acoustics", () => {
  it("matches analytical distance, propagation, and six first reflections for a shoebox", () => {
    const r = demoRoom("shoebox"),
      s = simulate(r, false, 1);
    expect(roomArea(r)).toBe(24);
    expect(s.volume).toBeCloseTo(67.2);
    expect(s.directDistance).toBeCloseTo(Math.hypot(2.5, 0.05, 1.7));
    expect(s.directDelay).toBeCloseTo(s.directDistance / 343);
    expect(s.paths.filter((p) => p.order === 1)).toHaveLength(6);
    const north = s.paths.find((p) => p.id === "wall-0")!;
    expect(north.length).toBeCloseTo(
      Math.hypot(
        r.source.x - r.listener.x,
        r.source.z + r.listener.z,
        r.source.y - r.listener.y,
      ),
    );
    expect(north.points[1].z).toBeCloseTo(0);
    expect(north.gains[3]).toBeCloseTo(
      Math.sqrt(1 - MATERIALS.plaster.alpha[3]) / (1 + north.length),
    );
    for (const p of s.paths) {
      expect(p.delay).toBeGreaterThanOrEqual(s.directDelay);
      expect(p.points.every((v) => v.y >= 0 && v.y <= r.ceiling)).toBe(true);
    }
  });
  it("updates delays with a moved source and finds second reflections", () => {
    const r = demoRoom(),
      before = simulate(r, false),
      after = simulate({ ...r, source: { x: 1, z: 4, y: 1.25 } }, false);
    expect(before.paths.some((p) => p.order === 2)).toBe(true);
    expect(after.directDelay).not.toBe(before.directDelay);
    expect(after.paths.find((p) => p.id === "wall-0")?.points).not.toEqual(
      before.paths.find((p) => p.id === "wall-0")?.points,
    );
  });
  it("reduces decay and hit-path gain with treatment; original remains intact", () => {
    const r = demoRoom("treated"),
      before = simulate(r, false),
      after = simulate(r, true);
    expect(after.rt60[3]).toBeLessThan(before.rt60[3] * 0.8);
    expect(after.paths.find((p) => p.id === "wall-1")!.gains[3]).toBeLessThan(
      before.paths.find((p) => p.id === "wall-1")!.gains[3] * 0.5,
    );
    expect(after.baselineRT).toEqual(before.rt60);
    expect(after.paths.find((p) => p.id === "direct")!.gains).toEqual(
      before.paths.find((p) => p.id === "direct")!.gains,
    );
  });
  it("does not double-count overlapping treatments", () => {
    const r = demoRoom("treated"),
      one = absorption(r, true);
    r.treatments.push({ ...r.treatments[0], id: "duplicate" });
    expect(absorption(r, true)).toEqual(one);
  });
  it("validates room backups and rejects NaN, crossing boundaries and invalid objects", () => {
    const r = demoRoom();
    expect(validateRoom(JSON.parse(JSON.stringify(r)))).toEqual(r);
    expect(
      validPolygon([
        { x: 0, z: 0 },
        { x: 5, z: 5 },
        { x: 0, z: 5 },
        { x: 5, z: 0 },
      ]),
    ).toBe(false);
    expect(() => validateRoom({ ...r, ceiling: NaN })).toThrow();
    expect(() =>
      validateRoom({ ...r, source: { x: 200, y: 1, z: 1 } }),
    ).toThrow();
    expect(() =>
      validateRoom({ ...r, openings: [{ ...r.openings[0], offset: 100 }] }),
    ).toThrow();
    expect(() =>
      validateRoom({ ...r, photos: ["https://external.example/private.png"] }),
    ).toThrow();
  });
  it("rejects a direct segment that crosses the exterior of a concave room", () => {
    const r = demoRoom("shoebox"),
      points = [
        { x: 0, z: 0 },
        { x: 6, z: 0 },
        { x: 6, z: 2 },
        { x: 2, z: 2 },
        { x: 2, z: 6 },
        { x: 0, z: 6 },
      ];
    r.walls = points.map((a, i) => ({
      id: `wall-${i}`,
      a,
      b: points[(i + 1) % points.length],
      material: "plaster",
      confidence: "user-defined",
    }));
    r.source = { x: 5, z: 1, y: 1 };
    r.listener = { x: 1, z: 5, y: 1 };
    expect(simulate(r, false).paths.find((p) => p.order === 0)).toBeUndefined();
  });
});
describe("audio and calibration DSP", () => {
  it("generates deterministic, decorrelated stereo reverberation with treatment energy changes", () => {
    const a = makeTail([1, 1, 1, 1, 1, 1], 12000),
      b = makeTail([1, 1, 1, 1, 1, 1], 12000),
      c = makeTail([0.4, 0.4, 0.4, 0.4, 0.4, 0.4], 12000);
    expect(a[0]).toEqual(b[0]);
    expect(a[0]).not.toEqual(a[1]);
    const energy = (x: Float32Array) => x.reduce((n, v) => n + v * v, 0);
    expect(energy(c[0])).toBeLessThan(energy(a[0]) * 0.5);
    expect(a[0].every(Number.isFinite)).toBe(true);
  });
  it("roundtrips FFT and estimates a known synthetic T20 decay", () => {
    const re = Float64Array.from([1, 0.5, -0.4, 0.1, 0, 0, 0, 0]),
      original = re.slice(),
      im = new Float64Array(8);
    fft(re, im);
    fft(re, im, true);
    re.forEach((v, i) => expect(v).toBeCloseTo(original[i], 10));
    const sr = 12000,
      ir = new Float32Array(sr * 2),
      expected = 0.8;
    for (let i = 0; i < ir.length; i++)
      ir[i] = Math.exp((-6.907755 * i) / sr / expected) * Math.sin(i * 1.53);
    const decay = estimateDecay(ir, sr);
    expect(decay.rt60).toBeCloseTo(expected, 1);
    expect(decay.r2).toBeGreaterThan(0.99);
  });
  it("limits sweep output and rejects silence and clipping", () => {
    const sweep = generateSweep(12000);
    expect(sweep).toHaveLength(36000);
    expect(Math.max(...sweep.map(Math.abs))).toBeLessThanOrEqual(0.025001);
    expect(sweep[0]).toBe(0);
    expect(() => analyzeSweep(new Float32Array(72000), sweep, 12000)).toThrow(
      /quiet/,
    );
    const clipped = new Float32Array(72000);
    clipped[10] = 1;
    expect(() => analyzeSweep(clipped, sweep, 12000)).toThrow(/clipped/);
  });
  it("recovers decay from a synthetic sweep passed through a known room impulse response", () => {
    const sr = 12000,
      sweep = generateSweep(sr),
      expected = 0.65;
    let n = 1;
    while (n < sweep.length + sr * 2) n *= 2;
    const xr = new Float64Array(n),
      xi = new Float64Array(n),
      hr = new Float64Array(n),
      hi = new Float64Array(n);
    xr.set(sweep);
    hr[3000] = 1;
    let seed = 42;
    for (let i = 1; i < sr * 1.7; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      hr[i + 3000] =
        ((seed / 4294967296) * 2 - 1) *
        0.12 *
        Math.exp((-6.907755 * i) / sr / expected);
    }
    fft(xr, xi);
    fft(hr, hi);
    for (let i = 0; i < n; i++) {
      const re = xr[i] * hr[i] - xi[i] * hi[i],
        im = xr[i] * hi[i] + xi[i] * hr[i];
      xr[i] = re;
      xi[i] = im;
    }
    fft(xr, xi, true);
    const captured = analyzeSweep(
      Float32Array.from(xr.subarray(0, sr * 6)),
      sweep,
      sr,
    );
    expect(captured.rt60).toBeGreaterThan(expected * 0.85);
    expect(captured.rt60).toBeLessThan(expected * 1.15);
    expect(captured.r2).toBeGreaterThan(0.95);
  });
});
