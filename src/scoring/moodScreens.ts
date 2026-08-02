import type { ScaleScore } from './ipip50.js';

export const PHQ9_SCORER_ID = 'phq9_scorer_v1';
export const PHQ9_SCORER_VERSION = 1;
export const PHQ9_EXPECTED_ITEM_COUNT = 9;

export const GAD7_SCORER_ID = 'gad7_scorer_v1';
export const GAD7_SCORER_VERSION = 1;
export const GAD7_EXPECTED_ITEM_COUNT = 7;

export type MoodScoreableItem = {
  itemId: string;
  scaleKey: string;
};

export type MoodBand =
  | 'minimal'
  | 'mild'
  | 'moderate'
  | 'moderately_severe'
  | 'severe';

export type PossibleMoodFlag = {
  instrument: 'phq9' | 'gad7';
  rawSum: number;
  maxSum: number;
  band: MoodBand;
  /** Research language: possible elevated pattern — never a confirmation. */
  possiblePattern: string;
  elevatedPossible: boolean;
  selfHarmItemFlagged?: boolean;
  crisisNote?: string;
};

function assertFrequency0to3(value: number) {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new Error('invalid_mood_response_value');
  }
}

function scoreFrequencyTotal(
  expectedCount: number,
  scaleKey: string,
  items: MoodScoreableItem[],
  responses: Array<{ itemId: string; value: number }>,
): ScaleScore {
  if (items.length !== expectedCount) throw new Error('mood_item_count_mismatch');
  if (responses.length !== expectedCount) throw new Error('mood_response_count_mismatch');

  const byId = new Map(items.map((i) => [i.itemId, i]));
  const seen = new Set<string>();
  let rawSum = 0;

  for (const response of responses) {
    if (seen.has(response.itemId)) throw new Error(`duplicate_response:${response.itemId}`);
    seen.add(response.itemId);
    const item = byId.get(response.itemId);
    if (!item) throw new Error(`unknown_item:${response.itemId}`);
    if (item.scaleKey !== scaleKey) throw new Error(`scale_mismatch:${response.itemId}`);
    assertFrequency0to3(response.value);
    rawSum += response.value;
  }

  for (const item of items) {
    if (!seen.has(item.itemId)) throw new Error(`missing_response:${item.itemId}`);
  }

  return {
    scaleKey,
    rawSum,
    meanScore: rawSum / expectedCount,
    itemCount: expectedCount,
  };
}

export function scorePhq9(
  items: MoodScoreableItem[],
  responses: Array<{ itemId: string; value: number }>,
): ScaleScore[] {
  return [scoreFrequencyTotal(PHQ9_EXPECTED_ITEM_COUNT, 'phq9_total', items, responses)];
}

export function scoreGad7(
  items: MoodScoreableItem[],
  responses: Array<{ itemId: string; value: number }>,
): ScaleScore[] {
  return [scoreFrequencyTotal(GAD7_EXPECTED_ITEM_COUNT, 'gad7_total', items, responses)];
}

export function phq9Band(rawSum: number): MoodBand {
  if (rawSum >= 20) return 'severe';
  if (rawSum >= 15) return 'moderately_severe';
  if (rawSum >= 10) return 'moderate';
  if (rawSum >= 5) return 'mild';
  return 'minimal';
}

export function gad7Band(rawSum: number): MoodBand {
  if (rawSum >= 15) return 'severe';
  if (rawSum >= 10) return 'moderate';
  if (rawSum >= 5) return 'mild';
  return 'minimal';
}

export function interpretPhq9(
  rawSum: number,
  item9Value: number,
): PossibleMoodFlag {
  const band = phq9Band(rawSum);
  const elevatedPossible = rawSum >= 10;
  const selfHarmItemFlagged = item9Value >= 1;
  return {
    instrument: 'phq9',
    rawSum,
    maxSum: 27,
    band,
    elevatedPossible,
    selfHarmItemFlagged,
    possiblePattern: elevatedPossible
      ? `Possible elevated depressive-symptom pattern (${band.replace('_', ' ')}) — screening signal only, not a clinical confirmation of depression.`
      : `Depressive-symptom screen in the ${band} range vs common cutoffs — not a diagnosis; ordinary fluctuation is common.`,
    crisisNote: selfHarmItemFlagged
      ? 'You marked some frequency on the self-harm thought item. This app cannot help in a crisis. If you might hurt yourself, contact local emergency services or a trusted person now.'
      : undefined,
  };
}

export function interpretGad7(rawSum: number): PossibleMoodFlag {
  const band = gad7Band(rawSum);
  const elevatedPossible = rawSum >= 10;
  return {
    instrument: 'gad7',
    rawSum,
    maxSum: 21,
    band,
    elevatedPossible,
    possiblePattern: elevatedPossible
      ? `Possible elevated anxiety-symptom pattern (${band}) — screening signal only, not a clinical confirmation of an anxiety disorder.`
      : `Anxiety-symptom screen in the ${band} range vs common cutoffs — not a diagnosis.`,
  };
}
