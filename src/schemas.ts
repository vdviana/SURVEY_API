import { z } from 'zod';

/** Normalize common locale aliases before enum check. */
function normalizeLocale(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower === 'en' || lower === 'en-us' || lower === 'en_us') return 'en';
  if (lower === 'pt' || lower === 'pt-br' || lower === 'pt_br' || lower === 'pt-br')
    return 'pt-BR';
  if (lower === 'zh' || lower === 'zh-cn' || lower === 'zh_cn' || lower === 'zh-hans')
    return 'zh-CN';
  if (lower === 'ru' || lower === 'ru-ru' || lower === 'ru_ru') return 'ru';
  if (lower === 'es' || lower === 'es-es' || lower === 'es_es' || lower === 'es-mx')
    return 'es';
  if (v === 'pt-BR' || v === 'zh-CN') return v;
  return v;
}

const surveyLocaleSchema = z.preprocess(
  normalizeLocale,
  z.enum(['en', 'pt-BR', 'zh-CN', 'ru', 'es']),
);

export const enrollSchema = z.object({
  studyCode: z.string().min(1),
  locale: surveyLocaleSchema.default('en'),
  clientAppVersion: z.string().min(1),
});

export const consentSchema = z.object({
  protocolVersion: z.string().min(1),
  consentVersion: z.string().min(1),
  eligibilityAcks: z.array(z.string().min(1)).min(1),
  telemetryConsent: z.boolean(),
  clientAppVersion: z.string().min(1),
});

export const createSessionSchema = z.object({
  instrumentCode: z.enum([
    'ipip_bfm_50',
    'cortical_battery_v1',
    'dirty_dozen_v1',
    'phq9_v1',
    'gad7_v1',
  ]),
  instrumentVersion: z.literal(1),
  locale: surveyLocaleSchema,
  manifestHash: z.string().startsWith('sha256:'),
  clientAppVersion: z.string().min(1),
  contextAnswers: z
    .object({
      sleepHours: z.number().min(0).max(24).optional(),
      caffeineToday: z.boolean().optional(),
      medicationNoteProvided: z.boolean().optional(),
      accessibilityNeeds: z.string().max(500).optional(),
    })
    .default({}),
});

export const finalizeProfileSchema = z.object({
  cognitiveSessionId: z.string().uuid(),
  ipipSessionId: z.string().uuid(),
  dirtyDozenSessionId: z.string().uuid(),
  phqSessionId: z.string().uuid(),
  gadSessionId: z.string().uuid(),
  likertLatencies: z
    .array(
      z.object({
        itemId: z.string().min(1),
        instrumentCode: z.enum([
          'ipip_bfm_50',
          'dirty_dozen_v1',
          'phq9_v1',
          'gad7_v1',
        ]),
        latencyMs: z.number().min(0).max(120_000),
        changeCount: z.number().int().min(0).max(50).optional(),
      }),
    )
    .max(120)
    .default([]),
});

const cognitiveSampleSchema = z.object({
  tMs: z.number(),
  type: z.string().min(1).max(64),
  x: z.number().optional(),
  y: z.number().optional(),
  module: z.string().max(64).optional(),
  questionId: z.string().max(128).optional(),
  pointerId: z.number().optional(),
  gx: z.number().optional(),
  gy: z.number().optional(),
  gz: z.number().optional(),
  ax: z.number().optional(),
  ay: z.number().optional(),
  az: z.number().optional(),
  lux: z.number().optional(),
  effort01: z.number().optional(),
  trackingError: z.number().optional(),
  rtMs: z.number().optional(),
  errorCount: z.number().optional(),
  hitRate: z.number().optional(),
  fidelity01: z.number().min(0).max(1).optional(),
  sensorEnergy: z.number().optional(),
  difficulty: z.number().optional(),
  dualTaskBreaks: z.number().optional(),
  meta: z.string().max(512).optional(),
});

export const cognitiveSamplesSchema = z.object({
  clientBatchId: z.string().min(8).max(128),
  module: z.string().min(1).max(64),
  region: z.enum(['mnemico', 'limbico', 'perceptivo', 'heuristico']),
  blockId: z.string().max(128).optional(),
  blockIndex: z.number().int().min(0).max(200).optional(),
  samples: z.array(cognitiveSampleSchema).min(1).max(2000),
});

export const cognitiveCompleteSchema = z.object({
  blockCount: z.number().int().min(1).max(200),
});

export const responseItemSchema = z.object({
  itemId: z.string().min(1),
  sequenceIndex: z.number().int().min(1).max(50),
  value: z.number().int().min(0).max(5),
  answeredAt: z.string().datetime(),
  clientEventId: z.string().min(1),
});

export const submitResponsesSchema = z.object({
  idempotencyKey: z.string().min(8).max(128),
  responses: z.array(responseItemSchema).min(1).max(50),
  complete: z.boolean().default(false),
});

export const withdrawSchema = z.object({
  reasonCode: z.string().max(64).optional(),
  deleteData: z.boolean().default(true),
});

export const telemetryEventSchema = z.object({
  clientEventId: z.string().min(8).max(128),
  eventType: z.enum([
    'heartbeat',
    'app_foreground',
    'app_background',
    'progress',
    'inactivity',
    'upload_pending',
    'upload_complete',
  ]),
  appState: z.enum(['active', 'background', 'inactive', 'unknown']),
  progressCount: z.number().int().min(0).max(50),
  currentPage: z.number().int().min(0).max(10).nullable().optional(),
  inactivitySeconds: z.number().int().min(0).max(86_400).default(0),
  networkState: z.enum(['online', 'offline', 'unknown']).default('unknown'),
  occurredAt: z.string().datetime(),
});

export const telemetryBatchSchema = z.object({
  events: z.array(telemetryEventSchema).min(1).max(100),
});
