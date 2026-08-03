import { pool, withTransaction } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { writeAudit } from './audit.js';
import {
  computeAssertivenessBps,
  meanEffortByRegion,
  sketchFingerprint,
  type CognitiveSample,
} from '../scoring/assertiveness.js';

type Participant = { id: string };

async function requireOwnedSession(participantId: string, sessionId: string) {
  const session = await pool.query(
    `SELECT id, status, participant_id
     FROM survey_sessions
     WHERE id = $1 AND participant_id = $2`,
    [sessionId, participantId],
  );
  if (!session.rows[0]) throw notFound('session_not_found');
  if (session.rows[0].status !== 'in_progress') {
    throw badRequest('session_not_in_progress', { status: session.rows[0].status });
  }
  return session.rows[0];
}

export async function ingestCognitiveSamples(
  participant: Participant,
  sessionId: string,
  input: {
    clientBatchId: string;
    module: string;
    region: string;
    blockId?: string;
    blockIndex?: number;
    samples: CognitiveSample[];
  },
) {
  await requireOwnedSession(participant.id, sessionId);

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO cognitive_sample_batches (
         session_id, client_batch_id, module, region, block_id, block_index, sample_count, samples
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (session_id, client_batch_id) DO NOTHING
       RETURNING id, sample_count`,
      [
        sessionId,
        input.clientBatchId,
        input.module,
        input.region,
        input.blockId ?? null,
        input.blockIndex ?? null,
        input.samples.length,
        JSON.stringify(input.samples),
      ],
    );

    if (!inserted.rows[0]) {
      return { accepted: 0, duplicate: true, sampleCount: input.samples.length };
    }

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participant.id,
      eventType: 'cognitive.samples_ingested',
      entityType: 'survey_session',
      entityId: sessionId,
      payload: {
        clientBatchId: input.clientBatchId,
        module: input.module,
        region: input.region,
        sampleCount: input.samples.length,
      },
    });

    return {
      accepted: input.samples.length,
      duplicate: false,
      sampleCount: input.samples.length,
    };
  });
}

export async function completeCognitiveSession(
  participant: Participant,
  sessionId: string,
  input: { blockCount: number },
) {
  await requireOwnedSession(participant.id, sessionId);

  return withTransaction(async (client) => {
    const batches = await client.query(
      `SELECT samples FROM cognitive_sample_batches WHERE session_id = $1 ORDER BY created_at ASC`,
      [sessionId],
    );
    const samples: CognitiveSample[] = [];
    for (const row of batches.rows) {
      const chunk = row.samples as CognitiveSample[];
      if (Array.isArray(chunk)) samples.push(...chunk);
    }

    const assertivenessBps = computeAssertivenessBps(samples);
    const regionEffort = meanEffortByRegion(samples);
    const fingerprint = sketchFingerprint(samples);
    const graded = samples.filter(
      (s) =>
        s.type === 'answer' &&
        (typeof s.fidelity01 === 'number' || typeof s.hitRate === 'number'),
    );
    const meanResponseFidelity =
      graded.length > 0
        ? graded.reduce((a, s) => a + (s.fidelity01 ?? s.hitRate ?? 0), 0) /
          graded.length
        : null;

    try {
      await client.query(
        `INSERT INTO cognitive_session_summaries (
           session_id, assertiveness_bps, sample_count, block_count, region_effort, fingerprint,
           mean_response_fidelity
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (session_id) DO UPDATE SET
           assertiveness_bps = EXCLUDED.assertiveness_bps,
           sample_count = EXCLUDED.sample_count,
           block_count = EXCLUDED.block_count,
           region_effort = EXCLUDED.region_effort,
           fingerprint = EXCLUDED.fingerprint,
           mean_response_fidelity = EXCLUDED.mean_response_fidelity,
           completed_at = now()`,
        [
          sessionId,
          assertivenessBps,
          samples.length,
          input.blockCount,
          JSON.stringify(regionEffort),
          fingerprint,
          meanResponseFidelity,
        ],
      );
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code !== '42703') throw err;
      // DB without migration 008 — write without mean_response_fidelity
      await client.query(
        `INSERT INTO cognitive_session_summaries (
           session_id, assertiveness_bps, sample_count, block_count, region_effort, fingerprint
         ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         ON CONFLICT (session_id) DO UPDATE SET
           assertiveness_bps = EXCLUDED.assertiveness_bps,
           sample_count = EXCLUDED.sample_count,
           block_count = EXCLUDED.block_count,
           region_effort = EXCLUDED.region_effort,
           fingerprint = EXCLUDED.fingerprint,
           completed_at = now()`,
        [
          sessionId,
          assertivenessBps,
          samples.length,
          input.blockCount,
          JSON.stringify(regionEffort),
          fingerprint,
        ],
      );
    }

    await client.query(
      `UPDATE survey_sessions
       SET status = 'scored', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [sessionId],
    );

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participant.id,
      eventType: 'cognitive.session_completed',
      entityType: 'survey_session',
      entityId: sessionId,
      payload: {
        assertivenessBps,
        sampleCount: samples.length,
        blockCount: input.blockCount,
      },
    });

    return {
      sessionId,
      status: 'scored',
      receipt: {
        message:
          'Cognitive battery registered for research storage. No clinical interpretation is returned.',
        scored: true,
        sampleCount: samples.length,
      },
    };
  });
}
