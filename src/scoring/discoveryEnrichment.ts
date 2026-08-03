/**
 * Discovery enrichment — derived presentation layers only.
 * Does NOT replace IPIP / Dirty Dozen / cortical / Likert raw metrics.
 * Never clinical: no depression/anxiety diagnosis, no IQ claims.
 */

export type OceanLike = {
  scaleKey: string;
  label: string;
  meanScore: number;
  percentile: number;
  band: string;
};

export type DarkLike = {
  scaleKey: string;
  label: string;
  meanScore: number;
  percentile: number;
  classification: string;
  framing: string;
};

export type CorticalLike = {
  assertivenessBps: number;
  assertivenessPercentile: number;
  assertivenessBand: string;
  sampleCount: number;
  blockCount: number;
  regionEffort: Record<string, number> | unknown;
};

export type LikertLike = {
  medianLatencyMs: number;
  meanLatencyMs: number;
  itemCount: number;
  changeCount: number;
  decisionTempoPercentile: number;
  decisionTempoBand: string;
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function pct(ocean: OceanLike[], key: string, fallback = 50): number {
  return ocean.find((o) => o.scaleKey === key)?.percentile ?? fallback;
}

function darkPct(dark: DarkLike[], key: string, fallback = 50): number {
  return dark.find((d) => d.scaleKey === key)?.percentile ?? fallback;
}

function regionEffort01(
  regionEffort: Record<string, number> | unknown,
  key: string,
): number {
  if (!regionEffort || typeof regionEffort !== 'object') return 0.5;
  const v = (regionEffort as Record<string, number>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0.5;
  if (v <= 1.5) return clamp(v, 0, 1);
  return clamp(v / 10, 0, 1);
}

function bandFromPercentile(p: number): string {
  if (p >= 85) return 'notably high vs peers';
  if (p >= 65) return 'above typical';
  if (p <= 15) return 'notably low vs peers';
  if (p <= 35) return 'below typical';
  return 'near typical';
}

function roundBlend(...parts: Array<{ value: number; weight: number }>): number {
  const w = parts.reduce((a, p) => a + p.weight, 0) || 1;
  const sum = parts.reduce((a, p) => a + p.value * p.weight, 0);
  return clamp(Math.round(sum / w), 1, 99);
}

export type IntelligencePattern = {
  key: 'emotional' | 'motor' | 'logical';
  label: string;
  /** Discovery index 1–99 vs study peers — not a clinical IQ / EQ score. */
  index: number;
  band: string;
  summary: string;
  sources: string[];
};

export type AffectiveTone = {
  key: string;
  label: string;
  level: 'lower' | 'typical' | 'higher';
  summary: string;
};

export type WorkFit = {
  roleFamily: string;
  fit: 'strong' | 'good' | 'stretch';
  why: string;
  traitsUsed: string[];
};

export type DiscoveryEnrichment = {
  intelligencePatterns: IntelligencePattern[];
  affectiveTone: AffectiveTone[];
  workFits: WorkFit[];
  enrichmentNote: string;
};

export function buildDiscoveryEnrichment(input: {
  ocean: OceanLike[];
  darkTriad: DarkLike[];
  cortical: CorticalLike;
  likert: LikertLike;
}): DiscoveryEnrichment {
  const e = pct(input.ocean, 'extraversion');
  const a = pct(input.ocean, 'agreeableness');
  const c = pct(input.ocean, 'conscientiousness');
  const es = pct(input.ocean, 'emotional_stability');
  const o = pct(input.ocean, 'intellect');
  const strategy = darkPct(input.darkTriad, 'machiavellianism');
  const recognition = darkPct(input.darkTriad, 'narcissism');
  const impulse = darkPct(input.darkTriad, 'psychopathy');

  const limbico = regionEffort01(input.cortical.regionEffort, 'limbico');
  const perceptivo = regionEffort01(input.cortical.regionEffort, 'perceptivo');
  const mnemico = regionEffort01(input.cortical.regionEffort, 'mnemico');
  const heuristico = regionEffort01(input.cortical.regionEffort, 'heuristico');

  const assertP = input.cortical.assertivenessPercentile;
  const tempoAsSpeed = clamp(100 - input.likert.decisionTempoPercentile + 50, 1, 99);

  const emotionalIndex = roundBlend(
    { value: a, weight: 0.35 },
    { value: es, weight: 0.35 },
    { value: e, weight: 0.15 },
    { value: clamp(Math.round(limbico * 100), 1, 99), weight: 0.15 },
  );

  const motorIndex = roundBlend(
    { value: assertP, weight: 0.35 },
    { value: tempoAsSpeed, weight: 0.2 },
    { value: clamp(Math.round(perceptivo * 100), 1, 99), weight: 0.25 },
    { value: clamp(Math.round(mnemico * 100), 1, 99), weight: 0.2 },
  );

  const logicalIndex = roundBlend(
    { value: o, weight: 0.35 },
    { value: c, weight: 0.25 },
    { value: clamp(Math.round(heuristico * 100), 1, 99), weight: 0.25 },
    { value: assertP, weight: 0.15 },
  );

  const intelligencePatterns: IntelligencePattern[] = [
    {
      key: 'emotional',
      label: 'People & feelings radar (emotional attunement)',
      index: emotionalIndex,
      band: bandFromPercentile(emotionalIndex),
      summary:
        emotionalIndex >= 65
          ? 'You tend to pick up social tone and stay steadier with people-load than many peers.'
          : emotionalIndex <= 35
            ? 'You may read the room more cautiously — clarity often comes from structure more than vibes.'
            : 'A middle-of-the-road people radar vs this study group.',
      sources: [
        'Warmth & cooperation',
        'Calm under pressure',
        'Outgoing energy',
        'Gut / approach–avoid games',
      ],
    },
    {
      key: 'motor',
      label: 'Hands & timing (sensorimotor)',
      index: motorIndex,
      band: bandFromPercentile(motorIndex),
      summary:
        motorIndex >= 65
          ? 'Your touch and timing stay snappy when the games get busy — great for fast ops work.'
          : motorIndex <= 35
            ? 'You move more carefully under load — accuracy over rush.'
            : 'Typical hands-and-timing feel vs peers in this battery.',
      sources: [
        'Snap decisions under load',
        'Questionnaire pace',
        'Attention games',
        'Memory games',
      ],
    },
    {
      key: 'logical',
      label: 'Puzzle & plan brain (logical–executive)',
      index: logicalIndex,
      band: bandFromPercentile(logicalIndex),
      summary:
        logicalIndex >= 65
          ? 'You hold up well when patterns and switch-cost puzzles stack up.'
          : logicalIndex <= 35
            ? 'Open puzzle pressure may feel harder — guided frameworks help.'
            : 'A balanced puzzle-and-plan style vs this cohort.',
      sources: [
        'Curiosity & ideas',
        'Follow-through',
        'Problem-solving games',
        'Snap decisions under load',
      ],
    },
  ];

  const affectiveTone: AffectiveTone[] = [];
  if (es <= 30) {
    affectiveTone.push({
      key: 'stress_sensitivity',
      label: 'Feels stress sooner',
      level: 'higher',
      summary:
        'Calm-under-pressure sits lower vs peers — you may notice stress earlier. That is a vibe pattern, not a depression or anxiety diagnosis.',
    });
  } else if (es >= 70) {
    affectiveTone.push({
      key: 'stress_resilience',
      label: 'Stays steadier under heat',
      level: 'higher',
      summary:
        'Calm-under-pressure sits higher vs peers — you often keep a steadier tone when things spike. Still not a clinical mood score.',
    });
  } else {
    affectiveTone.push({
      key: 'stress_balance',
      label: 'Normal stress weather',
      level: 'typical',
      summary:
        'Calm-under-pressure is about average here — ordinary ups and downs, not a medical screen result.',
    });
  }

  if (impulse >= 70 && es <= 40) {
    affectiveTone.push({
      key: 'drive_under_pressure',
      label: 'High drive, softer brakes',
      level: 'higher',
      summary:
        'Strong push plus lower calm can feel turbo — short pause habits help channel it.',
    });
  } else if (impulse <= 30) {
    affectiveTone.push({
      key: 'impulse_control',
      label: 'Strong self-brakes',
      level: 'higher',
      summary:
        'You hold back more than many peers — protective in conflict, sometimes too cautious when speed matters.',
    });
  }

  return {
    intelligencePatterns,
    affectiveTone,
    workFits: buildWorkFits({
      e,
      a,
      c,
      es,
      o,
      strategy,
      recognition,
      assertP,
      emotionalIndex,
      motorIndex,
      logicalIndex,
    }),
    enrichmentNote:
      'People / hands / puzzle layers are simple composites from your session — not IQ, EQ, or medical scores. Career ideas are for curiosity, not hiring decisions.',
  };
}

function buildWorkFits(t: {
  e: number;
  a: number;
  c: number;
  es: number;
  o: number;
  strategy: number;
  recognition: number;
  assertP: number;
  emotionalIndex: number;
  motorIndex: number;
  logicalIndex: number;
}): WorkFit[] {
  const candidates: Array<WorkFit & { score: number }> = [];

  const push = (
    roleFamily: string,
    score: number,
    why: string,
    traitsUsed: string[],
  ) => {
    if (score < 55) return;
    const fit: WorkFit['fit'] = score >= 78 ? 'strong' : score >= 66 ? 'good' : 'stretch';
    candidates.push({ roleFamily, fit, why, traitsUsed, score });
  };

  push(
    'People leadership & facilitation',
    roundBlend(
      { value: t.e, weight: 0.35 },
      { value: t.a, weight: 0.3 },
      { value: t.emotionalIndex, weight: 0.2 },
      { value: t.recognition, weight: 0.15 },
    ),
    'Social energy + attunement pattern fits roles that rally teams and hold group tone.',
    ['Extraversion', 'Agreeableness', 'Emotional attunement'],
  );

  push(
    'Operations / quality / delivery',
    roundBlend(
      { value: t.c, weight: 0.45 },
      { value: t.es, weight: 0.2 },
      { value: t.assertP, weight: 0.2 },
      { value: t.logicalIndex, weight: 0.15 },
    ),
    'Conscientiousness and steady execution map well to shipping reliable systems.',
    ['Conscientiousness', 'Emotional Stability', 'Decisiveness'],
  );

  push(
    'Research / product discovery / strategy',
    roundBlend(
      { value: t.o, weight: 0.4 },
      { value: t.logicalIndex, weight: 0.3 },
      { value: t.strategy, weight: 0.2 },
      { value: t.c, weight: 0.1 },
    ),
    'Openness + executive pattern suits exploration, framing problems, and long-horizon bets.',
    ['Intellect', 'Logical–executive', 'Strategic style'],
  );

  push(
    'Negotiation / BD / competitive sales',
    roundBlend(
      { value: t.strategy, weight: 0.35 },
      { value: t.e, weight: 0.25 },
      { value: t.assertP, weight: 0.25 },
      { value: t.recognition, weight: 0.15 },
    ),
    'Strategic style with social drive fits high-stakes persuasion environments.',
    ['Strategic style', 'Extraversion', 'Decisiveness'],
  );

  push(
    'Hands-on maker / ops floor / real-time control',
    roundBlend(
      { value: t.motorIndex, weight: 0.4 },
      { value: t.assertP, weight: 0.3 },
      { value: t.c, weight: 0.2 },
      { value: t.es, weight: 0.1 },
    ),
    'Sensorimotor timing under load supports roles that need fast, accurate physical decisions.',
    ['Sensorimotor timing', 'Decisiveness', 'Conscientiousness'],
  );

  push(
    'Care / support / trust-heavy roles',
    roundBlend(
      { value: t.a, weight: 0.45 },
      { value: t.emotionalIndex, weight: 0.35 },
      { value: t.es, weight: 0.2 },
    ),
    'Higher attunement patterns fit roles where trust and calm matter.',
    ['Agreeableness', 'Emotional attunement', 'Emotional Stability'],
  );

  push(
    'Creative / brand / narrative craft',
    roundBlend(
      { value: t.o, weight: 0.4 },
      { value: t.e, weight: 0.25 },
      { value: t.recognition, weight: 0.2 },
      { value: t.emotionalIndex, weight: 0.15 },
    ),
    'Openness with social/recognition drive fits storytelling and audience-facing craft.',
    ['Intellect', 'Extraversion', 'Recognition drive'],
  );

  return candidates
    .sort((x, y) => y.score - x.score)
    .slice(0, 5)
    .map(({ roleFamily, fit, why, traitsUsed }) => ({
      roleFamily,
      fit,
      why,
      traitsUsed,
    }));
}

/** Attach enrichment to a stored discovery_map without dropping base metrics. */
export function withDiscoveryEnrichment(map: Record<string, unknown>) {
  const ocean = Array.isArray(map.ocean) ? (map.ocean as OceanLike[]) : [];
  const darkTriad = Array.isArray(map.darkTriad) ? (map.darkTriad as DarkLike[]) : [];
  const cortical = map.cortical as CorticalLike | undefined;
  const likert = map.likert as LikertLike | undefined;
  if (!cortical || !likert || ocean.length === 0) {
    return map;
  }
  const enrichment = buildDiscoveryEnrichment({
    ocean,
    darkTriad,
    cortical,
    likert,
  });
  return {
    ...map,
    ...enrichment,
    disclaimer:
      typeof map.disclaimer === 'string'
        ? `${map.disclaimer} ${enrichment.enrichmentNote}`
        : enrichment.enrichmentNote,
  };
}
