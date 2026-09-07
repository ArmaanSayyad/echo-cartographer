export function fft(re: Float64Array, im: Float64Array, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j,
          b = a + len / 2,
          vr = re[b] * ur - im[b] * ui,
          vi = re[b] * ui + im[b] * ur;
        re[b] = re[a] - vr;
        im[b] = im[a] - vi;
        re[a] += vr;
        im[a] += vi;
        const next = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = next;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
export function generateSweep(
  sampleRate: number,
  seconds = 3,
  amplitude = 0.025,
) {
  const data = new Float32Array(Math.floor(seconds * sampleRate)),
    lo = 100,
    hi = Math.min(12000, sampleRate * 0.42),
    k = seconds / Math.log(hi / lo);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      ramp = Math.min(1, t / 0.05, (seconds - t) / 0.1);
    data[i] =
      amplitude *
      Math.max(0, ramp) *
      Math.sin(2 * Math.PI * lo * k * (Math.exp(t / k) - 1));
  }
  return data;
}
export function estimateDecay(ir: Float32Array, sampleRate: number) {
  const energy = new Float64Array(ir.length);
  const noiseStart = Math.floor(ir.length * 0.85);
  let noise = 0;
  for (let i = noiseStart; i < ir.length; i++) noise += ir[i] ** 2;
  noise /= Math.max(1, ir.length - noiseStart);
  let sum = 0;
  // Noise-compensated backward integration, then a -5 to -25 dB regression (T20).
  for (let i = ir.length - 1; i >= 0; i--) {
    sum = Math.max(0, sum + ir[i] ** 2 - noise);
    energy[i] = sum;
  }
  const total = energy[0];
  if (total < 1e-12)
    throw new Error(
      "No usable decay was captured. Check the speaker output and microphone.",
    );
  const peak = ir.reduce((p, v) => Math.max(p, v * v), 0),
    snr = 10 * Math.log10(peak / Math.max(noise, 1e-15));
  let n = 0,
    sx = 0,
    sy = 0,
    sxx = 0,
    sxy = 0,
    syy = 0,
    first = 0,
    last = 0;
  const decay: number[] = [];
  for (
    let i = 0;
    i < ir.length;
    i += Math.max(1, Math.floor(sampleRate / 500))
  ) {
    const db = Math.max(
        -100,
        10 * Math.log10(Math.max(1e-15, energy[i] / total)),
      ),
      t = i / sampleRate;
    if (decay.length < 1000) decay.push(db);
    if (db <= -5 && db >= -25) {
      if (!n) first = t;
      last = t;
      n++;
      sx += t;
      sy += db;
      sxx += t * t;
      sxy += t * db;
      syy += db * db;
    }
  }
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx),
    rt60 = -60 / slope;
  const r2 =
    (n * sxy - sx * sy) ** 2 / ((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (
    snr < 30 ||
    n < 12 ||
    last - first < 0.025 ||
    !Number.isFinite(rt60) ||
    rt60 < 0.1 ||
    rt60 > 5 ||
    !Number.isFinite(r2) ||
    r2 < 0.85
  )
    throw new Error(
      "This capture cannot support a reliable decay fit. Reduce background noise, use a room speaker, and retry. No parameters were changed.",
    );
  return { rt60, r2, snr, decay };
}
export function analyzeSweep(
  recording: Float32Array,
  sweep: Float32Array,
  sampleRate: number,
) {
  let peak = 0;
  for (const v of recording) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.98)
    throw new Error(
      "The microphone clipped. Lower the speaker or input level and try again.",
    );
  if (peak < 0.001)
    throw new Error(
      "The recording is too quiet. Check the microphone and speaker output.",
    );
  let n = 1;
  while (n < recording.length + sweep.length) n *= 2;
  const xr = new Float64Array(n),
    xi = new Float64Array(n),
    yr = new Float64Array(n),
    yi = new Float64Array(n);
  xr.set(sweep);
  yr.set(recording);
  fft(xr, xi);
  fft(yr, yi);
  let maxPower = 0;
  for (let i = 0; i < n; i++)
    maxPower = Math.max(maxPower, xr[i] ** 2 + xi[i] ** 2);
  for (let i = 0; i < n; i++) {
    const den = xr[i] ** 2 + xi[i] ** 2 + maxPower * 1e-5;
    const re = (yr[i] * xr[i] + yi[i] * xi[i]) / den,
      im = (yi[i] * xr[i] - yr[i] * xi[i]) / den;
    yr[i] = re;
    yi[i] = im;
  }
  fft(yr, yi, true);
  let onset = 0;
  for (let i = 0; i < Math.min(recording.length, sampleRate * 2); i++)
    if (Math.abs(yr[i]) > Math.abs(yr[onset])) onset = i;
  const ir = Float32Array.from(
    yr.slice(onset, onset + Math.min(sampleRate * 1.8, n - onset)),
  );
  const result = estimateDecay(ir, sampleRate);
  const step = Math.max(1, Math.floor(ir.length / 600));
  const impulse: number[] = [];
  const irPeak = Math.max(
    ...Array.from(ir.subarray(0, Math.min(1000, ir.length)), Math.abs),
    1e-10,
  );
  for (let i = 0; i < ir.length && impulse.length < 600; i += step) {
    let max = 0;
    for (let j = i; j < Math.min(i + step, ir.length); j++)
      if (Math.abs(ir[j]) > Math.abs(max)) max = ir[j];
    impulse.push(max / irPeak);
  }
  return { ...result, impulse };
}
