import { withTransaction, pool, type DbClient } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit } from './audit.js';
import {
  computeProfileCommitment,
  darkTriadClassification,
} from '../scoring/dirtyDozen.js';
import {
  buildDiscoveryEnrichment,
  withDiscoveryEnrichment,
} from '../scoring/discoveryEnrichment.js';
import { interpretGad7, interpretPhq9 } from '../scoring/moodScreens.js';

const OCEAN_LABELS: Record<string, string> = {
  extraversion: 'Extraversion',
  agreeableness: 'Agreeableness',
  conscientiousness: 'Conscientiousness',
  emotional_stability: 'Emotional Stability',
  intellect: 'Intellect / Openness',
};

const DD_LABELS: Record<string, string> = {
  machiavellianism: 'Strategic Style',
  narcissism: 'Recognition Drive',
  psychopathy: 'Impulse Restraint',
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/** Approximate normal CDF → percentile 1–99. */
function percentileFromNorm(value: number, mean: number, std: number): number {
  const sigma = std > 0.01 ? std : 1;
  const z = (value - mean) / sigma;
  // Abramowitz & Stegun approximation
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p =
    d *
    t *
    (0.3193815 +
      t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  const cdf = z > 0 ? 1 - p : p;
  return clamp(Math.round(cdf * 100), 1, 99);
}

function bandFromPercentile(p: number): string {
  if (p >= 85) return 'notably high vs peers';
  if (p >= 65) return 'above typical';
  if (p <= 15) return 'notably low vs peers';
  if (p <= 35) return 'below typical';
  return 'near typical';
}

async function loadNorm(
  client: DbClient,
  scaleKey: string,
): Promise<{ mean: number; std: number }> {
  const row = await client.query(
    `SELECT mean_score, std_score FROM personality_norm_stats WHERE scale_key = $1`,
    [scaleKey],
  );
  if (!row.rows[0]) return { mean: 3, std: 0.7 };
  return {
    mean: Number(row.rows[0].mean_score),
    std: Number(row.rows[0].std_score),
  };
}

async function bumpNorm(client: DbClient, scaleKey: string, value: number) {
  const existing = await client.query(
    `SELECT sample_count, mean_score, std_score FROM personality_norm_stats WHERE scale_key = $1`,
    [scaleKey],
  );
  if (!existing.rows[0]) {
    await client.query(
      `INSERT INTO personality_norm_stats (scale_key, sample_count, mean_score, std_score)
       VALUES ($1, 1, $2, 0.7)
       ON CONFLICT (scale_key) DO NOTHING`,
      [scaleKey, value],
    );
    return;
  }
  const n = Number(existing.rows[0].sample_count);
  const mean = Number(existing.rows[0].mean_score);
  const std = Number(existing.rows[0].std_score);
  if (!Number.isFinite(value) || !Number.isFinite(mean) || !Number.isFinite(std)) {
    return;
  }
  const nextN = n + 1;
  const nextMean = mean + (value - mean) / nextN;
  const priorVar = std * std;
  const nextVar =
    n <= 0
      ? priorVar
      : ((n - 1) * priorVar + (value - mean) * (value - nextMean)) / Math.max(1, n);
  const nextStd = Math.sqrt(Math.max(0.05, nextVar));
  if (!Number.isFinite(nextMean) || !Number.isFinite(nextStd)) return;
  await client.query(
    `UPDATE personality_norm_stats
     SET sample_count = $2, mean_score = $3, std_score = $4, updated_at = now()
     WHERE scale_key = $1`,
    [scaleKey, nextN, nextMean, nextStd],
  );
}

function buildArchetype(input: {
  ocean: Array<{ scaleKey: string; percentile: number }>;
  assertivenessPercentile: number;
  dark: Array<{ scaleKey: string; percentile: number; classification: string }>;
}) {
  const sorted = [...input.ocean].sort((a, b) => b.percentile - a.percentile);
  const top = sorted[0];
  const low = sorted[sorted.length - 1];
  const nameParts: string[] = [];
  if (input.assertivenessPercentile >= 70) nameParts.push('Decisive');
  else if (input.assertivenessPercentile <= 30) nameParts.push('Measured');
  else nameParts.push('Steady');

  if (top?.scaleKey === 'intellect') nameParts.push('Explorer');
  else if (top?.scaleKey === 'conscientiousness') nameParts.push('Builder');
  else if (top?.scaleKey === 'extraversion') nameParts.push('Connector');
  else if (top?.scaleKey === 'agreeableness') nameParts.push('Ally');
  else nameParts.push('Stabilizer');

  const strategy = input.dark.find((d) => d.scaleKey === 'machiavellianism');
  if (strategy && strategy.percentile >= 70) {
    nameParts.push('Strategist');
  }

  const superpowers: string[] = [];
  const blindSpots: string[] = [];
  const oceanPlain: Record<string, string> = {
    extraversion: 'outgoing energy',
    agreeableness: 'warmth & cooperation',
    conscientiousness: 'follow-through',
    emotional_stability: 'calm under pressure',
    intellect: 'curiosity & ideas',
  };
  for (const o of input.ocean) {
    const plain = oceanPlain[o.scaleKey] ?? OCEAN_LABELS[o.scaleKey] ?? o.scaleKey;
    const tech = OCEAN_LABELS[o.scaleKey] ?? o.scaleKey;
    if (o.percentile >= 70) {
      superpowers.push(`Natural strength in ${plain} (${tech})`);
    }
    if (o.percentile <= 30) {
      blindSpots.push(`Lower ${plain} vs peers — may need extra structure (${tech})`);
    }
  }
  if (input.assertivenessPercentile >= 70) {
    superpowers.push('Makes clear calls when the games get noisy (decisiveness under load)');
  } else if (input.assertivenessPercentile <= 30) {
    blindSpots.push('Takes more time to commit under load — pacing cues help');
  }
  if (superpowers.length === 0) {
    superpowers.push('Balanced mix — no single trait dominates');
  }
  if (blindSpots.length === 0) {
    blindSpots.push('No extreme watch-outs vs this study group');
  }

  const topPlain = top
    ? oceanPlain[top.scaleKey] ?? OCEAN_LABELS[top.scaleKey] ?? top.scaleKey
    : 'a balanced mix';
  const lowPlain = low
    ? oceanPlain[low.scaleKey] ?? OCEAN_LABELS[low.scaleKey] ?? low.scaleKey
    : null;

  return {
    name: nameParts.slice(0, 3).join(' '),
    summary: `In everyday terms, you lean toward ${topPlain}${
      lowPlain ? `, with relatively less ${lowPlain}` : ''
    }. Compared with others in this study, that mix is your signature — not a fixed personality cage.`,
    superpowers: superpowers.slice(0, 4),
    blindSpots: blindSpots.slice(0, 3),
  };
}

export type LikertLatencyInput = {
  itemId: string;
  instrumentCode: string;
  latencyMs: number;
  changeCount?: number;
};

export async function finalizePersonalityProfile(
  participantId: string,
  input: {
    cognitiveSessionId: string;
    ipipSessionId: string;
    dirtyDozenSessionId: string;
    phqSessionId: string;
    gadSessionId: string;
    likertLatencies: LikertLatencyInput[];
  },
) {
  // Fast path outside a long transaction — avoids Render timeouts on retries.
  const existing = await pool.query(
    `SELECT id FROM personality_profiles WHERE participant_id = $1`,
    [participantId],
  );
  if (existing.rows[0]) {
    return getParticipantMindMap(participantId);
  }

  return withTransaction(async (client) => {
    const again = await client.query(
      `SELECT id FROM personality_profiles WHERE participant_id = $1`,
      [participantId],
    );
    if (again.rows[0]) {
      return getMindMapPublic(client, participantId);
    }

    for (const sid of [
      input.cognitiveSessionId,
      input.ipipSessionId,
      input.dirtyDozenSessionId,
      input.phqSessionId,
      input.gadSessionId,
    ]) {
      const s = await client.query(
        `SELECT ss.id, ss.status, iv.instrument_code
         FROM survey_sessions ss
         JOIN instrument_versions iv ON iv.id = ss.instrument_version_id
         WHERE ss.id = $1 AND ss.participant_id = $2`,
        [sid, participantId],
      );
      if (!s.rows[0]) throw notFound('session_not_found');
      if (s.rows[0].status !== 'scored') {
        throw badRequest('session_not_scored', { sessionId: sid });
      }
    }

    const requireInstrument = async (sessionId: string, code: string) => {
      const check = await client.query(
        `SELECT iv.instrument_code FROM survey_sessions ss
         JOIN instrument_versions iv ON iv.id = ss.instrument_version_id WHERE ss.id = $1`,
        [sessionId],
      );
      if (check.rows[0]?.instrument_code !== code) {
        throw badRequest(`${code}_session_required`);
      }
    };
    await requireInstrument(input.cognitiveSessionId, 'cortical_battery_v1');
    await requireInstrument(input.ipipSessionId, 'ipip_bfm_50');
    await requireInstrument(input.dirtyDozenSessionId, 'dirty_dozen_v1');
    await requireInstrument(input.phqSessionId, 'phq9_v1');
    await requireInstrument(input.gadSessionId, 'gad7_v1');

    const oceanScores = await client.query(
      `SELECT scale_key, mean_score, raw_sum, item_count
       FROM scale_scores WHERE session_id = $1`,
      [input.ipipSessionId],
    );
    const ddScores = await client.query(
      `SELECT scale_key, mean_score, raw_sum, item_count
       FROM scale_scores WHERE session_id = $1`,
      [input.dirtyDozenSessionId],
    );
    const phqScore = await client.query(
      `SELECT scale_key, mean_score, raw_sum, item_count
       FROM scale_scores WHERE session_id = $1 AND scale_key = 'phq9_total'`,
      [input.phqSessionId],
    );
    const gadScore = await client.query(
      `SELECT scale_key, mean_score, raw_sum, item_count
       FROM scale_scores WHERE session_id = $1 AND scale_key = 'gad7_total'`,
      [input.gadSessionId],
    );
    const phqItem9 = await client.query(
      `SELECT value FROM responses WHERE session_id = $1 AND item_id = 'phq_09'`,
      [input.phqSessionId],
    );
    if (!phqScore.rows[0] || !gadScore.rows[0]) {
      throw badRequest('mood_scores_missing');
    }

    const cortical = await client.query(
      `SELECT assertiveness_bps, sample_count, block_count, region_effort, fingerprint
       FROM cognitive_session_summaries WHERE session_id = $1`,
      [input.cognitiveSessionId],
    );
    if (!cortical.rows[0]) throw badRequest('cognitive_summary_missing');

    const latencies = input.likertLatencies.filter(
      (l) => Number.isFinite(l.latencyMs) && l.latencyMs >= 0 && l.latencyMs < 120_000,
    );
    const latencyValues = latencies.map((l) => l.latencyMs).sort((a, b) => a - b);
    const meanLatency =
      latencyValues.length > 0
        ? latencyValues.reduce((a, b) => a + b, 0) / latencyValues.length
        : 900;
    const medianLatency =
      latencyValues.length > 0
        ? latencyValues[Math.floor(latencyValues.length / 2)]
        : 900;
    const changeCount = latencies.reduce((a, l) => a + (l.changeCount ?? 0), 0);

    const ocean: Array<{
      scaleKey: string;
      label: string;
      meanScore: number;
      rawSum: number;
      percentile: number;
      band: string;
    }> = [];
    for (const row of oceanScores.rows) {
      const norm = await loadNorm(client, row.scale_key);
      const percentile = percentileFromNorm(Number(row.mean_score), norm.mean, norm.std);
      ocean.push({
        scaleKey: row.scale_key,
        label: OCEAN_LABELS[row.scale_key] ?? row.scale_key,
        meanScore: Number(row.mean_score),
        rawSum: Number(row.raw_sum),
        percentile,
        band: bandFromPercentile(percentile),
      });
      await bumpNorm(client, row.scale_key, Number(row.mean_score));
    }

    const darkTriad: Array<{
      scaleKey: string;
      label: string;
      meanScore: number;
      rawSum: number;
      percentile: number;
      classification: string;
      framing: string;
    }> = [];
    for (const row of ddScores.rows) {
      const norm = await loadNorm(client, row.scale_key);
      const percentile = percentileFromNorm(Number(row.mean_score), norm.mean, norm.std);
      const cls = darkTriadClassification(row.scale_key, percentile);
      darkTriad.push({
        scaleKey: row.scale_key,
        label: DD_LABELS[row.scale_key] ?? row.scale_key,
        meanScore: Number(row.mean_score),
        rawSum: Number(row.raw_sum),
        percentile,
        classification: cls.classification,
        framing: cls.framing,
      });
      await bumpNorm(client, row.scale_key, Number(row.mean_score));
    }

    const phqRaw = Number(phqScore.rows[0].raw_sum);
    const gadRaw = Number(gadScore.rows[0].raw_sum);
    const phqFlag = interpretPhq9(phqRaw, Number(phqItem9.rows[0]?.value ?? 0));
    const gadFlag = interpretGad7(gadRaw);
    const phqNorm = await loadNorm(client, 'phq9_total');
    const gadNorm = await loadNorm(client, 'gad7_total');
    const phqPercentile = percentileFromNorm(phqRaw, phqNorm.mean, phqNorm.std);
    const gadPercentile = percentileFromNorm(gadRaw, gadNorm.mean, gadNorm.std);
    await bumpNorm(client, 'phq9_total', phqRaw);
    await bumpNorm(client, 'gad7_total', gadRaw);

    const moodPhenotyping = {
      phq9: { ...phqFlag, percentile: phqPercentile },
      gad7: { ...gadFlag, percentile: gadPercentile },
      presentationRule:
        'These are short public mood checklists (low-mood / worry). They flag possible patterns only — not a doctor’s diagnosis.',
    };

    const assertivenessBps = Number(cortical.rows[0].assertiveness_bps);
    const assertNorm = await loadNorm(client, 'assertiveness_bps');
    const assertivenessPercentile = percentileFromNorm(
      assertivenessBps,
      assertNorm.mean,
      assertNorm.std,
    );
    await bumpNorm(client, 'assertiveness_bps', assertivenessBps);

    const tempoNorm = await loadNorm(client, 'decision_tempo_ms');
    const decisionTempoPercentile = percentileFromNorm(
      medianLatency,
      tempoNorm.mean,
      tempoNorm.std,
    );
    await bumpNorm(client, 'decision_tempo_ms', medianLatency);

    const corticalPhenotyping = {
      assertivenessBps,
      assertivenessPercentile,
      assertivenessBand: bandFromPercentile(assertivenessPercentile),
      sampleCount: Number(cortical.rows[0].sample_count),
      blockCount: Number(cortical.rows[0].block_count),
      regionEffort: cortical.rows[0].region_effort,
    };

    const likertPhenotyping = {
      medianLatencyMs: Math.round(medianLatency),
      meanLatencyMs: Math.round(meanLatency),
      itemCount: latencies.length,
      changeCount,
      decisionTempoPercentile,
      decisionTempoBand: bandFromPercentile(decisionTempoPercentile),
    };

    const archetype = buildArchetype({
      ocean,
      assertivenessPercentile,
      dark: darkTriad,
    });

    const enrichment = buildDiscoveryEnrichment({
      ocean,
      darkTriad,
      cortical: corticalPhenotyping,
      likert: likertPhenotyping,
    });

    const discoveryMap = {
      title: 'Your Mind Map',
      tagline:
        'A plain-language snapshot of your patterns — research terms kept for transparency.',
      ocean,
      darkTriad,
      cortical: corticalPhenotyping,
      likert: likertPhenotyping,
      mood: moodPhenotyping,
      possibleMoodFlags: [phqFlag, gadFlag],
      archetype,
      ...enrichment,
      disclaimer:
        'Discovery framing only. Not a clinical diagnosis, prognosis, or treatment recommendation. Mood screens show possible patterns only — never confirmation of depression, anxiety, or any disorder. Constructive Dark Triad labels are workplace-style pattern names, not pathology. ' +
        enrichment.enrichmentNote,
    };

    const commitmentPayload = {
      ocean: ocean.map((o) => ({ k: o.scaleKey, m: o.meanScore, p: o.percentile })),
      dark: darkTriad.map((d) => ({ k: d.scaleKey, m: d.meanScore, p: d.percentile })),
      cortical: {
        a: assertivenessBps,
        e: cortical.rows[0].region_effort,
        f: cortical.rows[0].fingerprint,
      },
      likert: { med: medianLatency, mean: meanLatency, ch: changeCount },
      mood: { phq: phqRaw, gad: gadRaw },
      v: 2,
    };
    const profileCommitment = computeProfileCommitment(commitmentPayload);

    await client.query(
      `INSERT INTO personality_profiles (
         participant_id, cognitive_session_id, ipip_session_id, dirty_dozen_session_id,
         phq_session_id, gad_session_id,
         ocean, dark_triad, cortical_phenotyping, likert_phenotyping, mood_phenotyping, percentiles,
         behavioral_archetype, discovery_map, profile_commitment
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
         $13::jsonb, $14::jsonb, $15
       )`,
      [
        participantId,
        input.cognitiveSessionId,
        input.ipipSessionId,
        input.dirtyDozenSessionId,
        input.phqSessionId,
        input.gadSessionId,
        JSON.stringify(Object.fromEntries(ocean.map((o) => [o.scaleKey, o]))),
        JSON.stringify(Object.fromEntries(darkTriad.map((d) => [d.scaleKey, d]))),
        JSON.stringify(corticalPhenotyping),
        JSON.stringify(likertPhenotyping),
        JSON.stringify(moodPhenotyping),
        JSON.stringify({
          ocean: Object.fromEntries(ocean.map((o) => [o.scaleKey, o.percentile])),
          darkTriad: Object.fromEntries(darkTriad.map((d) => [d.scaleKey, d.percentile])),
          assertiveness: assertivenessPercentile,
          decisionTempo: decisionTempoPercentile,
          phq9: phqPercentile,
          gad7: gadPercentile,
        }),
        JSON.stringify(archetype),
        JSON.stringify(discoveryMap),
        profileCommitment,
      ],
    );

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participantId,
      eventType: 'personality.profile_finalized',
      entityType: 'participant',
      entityId: participantId,
      payload: {
        hasCommitment: true,
        commitmentPrefix: profileCommitment.slice(0, 18),
        moodElevatedPossible: phqFlag.elevatedPossible || gadFlag.elevatedPossible,
      },
    });

    return {
      ready: true,
      discoveryMap,
    };
  });
}

async function getMindMapPublic(client: DbClient, participantId: string) {
  const row = await client.query(
    `SELECT discovery_map FROM personality_profiles WHERE participant_id = $1`,
    [participantId],
  );
  if (!row.rows[0]) throw notFound('mind_map_not_found');
  return {
    ready: true,
    discoveryMap: withDiscoveryEnrichment(
      row.rows[0].discovery_map as Record<string, unknown>,
    ),
  };
}

export async function getParticipantMindMap(participantId: string) {
  const row = await pool.query(
    `SELECT discovery_map FROM personality_profiles WHERE participant_id = $1`,
    [participantId],
  );
  if (!row.rows[0]) throw notFound('mind_map_not_found');
  // Never expose profile_commitment to clients
  return {
    ready: true,
    discoveryMap: withDiscoveryEnrichment(
      row.rows[0].discovery_map as Record<string, unknown>,
    ),
  };
}

/** Exported for unit tests / internal tooling only — not routed. */
export { computeProfileCommitment as hashCommitmentForTests };
