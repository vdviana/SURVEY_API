import { pool, withTransaction, type DbClient } from '../db.js';
import {
  hashToken,
  newAnonymousCode,
  newInstallationToken,
} from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { writeAudit } from './audit.js';
import { getActiveStudyBundle, getEnabledInstrument } from './study.js';
import {
  EXPECTED_ITEM_COUNT,
  SCORER_ID,
  SCORER_VERSION,
  scoreIpip50,
} from '../scoring/ipip50.js';

export async function enrollParticipant(input: {
  studyCode: string;
  locale: string;
  clientAppVersion: string;
}) {
  if (input.locale === 'pt-BR') {
    throw badRequest('locale_not_enabled', {
      locale: 'pt-BR',
      message:
        'Brazilian Portuguese collection is disabled until validated item wording is supplied.',
    });
  }

  const bundle = await getActiveStudyBundle(input.studyCode);
  const token = newInstallationToken();
  const anonymousCode = newAnonymousCode();

  return withTransaction(async (client) => {
    const inserted = await client.query(
      `INSERT INTO participants (anonymous_code, study_id, installation_token_hash, locale)
       VALUES ($1, $2, $3, $4)
       RETURNING id, anonymous_code, locale, created_at`,
      [anonymousCode, bundle.study.id, hashToken(token), input.locale],
    );
    await writeAudit(client, {
      actorType: 'participant',
      actorId: inserted.rows[0].id,
      eventType: 'participant.enrolled',
      entityType: 'participant',
      entityId: inserted.rows[0].id,
      payload: {
        studyCode: input.studyCode,
        locale: input.locale,
        clientAppVersion: input.clientAppVersion,
      },
    });
    return {
      participantId: inserted.rows[0].id,
      anonymousCode: inserted.rows[0].anonymous_code,
      installationToken: token,
      locale: inserted.rows[0].locale,
      study: {
        studyCode: bundle.study.study_code,
        title: bundle.study.title,
        description: bundle.study.description,
      },
      protocol: {
        protocolVersion: bundle.protocol.protocol_version,
        consentVersion: bundle.protocol.consent_version,
        consentTextEn: bundle.protocol.consent_text_en,
        eligibilityTextEn: bundle.protocol.eligibility_text_en,
        retentionPolicy: bundle.protocol.retention_policy,
        withdrawalPolicy: bundle.protocol.withdrawal_policy,
      },
    };
  });
}

export async function recordConsent(
  participantId: string,
  input: {
    protocolVersion: string;
    consentVersion: string;
    eligibilityAcks: string[];
    telemetryConsent: boolean;
    clientAppVersion: string;
  },
) {
  return withTransaction(async (client) => {
    const protocol = await client.query(
      `SELECT pv.*
       FROM protocol_versions pv
       JOIN participants p ON p.study_id = pv.study_id
       WHERE p.id = $1
         AND pv.protocol_version = $2
         AND pv.consent_version = $3
         AND pv.active = TRUE`,
      [participantId, input.protocolVersion, input.consentVersion],
    );
    if (!protocol.rows[0]) {
      throw badRequest('protocol_version_mismatch');
    }

    await client.query(
      `UPDATE consents SET active = FALSE, revoked_at = now()
       WHERE participant_id = $1 AND active = TRUE`,
      [participantId],
    );

    const consent = await client.query(
      `INSERT INTO consents (
         participant_id, protocol_version_id, consent_version,
         eligibility_acks, telemetry_consent, client_app_version, active
       ) VALUES ($1, $2, $3, $4::jsonb, $5, $6, TRUE)
       RETURNING id, consent_version, granted_at`,
      [
        participantId,
        protocol.rows[0].id,
        input.consentVersion,
        JSON.stringify(input.eligibilityAcks),
        input.telemetryConsent,
        input.clientAppVersion,
      ],
    );

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participantId,
      eventType: 'consent.granted',
      entityType: 'consent',
      entityId: consent.rows[0].id,
      payload: {
        protocolVersion: input.protocolVersion,
        consentVersion: input.consentVersion,
        telemetryConsent: input.telemetryConsent,
      },
    });

    return consent.rows[0];
  });
}

