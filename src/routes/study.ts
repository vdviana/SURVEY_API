import type { FastifyInstance } from 'fastify';
import { getActiveStudyBundle } from '../services/study.js';
import {
  computeManifestHash,
  loadBundledEnglishInstrument,
} from '../lib/manifest.js';

const CORTICAL_MANIFEST_HASH = 'sha256:c0r71ca1ba77eryv1man1fe57deadbeef0001';

export async function studyRoutes(app: FastifyInstance) {
  app.get('/v1/studies/:studyCode', async (request) => {
    const { studyCode } = request.params as { studyCode: string };
    const bundle = await getActiveStudyBundle(studyCode);

    const hasIpip = bundle.instruments.some(
      (row) => row.instrument_code === 'ipip_bfm_50',
    );
    const bundledEnglishManifestHash = hasIpip
      ? computeManifestHash(loadBundledEnglishInstrument())
      : (bundle.instruments[0]?.manifest_hash ?? CORTICAL_MANIFEST_HASH);

    return {
      study: {
        studyCode: bundle.study.study_code,
        title: bundle.study.title,
        description: bundle.study.description,
      },
      protocol: {
        protocolVersion: bundle.protocol.protocol_version,
        consentVersion: bundle.protocol.consent_version,
        consentTextEn: bundle.protocol.consent_text_en,
        consentTextPtBr: bundle.protocol.consent_text_pt_br,
        eligibilityTextEn: bundle.protocol.eligibility_text_en,
        eligibilityTextPtBr: bundle.protocol.eligibility_text_pt_br,
        retentionPolicy: bundle.protocol.retention_policy,
        withdrawalPolicy: bundle.protocol.withdrawal_policy,
      },
      instruments: bundle.instruments.map((row) => ({
        instrumentCode: row.instrument_code,
        instrumentVersion: row.instrument_version,
        title: row.title,
        locale: row.locale,
        localeEnabled: row.locale_enabled,
        evidenceTier: row.evidence_tier,
        itemCount: row.item_count,
        manifestHash: row.manifest_hash,
        scorerId: row.scorer_id,
        prohibitedInferences: row.prohibited_inferences,
      })),
      bundledEnglishManifestHash,
      researchDisclaimer:
        'Behavioral research only. Protocol region labels are schedule tags — not diagnostic, prognostic, treatment, or neural measurement.',
    };
  });
}
