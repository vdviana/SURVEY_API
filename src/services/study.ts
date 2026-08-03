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

  const instrumentCodes =
    studyCode === 'noosphere_cortical_battery_v1'
      ? [
          'cortical_battery_v1',
          'ipip_bfm_50',
          'dirty_dozen_v1',
          'phq9_v1',
          'gad7_v1',
        ]
      : ['ipip_bfm_50'];

  const instruments = await pool.query(
    `SELECT id, instrument_code, instrument_version, title, locale, locale_enabled,
            evidence_tier, response_scale, instructions_en, instructions_pt_br,
            item_count, manifest_hash, scorer_id, provenance, prohibited_inferences
     FROM instrument_versions
     WHERE instrument_code = ANY($1::text[]) AND instrument_version = 1
     ORDER BY instrument_code, locale`,
    [instrumentCodes],
  );

  return {
    study: study.rows[0],
    protocol: protocol.rows[0],
    instruments: instruments.rows,
  };
}

function resolveItemText(
  item: {
    item_text_en: string;
    item_text_pt_br: string | null;
    item_texts?: Record<string, string> | null;
  },
  locale: string,
): string {
  const map = item.item_texts ?? {};
  if (typeof map[locale] === 'string' && map[locale].trim()) return map[locale];
  if (locale === 'pt-BR' && item.item_text_pt_br?.trim()) return item.item_text_pt_br;
  return item.item_text_en;
}

/** Load items without requiring migration 008 `item_texts` column. */
async function loadItems(instrumentVersionId: string) {
  try {
    return await pool.query(
      `SELECT item_id, sequence_index, item_text_en, item_text_pt_br, item_texts,
              scale_key, keyed_direction, required
       FROM instrument_items
       WHERE instrument_version_id = $1
       ORDER BY sequence_index ASC`,
      [instrumentVersionId],
    );
  } catch (err) {
    const code = (err as { code?: string }).code;
    // undefined_column — DB without migration 008
    if (code === '42703') {
      return pool.query(
        `SELECT item_id, sequence_index, item_text_en, item_text_pt_br,
                NULL::jsonb AS item_texts,
                scale_key, keyed_direction, required
         FROM instrument_items
         WHERE instrument_version_id = $1
         ORDER BY sequence_index ASC`,
        [instrumentVersionId],
      );
    }
    throw err;
  }
}

/**
 * Always binds scoring/session to an English (or locale) pack that has items.
 * Requested locale is echoed for UI text resolution; missing locale packs fall back to `en`.
 */
export async function getEnabledInstrument(
  instrumentCode: string,
  instrumentVersion: number,
  locale: string,
) {
  const load = async (loc: string) => {
    const result = await pool.query(
      `SELECT *
       FROM instrument_versions
       WHERE instrument_code = $1
         AND instrument_version = $2
         AND locale = $3`,
      [instrumentCode, instrumentVersion, loc],
    );
    return result.rows[0] ?? null;
  };

  const en = await load('en');
  if (!en || !en.active || !en.locale_enabled) {
    throw badRequest('locale_not_enabled', {
      locale: 'en',
      message: 'English instrument pack is missing or disabled.',
    });
  }

  // Prefer English content pack for all locales (locale stubs often have 0 items).
  // Keep optional locale pack only when it actually has items.
  let contentInstrument = en;
  let items = await loadItems(en.id);

  if (locale !== 'en') {
    const localized = await load(locale);
    if (localized?.active && localized.locale_enabled) {
      const localizedItems = await loadItems(localized.id);
      if (localizedItems.rows.length > 0) {
        contentInstrument = localized;
        items = localizedItems;
      }
    }
  }

  if (items.rows.length === 0) {
    throw notFound('instrument_items_missing');
  }

  if (instrumentCode === 'ipip_bfm_50') {
    const bundled = loadBundledEnglishInstrument();
    const expected = computeManifestHash(bundled);
    if (en.manifest_hash !== expected) {
      throw badRequest('manifest_hash_drift', {
        stored: en.manifest_hash,
        expected,
      });
    }
  }

  return {
    instrument: {
      ...contentInstrument,
      // Echo participant locale; keep English manifest/scorer for fallback packs.
      locale,
      manifest_hash: contentInstrument.manifest_hash ?? en.manifest_hash,
      item_count: contentInstrument.item_count ?? en.item_count,
      response_scale: contentInstrument.response_scale ?? en.response_scale,
      scorer_id: contentInstrument.scorer_id ?? en.scorer_id,
    },
    items: items.rows.map((item) => ({
      ...item,
      resolved_text: resolveItemText(item, locale),
    })),
  };
}
