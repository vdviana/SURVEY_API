export type CognitiveSample = {
  tMs: number;
  type: string;
  x?: number;
  y?: number;
  module?: string;
  questionId?: string;
  pointerId?: number;
  gx?: number;
  gy?: number;
  gz?: number;
  ax?: number;
  ay?: number;
  az?: number;
  lux?: number;
  effort01?: number;
  trackingError?: number;
  rtMs?: number;
  errorCount?: number;
  hitRate?: number;
  fidelity01?: number;
  sensorEnergy?: number;
  difficulty?: number;
  dualTaskBreaks?: number;
  meta?: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Port of APP telemetry assertiveness — timing + effort + gradient response fidelity. */
export function computeAssertivenessBps(samples: CognitiveSample[]): number {
  if (samples.length < 8) return 5000;

  const moveDeltas: number[] = [];
  let prevMove = -1;
  for (const s of samples) {
    if (s.type === 'touch_move' || s.type === 'touch_start' || s.type === 'gyro') {
      if (prevMove >= 0) moveDeltas.push(s.tMs - prevMove);
      prevMove = s.tMs;
    }
  }

  const answerLatencies = samples
    .filter((s) => s.type === 'answer')
    .map((s, i, arr) => {
      let prev: CognitiveSample | undefined;
      for (let j = samples.length - 1; j >= 0; j--) {
        const p = samples[j];
        if (p.tMs < s.tMs && (p.type === 'focus' || p.type === 'module_switch')) {
          prev = p;
          break;
        }
      }
      return prev ? s.tMs - prev.tMs : i > 0 ? s.tMs - arr[i - 1].tMs : 800;
    });

  const honeypotHits = samples.filter((s) => s.type === 'honeypot').length;
  const invalidTaps = samples.filter((s) => s.type === 'invalid_tap').length;
  const totalTaps = samples.filter(
    (s) => s.type === 'touch_start' || s.type === 'invalid_tap' || s.type === 'honeypot',
  ).length;

  const mean =
    moveDeltas.length > 0
      ? moveDeltas.reduce((a, b) => a + b, 0) / moveDeltas.length
      : 16;
  const variance =
    moveDeltas.length > 1
      ? moveDeltas.reduce((a, d) => a + (d - mean) ** 2, 0) / moveDeltas.length
      : 0;
  const cv = mean > 0 ? Math.sqrt(variance) / mean : 0;
  const irregularityScore = clamp(cv / 0.45, 0, 1);

  const latencyMean =
    answerLatencies.length > 0
      ? answerLatencies.reduce((a, b) => a + b, 0) / answerLatencies.length
      : 900;
  const latencyScore =
    latencyMean < 120
      ? 0.15
      : latencyMean > 4000
        ? 0.35
        : clamp(1 - Math.abs(latencyMean - 900) / 2000, 0.2, 1);

  const badRate = totalTaps > 0 ? (honeypotHits + invalidTaps) / totalTaps : 0;
  const cleanScore = clamp(1 - badRate * 2.5, 0, 1);

  const efforts = samples.filter((s) => s.type === 'effort' && s.effort01 != null);
  let effortScore = 0.5;
  if (efforts.length > 4) {
    const vals = efforts.map((e) => e.effort01!);
    const eMean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const eVar = vals.reduce((a, v) => a + (v - eMean) ** 2, 0) / vals.length;
    const flatPenalty = eVar < 0.002 ? 0.25 : 1;
    effortScore = clamp(eMean * 0.7 + Math.sqrt(eVar) * 2, 0, 1) * flatPenalty;
  }

  const graded = samples.filter(
    (s) =>
      s.type === 'answer' &&
      (typeof s.fidelity01 === 'number' || typeof s.hitRate === 'number'),
  );
  let responseScore = 0.5;
  if (graded.length > 0) {
    responseScore = clamp(
      graded.reduce((a, s) => a + (s.fidelity01 ?? s.hitRate ?? 0), 0) / graded.length,
      0,
      1,
    );
  }

  const blended =
    irregularityScore * 0.28 +
    latencyScore * 0.2 +
    cleanScore * 0.12 +
    effortScore * 0.2 +
    responseScore * 0.2;
  return clamp(Math.round(5500 + blended * 3700), 0, 10000);
}

export function sketchFingerprint(samples: CognitiveSample[]): string {
  const buckets = new Array(16).fill(0);
  for (const s of samples) {
    const xi = Math.floor(((s.x ?? (s.effort01 ?? 0) * 400) % 400) / 100);
    const yi = Math.floor(((s.y ?? (s.sensorEnergy ?? 0) * 400) % 400) / 100);
    const ti = Math.floor((s.tMs % 1000) / 250);
    const idx = (xi + yi * 2 + ti * 4) % 16;
    buckets[idx] += 1;
  }
  return buckets.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function meanEffortByRegion(samples: CognitiveSample[]): Record<string, number> {
  const buckets: Record<string, { sum: number; n: number }> = {};
  for (const s of samples) {
    if (s.type !== 'effort' || s.effort01 == null) continue;
    const region = s.module ?? 'unknown';
    if (!buckets[region]) buckets[region] = { sum: 0, n: 0 };
    buckets[region].sum += s.effort01;
    buckets[region].n += 1;
  }
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(buckets)) {
    out[k] = v.n > 0 ? v.sum / v.n : 0;
  }
  return out;
}
