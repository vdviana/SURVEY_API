export type ScoreableItem = {
  itemId: string;
  scaleKey: string;
  keyedDirection: -1 | 1;
};

export type ResponseValue = {
  itemId: string;
  value: number;
};

export type ScaleScore = {
  scaleKey: string;
  rawSum: number;
  meanScore: number;
  itemCount: number;
};

export const SCORER_ID = 'ipip_bfm_50_scorer_v1';
export const SCORER_VERSION = 1;
export const EXPECTED_ITEM_COUNT = 50;
export const SCALE_KEYS = [
  'extraversion',
  'agreeableness',
  'conscientiousness',
  'emotional_stability',
  'intellect',
] as const;

export function reverseScore(value: number, keyedDirection: -1 | 1): number {
  if (value < 1 || value > 5 || !Number.isInteger(value)) {
    throw new Error('invalid_response_value');
  }
  return keyedDirection === 1 ? value : 6 - value;
}

/**
 * Server-side IPIP-50 scoring. Raw evidence must already be complete and valid.
 * Returns research scores only — no clinical cutoffs or labels.
 */
export function scoreIpip50(
  items: ScoreableItem[],
  responses: ResponseValue[],
): ScaleScore[] {
  if (items.length !== EXPECTED_ITEM_COUNT) {
    throw new Error('instrument_item_count_mismatch');
  }
  if (responses.length !== EXPECTED_ITEM_COUNT) {
    throw new Error('response_count_mismatch');
  }

  const byId = new Map(items.map((item) => [item.itemId, item]));
  const seen = new Set<string>();
  const buckets = new Map<string, number[]>();

  for (const response of responses) {
    if (seen.has(response.itemId)) {
      throw new Error(`duplicate_response:${response.itemId}`);
    }
    seen.add(response.itemId);
    const item = byId.get(response.itemId);
    if (!item) {
      throw new Error(`unknown_item:${response.itemId}`);
    }
    const scored = reverseScore(response.value, item.keyedDirection);
    const list = buckets.get(item.scaleKey) ?? [];
    list.push(scored);
    buckets.set(item.scaleKey, list);
  }

  for (const item of items) {
    if (!seen.has(item.itemId)) {
      throw new Error(`missing_response:${item.itemId}`);
    }
  }

  return SCALE_KEYS.map((scaleKey) => {
    const values = buckets.get(scaleKey) ?? [];
    if (values.length !== 10) {
      throw new Error(`scale_item_count_mismatch:${scaleKey}`);
    }
    const rawSum = values.reduce((a, b) => a + b, 0);
    return {
      scaleKey,
      rawSum,
      meanScore: Number((rawSum / values.length).toFixed(4)),
      itemCount: values.length,
    };
  });
}