export async function createSession(
  participantId: string,
  input: {
    instrumentCode: 'ipip_bfm_50';
    instrumentVersion: 1;
    locale: string;
    manifestHash: string;
    clientAppVersion: string;
    contextAnswers: Record<string, unknown>;
  },
) {
  const { instrument, items } = await getEnabledInstrument(
    input.instrumentCode,
    input.instrumentVersion,
    input.locale,
  );
  if (instrument.manifest_hash !== input.manifestHash) {
    throw badRequest('manifest_hash_mismatch', {
      expected: instrument.manifest_hash,
      received: input.manifestHash,
    });
  }

  return withTransaction(async (client) => {
    const consent = await client.query(
      `SELECT id, protocol_version_id
       FROM consents
       WHERE participant_id = $1 AND active = TRUE
       ORDER BY granted_at DESC
       LIMIT 1`,
      [participantId],
    );
    if (!consent.rows[0]) {
      throw forbidden('consent_required');
    }

    const existing = await client.query(
      `SELECT id, status
       FROM survey_sessions
       WHERE participant_id = $1
         AND instrument_version_id = $2
         AND status = 'in_progress'
       ORDER BY created_at DESC
       LIMIT 1`,
      [participantId, instrument.id],
    );
    if (existing.rows[0]) {
      return {
        sessionId: existing.rows[0].id,
        status: existing.rows[0].status,
        resumed: true,
        instrument: publicInstrument(instrument, items),
      };
    }

    const session = await client.query(
      `INSERT INTO survey_sessions (
         participant_id, protocol_version_id, instrument_version_id, consent_id,
         locale, client_app_version, context_answers, status
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'in_progress')
       RETURNING id, status`,
      [
        participantId,
        consent.rows[0].protocol_version_id,
        instrument.id,
        consent.rows[0].id,
        input.locale,
        input.clientAppVersion,
        JSON.stringify(input.contextAnswers),
      ],
    );

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participantId,
      eventType: 'session.created',
      entityType: 'survey_session',
      entityId: session.rows[0].id,
    });

    return {
      sessionId: session.rows[0].id,
      status: session.rows[0].status,
      resumed: false,
      instrument: publicInstrument(instrument, items),
    };
  });
}

function publicInstrument(
  instrument: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
) {
  return {
    instrumentCode: instrument.instrument_code,
    instrumentVersion: instrument.instrument_version,
    title: instrument.title,
    locale: instrument.locale,
    evidenceTier: instrument.evidence_tier,
    responseScale: instrument.response_scale,
    instructionsEn: instrument.instructions_en,
    itemCount: instrument.item_count,
    manifestHash: instrument.manifest_hash,
    scorerId: instrument.scorer_id,
    provenance: instrument.provenance,
    prohibitedInferences: instrument.prohibited_inferences,
    items: items.map((item) => ({
      itemId: item.item_id,
      sequenceIndex: item.sequence_index,
      itemTextEn: item.item_text_en,
      required: item.required,
    })),
  };
}

export async function submitResponses(
  participantId: string,
  sessionId: string,
  input: {
    idempotencyKey: string;
    responses: Array<{
      itemId: string;
      sequenceIndex: number;
      value: number;
      answeredAt: string;
      clientEventId: string;
    }>;
    complete: boolean;
  },
) {
  return withTransaction(async (client) => {
    const session = await lockSession(client, participantId, sessionId);

    if (session.idempotency_key && session.idempotency_key === input.idempotencyKey) {
      return buildSessionReceipt(client, session);
    }
    if (session.status === 'scored' || session.status === 'submitted') {
      if (session.idempotency_key === input.idempotencyKey) {
        return buildSessionReceipt(client, session);
      }
      throw conflict('session_already_completed');
    }
    if (session.status !== 'in_progress') {
      throw conflict('session_not_writable', { status: session.status });
    }

    const items = await client.query(
      `SELECT item_id, sequence_index, scale_key, keyed_direction
       FROM instrument_items
       WHERE instrument_version_id = $1
       ORDER BY sequence_index ASC`,
      [session.instrument_version_id],
    );
    const itemById = new Map(items.rows.map((row) => [row.item_id, row]));

    for (const response of input.responses) {
      const item = itemById.get(response.itemId);
      if (!item) {
        throw badRequest(`unknown_item:${response.itemId}`);
      }
      if (item.sequence_index !== response.sequenceIndex) {
        throw badRequest(`sequence_mismatch:${response.itemId}`);
      }
      await client.query(
        `INSERT INTO responses (
           session_id, item_id, sequence_index, value, answered_at, client_event_id
         ) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (session_id, item_id)
         DO UPDATE SET
           value = EXCLUDED.value,
           answered_at = EXCLUDED.answered_at,
           client_event_id = EXCLUDED.client_event_id
         WHERE responses.session_id = $1`,
        [
          sessionId,
          response.itemId,
          response.sequenceIndex,
          response.value,
          response.answeredAt,
          response.clientEventId,
        ],
      );
    }

    const stored = await client.query(
      `SELECT item_id, value FROM responses WHERE session_id = $1`,
      [sessionId],
    );

    if (input.complete) {
      if (stored.rows.length !== EXPECTED_ITEM_COUNT) {
        throw badRequest('incomplete_response_set', {
          received: stored.rows.length,
          expected: EXPECTED_ITEM_COUNT,
        });
      }

      const scores = scoreIpip50(
        items.rows.map((row) => ({
          itemId: row.item_id,
          scaleKey: row.scale_key,
          keyedDirection: row.keyed_direction,
        })),
        stored.rows.map((row) => ({
          itemId: row.item_id,
          value: row.value,
        })),
      );

      for (const score of scores) {
        await client.query(
          `INSERT INTO scale_scores (
             session_id, scorer_id, scorer_version, scale_key, raw_sum, mean_score, item_count
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (session_id, scale_key, scorer_version) DO NOTHING`,
          [
            sessionId,
            SCORER_ID,
            SCORER_VERSION,
            score.scaleKey,
            score.rawSum,
            score.meanScore,
            score.itemCount,
          ],
        );
      }

      await client.query(
        `UPDATE survey_sessions
         SET status = 'scored',
             completed_at = now(),
             updated_at = now(),
             idempotency_key = $2
         WHERE id = $1`,
        [sessionId, input.idempotencyKey],
      );

      await writeAudit(client, {
        actorType: 'participant',
        actorId: participantId,
        eventType: 'session.scored',
        entityType: 'survey_session',
        entityId: sessionId,
        payload: { scorerId: SCORER_ID, scorerVersion: SCORER_VERSION },
      });
    } else {
      await client.query(
        `UPDATE survey_sessions SET updated_at = now() WHERE id = $1`,
        [sessionId],
      );
    }

    const refreshed = await client.query(
      `SELECT * FROM survey_sessions WHERE id = $1`,
      [sessionId],
    );
    return buildSessionReceipt(client, refreshed.rows[0], stored.rows.length);
  });
}

