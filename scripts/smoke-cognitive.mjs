import 'dotenv/config';
import pg from 'pg';
import { enrollParticipant, recordConsent, createSession } from '../dist/services/survey.js';
import {
  ingestCognitiveSamples,
  completeCognitiveSession,
} from '../dist/services/cognitive.js';

const enroll = await enrollParticipant({
  studyCode: 'noosphere_cortical_battery_v1',
  locale: 'en',
  clientAppVersion: '0.2.0-smoke',
});
console.log('enrolled', enroll.anonymousCode);

await recordConsent(enroll.participantId, {
  protocolVersion: enroll.protocol.protocolVersion,
  consentVersion: enroll.protocol.consentVersion,
  eligibilityAcks: ['age_majority', 'research_not_clinical', 'self_report'],
  telemetryConsent: false,
  clientAppVersion: '0.2.0-smoke',
});

const session = await createSession(enroll.participantId, {
  instrumentCode: 'cortical_battery_v1',
  instrumentVersion: 1,
  locale: 'en',
  manifestHash: 'sha256:c0r71ca1ba77eryv1man1fe57deadbeef0001',
  clientAppVersion: '0.2.0-smoke',
  contextAnswers: {},
});
console.log('session', session.sessionId);

const participant = { id: enroll.participantId };
await ingestCognitiveSamples(participant, session.sessionId, {
  clientBatchId: `smoke-batch-${Date.now()}`,
  module: 'limbico',
  region: 'limbico',
  blockId: 'blk_1',
  blockIndex: 1,
  samples: Array.from({ length: 20 }, (_, i) => ({
    tMs: i * 50,
    type: i % 5 === 0 ? 'answer' : 'touch_move',
    x: 10 + i,
    y: 20 + i,
    effort01: 0.4 + (i % 7) * 0.05,
    module: 'limbico',
  })),
});

const done = await completeCognitiveSession(participant, session.sessionId, {
  blockCount: 12,
});
console.log('complete', JSON.stringify(done));

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
const sum = await client.query(
  'SELECT assertiveness_bps, sample_count FROM cognitive_session_summaries WHERE session_id = $1',
  [session.sessionId],
);
console.log('summary', sum.rows[0]);
await client.end();
