import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  reverseScore,
  scoreIpip50,
  EXPECTED_ITEM_COUNT,
} from '../../src/scoring/ipip50.js';
import {
  computeManifestHash,
  loadBundledEnglishInstrument,
} from '../../src/lib/manifest.js';

test('reverseScore flips negative-keyed items', () => {
  assert.equal(reverseScore(1, 1), 1);
  assert.equal(reverseScore(5, 1), 5);
  assert.equal(reverseScore(1, -1), 5);
  assert.equal(reverseScore(5, -1), 1);
  assert.equal(reverseScore(3, -1), 3);
});

test('bundled English manifest has 50 items and stable hash', () => {
  const seed = loadBundledEnglishInstrument();
  assert.equal(seed.items.length, EXPECTED_ITEM_COUNT);
  const hash = computeManifestHash(seed);
  assert.equal(
    hash,
    'sha256:a388261371bdacca885283cf268e47f0d7f912b4dafe71ffef0ffca46a7cc834',
  );
});

test('scoreIpip50 rejects incomplete sets and scores complete sets', () => {
  const seed = loadBundledEnglishInstrument();
  const items = seed.items.map((item) => ({
    itemId: item.itemId,
    scaleKey: item.scaleKey,
    keyedDirection: item.keyedDirection,
  }));

  assert.throws(
    () => scoreIpip50(items, [{ itemId: 'ipip50_01', value: 5 }]),
    /response_count_mismatch/,
  );

  const responses = seed.items.map((item) => ({
    itemId: item.itemId,
    value: 5 as number,
  }));
  const scores = scoreIpip50(items, responses);
  assert.equal(scores.length, 5);
  for (const score of scores) {
    assert.equal(score.itemCount, 10);
    assert.ok(score.rawSum >= 10 && score.rawSum <= 50);
    assert.ok(score.meanScore >= 1 && score.meanScore <= 5);
  }

  const extraversion = scores.find((s) => s.scaleKey === 'extraversion');
  // 5 +keyed at 5 => 25; 5 -keyed at reverse(5)=1 => 5; total 30
  assert.equal(extraversion?.rawSum, 30);
});

test('scoreIpip50 rejects unknown and duplicate items', () => {
  const seed = loadBundledEnglishInstrument();
  const items = seed.items.map((item) => ({
    itemId: item.itemId,
    scaleKey: item.scaleKey,
    keyedDirection: item.keyedDirection,
  }));
  const responses = seed.items.map((item) => ({
    itemId: item.itemId,
    value: 3,
  }));
  responses[0] = { itemId: 'nope', value: 3 };
  assert.throws(() => scoreIpip50(items, responses), /unknown_item/);

  const dup = seed.items.map((item) => ({
    itemId: item.itemId,
    value: 3,
  }));
  dup[1] = { itemId: dup[0].itemId, value: 4 };
  assert.throws(() => scoreIpip50(items, dup), /duplicate_response|missing_response/);
});
