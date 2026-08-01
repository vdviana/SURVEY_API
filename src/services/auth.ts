import type { FastifyRequest } from 'fastify';
import { pool } from '../db.js';
import { hashToken } from '../lib/crypto.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export type ParticipantRow = {
  id: string;
  anonymous_code: string;
  study_id: string;
  installation_token_hash: string;
  locale: string;
  retention_state: string;
};

export async function requireParticipant(
  request: FastifyRequest,
): Promise<ParticipantRow> {
  const header = request.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    throw unauthorized('missing_bearer_token');
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    throw unauthorized('missing_bearer_token');
  }

  const tokenHash = hashToken(token);
  const result = await pool.query<ParticipantRow>(
    `SELECT id, anonymous_code, study_id, installation_token_hash, locale, retention_state
     FROM participants
     WHERE installation_token_hash = $1`,
    [tokenHash],
  );
  const participant = result.rows[0];
  if (!participant) {
    throw unauthorized('invalid_token');
  }
  if (participant.retention_state !== 'active') {
    throw forbidden('participant_not_active');
  }
  return participant;
}
