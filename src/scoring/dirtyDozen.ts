import { createHash } from 'node:crypto';
import type { ScaleScore } from './ipip50.js';

export const DD_SCORER_ID = 'dirty_dozen_scorer_v1';
export const DD_SCORER_VERSION = 1;
export const DD_EXPECTED_ITEM_COUNT = 12;
export const DD_SCALE_KEYS = [
  'machiavellianism',
  'psychopathy',
  'narcissism',
] as const;

export type DdScoreableItem = {
  itemId: string;
  scaleKey: string;
  keyedDirection: -1 | 1;
};

export function scoreDirtyDozen(
  items: DdScoreableItem[],
  responses: Array<{ itemId: string; value: number }>,
): ScaleScore[] {
  if (items.length !== DD_EXPECTED_ITEM_COUNT) {
    throw new Error('dd_item_count_mismatch');
  }
  if (responses.length !== DD_EXPECTED_ITEM_COUNT) {
    throw new Error('dd_response_count_mismatch');
  }

  const byId = new Map(items.map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  const buckets = new Map<string, number[]>();

  for (const response of responses) {
    if (seen.has(response.itemId)) {
      throw new Error(`duplicate_response:${response.itemId}`);
    }
    seen.add(response.itemId);
    const item = byId.get(response.itemId);
    if (!item) throw new Error(`unknown_item:${response.itemId}`);
    if (response.value < 1 || response.value > 5 || !Number.isInteger(response.value)) {
      throw new Error('invalid_response_value');
    }
    const scored =
      item.keyedDirection === 1 ? response.value : 6 - response.value;
    const list = buckets.get(item.scaleKey) ?? [];
    list.push(scored);
    buckets.set(item.scaleKey, list);
  }

  for (const item of items) {
    if (!seen.has(item.itemId)) throw new Error(`missing_response:${item.itemId}`);
  }

  return DD_SCALE_KEYS.map((scaleKey) => {
    const values = buckets.get(scaleKey) ?? [];
    if (values.length !== 4) {
      throw new Error(`dd_scale_item_count_mismatch:${scaleKey}`);
    }
    const rawSum = values.reduce((a, b) => a + b, 0);
    return {
      scaleKey,
      rawSum,
      meanScore: rawSum / values.length,
      itemCount: values.length,
    };
  });
}

/** Constructive workplace-style classifications for discovery UI (not clinical). */
export function darkTriadClassification(
  scaleKey: string,
  percentile: number,
): { classification: string; framing: string } {
  if (scaleKey === 'machiavellianism') {
    if (percentile >= 70) {
      return {
        classification: 'Strategic / Pragmatic Negotiator',
        framing:
          'Higher strategic deliberation patterns — useful in high-pressure negotiation; watch for over-calculation in trust contexts.',
      };
    }
    if (percentile <= 30) {
      return {
        classification: 'Direct / Low Strategic Maneuvering',
        framing: 'Lower tactical self-presentation — clarity and straightforwardness.',
      };
    }
    return {
      classification: 'Balanced Strategist',
      framing: 'Moderate strategic flexibility without extreme impression management.',
    };
  }
  if (scaleKey === 'narcissism') {
    if (percentile >= 70) {
      return {
        classification: 'Self-Efficacy Centric',
        framing: 'Strong drive for recognition and status — channel into leadership energy.',
      };
    }
    if (percentile <= 30) {
      return {
        classification: 'Low Spotlight Preference',
        framing: 'Lower need for admiration — steady contribution without status seeking.',
      };
    }
    return {
      classification: 'Moderate Self-Regard',
      framing: 'Balanced self-focus and social feedback sensitivity.',
    };
  }
  // psychopathy spectrum as impulse/empathy control framing
  if (percentile >= 70) {
    return {
      classification: 'High Drive / Lower Soft Restraint',
      framing:
        'Faster, less remorse-sensitive patterns under pressure — pair with deliberate pause habits.',
    };
  }
  if (percentile <= 30) {
    return {
      classification: 'High Impulse Control',
      framing: 'Strong restraint and concern for impact — protective in social conflict.',
    };
  }
  return {
    classification: 'Moderate Impulse Control',
    framing: 'Typical balance of drive and social restraint.',
  };
}

export function computeProfileCommitment(payload: unknown): string {
  const canonical = JSON.stringify(payload);
  return `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
}
