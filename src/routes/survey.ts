import type { FastifyInstance } from 'fastify';
import {
  cognitiveCompleteSchema,
  cognitiveSamplesSchema,
  consentSchema,
  createSessionSchema,
  enrollSchema,
  finalizeProfileSchema,
  submitResponsesSchema,
  telemetryBatchSchema,
  withdrawSchema,
} from '../schemas.js';
import { requireParticipant } from '../services/auth.js';
import {
  createSession,
  enrollParticipant,
  getSessionStatus,
  recordConsent,
  submitResponses,
  withdrawParticipant,
} from '../services/survey.js';
import {
  completeCognitiveSession,
  ingestCognitiveSamples,
} from '../services/cognitive.js';
import {
  finalizePersonalityProfile,
  getParticipantMindMap,
} from '../services/mindMap.js';
import { getEnabledInstrument } from '../services/study.js';
import { badRequest } from '../lib/errors.js';
import { config } from '../config.js';
import {
  getLiveSessionTelemetry,
  ingestTelemetry,
  requireResearcherKey,
} from '../services/telemetry.js';

export async function surveyRoutes(app: FastifyInstance) {
  app.post('/v1/enroll', async (request) => {
    const body = enrollSchema.parse(request.body);
    return enrollParticipant(body);
  });

  app.post('/v1/consent', async (request) => {
    const participant = await requireParticipant(request);
    const body = consentSchema.parse(request.body);
    const consent = await recordConsent(participant.id, body);
    return {
      consentId: consent.id,
      consentVersion: consent.consent_version,
      grantedAt: consent.granted_at,
    };
  });

  app.post('/v1/sessions', async (request) => {
    const participant = await requireParticipant(request);
    const body = createSessionSchema.parse(request.body);
    return createSession(participant.id, body);
  });

  app.post('/v1/sessions/:sessionId/cognitive-samples', async (request) => {
    const participant = await requireParticipant(request);
    const { sessionId } = request.params as { sessionId: string };
    const body = cognitiveSamplesSchema.parse(request.body);
    return ingestCognitiveSamples(participant, sessionId, body);
  });

  app.post('/v1/sessions/:sessionId/cognitive-complete', async (request) => {
    const participant = await requireParticipant(request);
    const { sessionId } = request.params as { sessionId: string };
    const body = cognitiveCompleteSchema.parse(request.body);
    return completeCognitiveSession(participant, sessionId, body);
  });

  app.get('/v1/instruments/:code/:version', async (request) => {
    const params = request.params as { code: string; version: string };
    const query = request.query as { locale?: string };
    const locale = query.locale ?? 'en';
    const version = Number(params.version);
    if (
      (params.code !== 'ipip_bfm_50' &&
        params.code !== 'cortical_battery_v1' &&
        params.code !== 'dirty_dozen_v1') ||
      version !== 1
    ) {
      throw badRequest('unsupported_instrument');
    }
    const { instrument, items } = await getEnabledInstrument(
      params.code,
      version,
      locale,
    );
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
  });

  app.post('/v1/sessions/:sessionId/responses', async (request) => {
    const participant = await requireParticipant(request);
    const { sessionId } = request.params as { sessionId: string };
    const body = submitResponsesSchema.parse(request.body);
    return submitResponses(participant.id, sessionId, body);
  });

  app.post('/v1/sessions/:sessionId/telemetry', async (request) => {
    const participant = await requireParticipant(request);
    const { sessionId } = request.params as { sessionId: string };
    const body = telemetryBatchSchema.parse(request.body);
    return ingestTelemetry(participant, sessionId, body.events);
  });

  app.get('/v1/sessions/:sessionId', async (request) => {
    const participant = await requireParticipant(request);
    const { sessionId } = request.params as { sessionId: string };
    return getSessionStatus(participant.id, sessionId);
  });

  app.post('/v1/withdraw', async (request) => {
    const participant = await requireParticipant(request);
    const body = withdrawSchema.parse(request.body);
    return withdrawParticipant(participant.id, body);
  });

  app.get('/v1/me', async (request) => {
    const participant = await requireParticipant(request);
    return {
      participantId: participant.id,
      anonymousCode: participant.anonymous_code,
      locale: participant.locale,
      retentionState: participant.retention_state,
    };
  });

  app.post('/v1/me/finalize-profile', async (request) => {
    const participant = await requireParticipant(request);
    const body = finalizeProfileSchema.parse(request.body);
    return finalizePersonalityProfile(participant.id, body);
  });

  app.get('/v1/me/mind-map', async (request) => {
    const participant = await requireParticipant(request);
    return getParticipantMindMap(participant.id);
  });

  app.get('/v1/research/live-sessions', async (request) => {
    requireResearcherKey(request.headers.authorization, config.researcherApiKey);
    return getLiveSessionTelemetry();
  });
}