async function lockSession(
  client: DbClient,
  participantId: string,
  sessionId: string,
) {
  const result = await client.query(
    `SELECT *
     FROM survey_sessions
     WHERE id = $1 AND participant_id = $2
     FOR UPDATE`,
    [sessionId, participantId],
  );
  if (!result.rows[0]) {
    throw notFound('session_not_found');
  }
  return result.rows[0];
}

async function buildSessionReceipt(
  client: DbClient,
  session: Record<string, unknown>,
  responseCount?: number,
) {
  let count = responseCount;
  if (count === undefined) {
    const result = await client.query(
      `SELECT COUNT(*)::int AS count FROM responses WHERE session_id = $1`,
      [session.id],
    );
    count = result.rows[0].count;
  }
  return {
    sessionId: session.id,
    status: session.status,
    responseCount: count,
    completedAt: session.completed_at,
    receipt:
      session.status === 'scored'
        ? {
            message:
              'Submission received. Research scores are stored server-side and are not clinical results.',
            scored: true,
          }
        : {
            message: 'Responses saved.',
            scored: false,
          },
  };
}

export async function getSessionStatus(participantId: string, sessionId: string) {
  const session = await pool.query(
    `SELECT id, status, locale, started_at, completed_at
     FROM survey_sessions
     WHERE id = $1 AND participant_id = $2`,
    [sessionId, participantId],
  );
  if (!session.rows[0]) {
    throw notFound('session_not_found');
  }
  const count = await pool.query(
    `SELECT COUNT(*)::int AS count FROM responses WHERE session_id = $1`,
    [sessionId],
  );
  return {
    ...session.rows[0],
    responseCount: count.rows[0].count,
  };
}

export async function withdrawParticipant(
  participantId: string,
  input: { reasonCode?: string; deleteData: boolean },
) {
  return withTransaction(async (client) => {
    await client.query(
      `INSERT INTO withdrawals (participant_id, reason_code, delete_data, processed_at)
       VALUES ($1, $2, $3, now())`,
      [participantId, input.reasonCode ?? null, input.deleteData],
    );

    await client.query(
      `UPDATE survey_sessions
       SET status = 'withdrawn', updated_at = now()
       WHERE participant_id = $1 AND status = 'in_progress'`,
      [participantId],
    );

    await client.query(
      `UPDATE consents SET active = FALSE, revoked_at = now()
       WHERE participant_id = $1 AND active = TRUE`,
      [participantId],
    );

    if (input.deleteData) {
      await client.query(
        `DELETE FROM scale_scores
         WHERE session_id IN (SELECT id FROM survey_sessions WHERE participant_id = $1)`,
        [participantId],
      );
      await client.query(
        `DELETE FROM responses
         WHERE session_id IN (SELECT id FROM survey_sessions WHERE participant_id = $1)`,
        [participantId],
      );
      await client.query(`DELETE FROM survey_sessions WHERE participant_id = $1`, [
        participantId,
      ]);
      await client.query(`DELETE FROM consents WHERE participant_id = $1`, [
        participantId,
      ]);
      await client.query(
        `UPDATE participants
         SET retention_state = 'deleted', updated_at = now()
         WHERE id = $1`,
        [participantId],
      );
    } else {
      await client.query(
        `UPDATE participants
         SET retention_state = 'withdrawn', updated_at = now()
         WHERE id = $1`,
        [participantId],
      );
    }

    await writeAudit(client, {
      actorType: 'participant',
      actorId: participantId,
      eventType: 'participant.withdrawn',
      entityType: 'participant',
      entityId: participantId,
      payload: { deleteData: input.deleteData, reasonCode: input.reasonCode },
    });

    return {
      withdrawn: true,
      deleteData: input.deleteData,
      retentionState: input.deleteData ? 'deleted' : 'withdrawn',
    };
  });
}
