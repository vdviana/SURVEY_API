import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../../src/app.js';
import { pool } from '../../src/db.js';
import {
  computeManifestHash,
  loadBundledEnglishInstrument,
} from '../../src/lib/manifest.js';

const STUDY = 'noosphere_ipip50_pilot_v1';

async function dbAvailable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

test('API enrollment → consent → session → complete → withdraw', async (t) => {
  if (!(await dbAvailable())) {
    t.skip('database unavailable');
    return;
  }

  const app = await buildApp();
  await app.ready();

  const study = await app.inject({ method: 'GET', url: `/v1/studies/${STUDY}` });
  assert.equal(study.statusCode, 200);
  const studyBody = study.json();
  assert.equal(studyBody.study.studyCode, STUDY);

  const enroll = await app.inject({
    method: 'POST',
    url: '/v1/enroll',
    payload: {
      studyCode: STUDY,
      locale: 'en',
      clientAppVersion: '0.1.0',
    },
  });
  assert.equal(enroll.statusCode, 200);
  const enrolled = enroll.json();
  const auth = { authorization: `Bearer ${enrolled.installationToken}` };

  const blockedLocale = await app.inject({
    method: 'POST',
    url: '/v1/enroll',
    payload: {
      studyCode: STUDY,
      locale: 'pt-BR',
      clientAppVersion: '0.1.0',
    },
  });
  assert.equal(blockedLocale.statusCode, 400);

  const consent = await app.inject({
    method: 'POST',
    url: '/v1/consent',
    headers: auth,
    payload: {
      protocolVersion: 'protocol_v2',
      consentVersion: 'consent_v2',
      eligibilityAcks: ['age_majority', 'research_not_clinical', 'self_report'],
      telemetryConsent: true,
      clientAppVersion: '0.1.0',
    },
  });
  assert.equal(consent.statusCode, 200);

  const seed = loadBundledEnglishInstrument();
  const manifestHash = computeManifestHash(seed);
  const session = await app.inject({
    method: 'POST',
    url: '/v1/sessions',
    headers: auth,
    payload: {
      instrumentCode: 'ipip_bfm_50',
      instrumentVersion: 1,
      locale: 'en',
      manifestHash,
      clientAppVersion: '0.1.0',
      contextAnswers: { sleepHours: 7, caffeineToday: false },
    },
  });
  assert.equal(session.statusCode, 200);
  const sessionBody = session.json();
  assert.equal(sessionBody.instrument.items.length, 50);

  const telemetry = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionBody.sessionId}/telemetry`,
    headers: auth,
    payload: {
      events: [
        {
          clientEventId: 'telemetry-integration-1',
          eventType: 'heartbeat',
          appState: 'active',
          progressCount: 5,
          currentPage: 1,
          inactivitySeconds: 2,
          networkState: 'online',
          occurredAt: new Date().toISOString(),
        },
      ],
    },
  });
  assert.equal(telemetry.statusCode, 200);
  assert.equal(telemetry.json().accepted, 1);

  const unauthorizedLive = await app.inject({
    method: 'GET',
    url: '/v1/research/live-sessions',
  });
  assert.equal(unauthorizedLive.statusCode, 401);

  const live = await app.inject({
    method: 'GET',
    url: '/v1/research/live-sessions',
    headers: { authorization: 'Bearer integration-test-researcher-key' },
  });
  assert.equal(live.statusCode, 200);
  assert.ok(
    live.json().sessions.some(
      (entry: { session_id: string }) => entry.session_id === sessionBody.sessionId,
    ),
  );

  const responses = sessionBody.instrument.items.map(
    (item: { itemId: string; sequenceIndex: number }) => ({
      itemId: item.itemId,
      sequenceIndex: item.sequenceIndex,
      value: 4,
      answeredAt: new Date().toISOString(),
      clientEventId: `evt-${item.itemId}`,
    }),
  );

  const submit = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionBody.sessionId}/responses`,
    headers: auth,
    payload: {
      idempotencyKey: 'idem-complete-1',
      responses,
      complete: true,
    },
  });
  assert.equal(submit.statusCode, 200);
  assert.equal(submit.json().status, 'scored');
  assert.equal(submit.json().receipt.scored, true);

  const retry = await app.inject({
    method: 'POST',
    url: `/v1/sessions/${sessionBody.sessionId}/responses`,
    headers: auth,
    payload: {
      idempotencyKey: 'idem-complete-1',
      responses,
      complete: true,
    },
  });
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().status, 'scored');

  const scores = await pool.query(
    `SELECT scale_key, raw_sum FROM scale_scores WHERE session_id = $1 ORDER BY scale_key`,
    [sessionBody.sessionId],
  );
  assert.equal(scores.rows.length, 5);

  const withdraw = await app.inject({
    method: 'POST',
    url: '/v1/withdraw',
    headers: auth,
    payload: { deleteData: true, reasonCode: 'test' },
  });
  assert.equal(withdraw.statusCode, 200);
  assert.equal(withdraw.json().retentionState, 'deleted');

  await app.close();
});

test('after tests close pool', async () => {
  await pool.end();
});
