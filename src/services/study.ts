import { pool } from '../db.js';
import { notFound, badRequest } from '../lib/errors.js';
import {
  computeManifestHash,
  loadBundledEnglishInstrument,
} from '../lib/manifest.js';

export async function getActiveStudyBundle(studyCode: string) {
  const study = await pool.query(
    `SELECT id, study_code, title, description, active
     FROM studies WHERE study_code = $1`,
    [studyCode],
  );
  if (!study.rows[0] || !study.rows[0].active) {
    throw notFound('study_not_found');
  }

  const protocol = await pool.query(
    `SELECT id, protocol_version, consent_version, consent_text_en, consent_text_pt_br,
            eligibility_text_en, eligibility_text_pt_br, retention_policy, withdrawal_policy
     FROM protocol_versions
     WHERE study_id = $1 AND active = TRUE
     ORDER BY created_at DESC
     LIMIT 1`,
    [study.rows[0].id],
  );
  if (!protocol.rows[0]) {
    throw notFound('protocol_not_found');
  }

  const instrumentCode =
    studyCode === 'noosphere_cortical_battery_v1'
      ? 'cortical_battery_v1'
      : 'ipip_bfm_50';

  const instruments = await pool.query(
    `SELECT id, instrument_code, instrument_version, title, locale, locale_enabled,
            evidence_tier, response_scale, instructions_en, instructions_pt_br,
            item_count, manifest_hash, scorer_id, provenance, prohibited_inferences
     FROM instrument_versions
     WHERE instrument_code = $1 AND instrument_version = 1
     ORDER BY locale`,
    [instrumentCode],
  );

  return {
    study: study.rows[0],
    protocol: protocol.rows[0],
    instruments: instruments.rows,
  };
}

export async function getEnabledInstrument(
  instrumentCode: string,
  instrumentVersion: number,
  locale: string,
) {
  const result = await pool.query(
    `SELECT *
     FROM instrument_versions
     WHERE instrument_code = $1
       AND instrument_version = $2
       AND locale = $3`,
    [instrumentCode, instrumentVersion, locale],
  );
  const instrument = result.rows[0];
  if (!instrument) {
    throw notFound('instrument_not_found');
  }
  if (!instrument.active || !instrument.locale_enabled) {
    throw badRequest('locale_not_enabled', {
      locale,
      message:
        'Brazilian Portuguese collection is disabled until validated wording is approved.',
    });
  }

  const items = await pool.query(
    `SELECT item_id, sequence_index, item_text_en, item_text_pt_br, scale_key, keyed_direction, required
     FROM instrument_items
     WHERE instrument_version_id = $1
     ORDER BY sequence_index ASC`,
    [instrument.id],
  );

  if (instrumentCode === 'ipip_bfm_50' && locale === 'en') {
    const bundled = loadBundledEnglishInstrument();
    const expected = computeManifestHash(bundled);
    if (instrument.manifest_hash !== expected) {
      throw badRequest('manifest_hash_drift', {
        stored: instrument.manifest_hash,
        expected,
      });
    }
  }

  return { instrument, items: items.rows };
}
