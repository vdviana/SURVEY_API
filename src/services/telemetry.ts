import { pool, withTransaction } from '../db.js';
import { forbidden, notFound, unauthorized } from '../lib/errors.js';
import type { ParticipantRow } from './auth.js';

export type TelemetryEventInput = {
  clientEventId: string;
  eventType:
    | 'heartbeat'
    | 'app_foreground'
    | 'app_background'
    | 'progress'
    | 'inactivity'
    | 'upload_pending'
    | 'upload_complete';
  appState: 'active' | 'background' | 'inactive' | 'unknown';
  progressCount: number;
  currentPage?: number | null;
  inactivitySeconds: number;
  networkState: 'online' | 'offline' | 'unknown';
  occurredAt: string;
};

export async function ingestTelemetry(
  participant: ParticipantRow,
  sessionId: string,
  events: TelemetryEventInput[],
) {
  return withTransaction(async (client) => {
    const session = await client.query(
      `SELECT s.id, s.status, c.telemetry_consent
       FROM survey_sessions s
       JOIN consents c ON c.id = s.consent_id
       WHERE s.id = $1 AND s.participant_id = $2
       FOR UPDATE`,
      [sessionId, participant.id],
    );
    if (!session.rows[0]) {
      throw notFound('session_not_found');
    }
    if (!session.rows[0].telemetry_consent) {
      throw forbidden('telemetry_consent_required');
    }

    let accepted = 0;
    for (const event of events) {
      const result = await client.query(
        `INSERT INTO session_telemetry_events (
           session_id, participant_id, client_event_id, event_type, app_state,
           progress_count, current_page, inactivity_seconds, network_state, occurred_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (session_id, client_event_id) DO NOTHING`,
        [
          sessionId,
          participant.id,
          event.clientEventId,
          event.eventType,
          event.appState,
          event.progressCount,
          event.currentPage ?? null,
          event.inactivitySeconds,
          event.networkState,
          event.occurredAt,
        ],
      );
      accepted += result.rowCount ?? 0;
    }

    return { accepted, received: events.length };
  });
}

export function requireResearcherKey(
  authorizationHeader: string | undefined,
  configuredKey: string,
): void {
  if (!configuredKey) {
    throw unauthorized('researcher_api_disabled');
  }
  if (authorizationHeader !== `Bearer ${configuredKey}`) {
    throw unauthorized('invalid_researcher_key');
  }
}

export async function getLiveSessionTelemetry() {
  const result = await pool.query(
    `SELECT
       s.id AS session_id,
       p.anonymous_code,
       s.status,
       s.started_at,
       s.completed_at,
       latest.event_type,
       latest.app_state,
       latest.progress_count,
       latest.current_page,
       latest.inactivity_seconds,
       latest.network_state,
       latest.occurred_at,
       latest.received_at,
       CASE
         WHEN latest.received_at IS NULL THEN 'no_telemetry'
         WHEN latest.received_at < now() - interval '45 seconds' THEN 'stale'
         WHEN latest.app_state = 'background' THEN 'background'
         ELSE 'online'
       END AS live_status
     FROM survey_sessions s
     JOIN participants p ON p.id = s.participant_id
     JOIN consents c ON c.id = s.consent_id AND c.telemetry_consent = TRUE
     LEFT JOIN LATERAL (
       SELECT event_type, app_state, progress_count, current_page,
              inactivity_seconds, network_state, occurred_at, received_at
       FROM session_telemetry_events ste
       WHERE ste.session_id = s.id
       ORDER BY ste.received_at DESC
       LIMIT 1
     ) latest ON TRUE
     WHERE s.status IN ('in_progress', 'submitted', 'scored')
     ORDER BY COALESCE(latest.received_at, s.started_at) DESC
     LIMIT 500`,
  );
  return {
    generatedAt: new Date().toISOString(),
    sessions: result.rows,
  };
}
