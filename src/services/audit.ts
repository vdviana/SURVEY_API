import type { DbClient } from '../db.js';

export async function writeAudit(
  client: DbClient,
  input: {
    actorType: 'system' | 'participant' | 'api';
    actorId?: string;
    eventType: string;
    entityType: string;
    entityId?: string;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_events (actor_type, actor_id, event_type, entity_type, entity_id, payload)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorType,
      input.actorId ?? null,
      input.eventType,
      input.entityType,
      input.entityId ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
}
