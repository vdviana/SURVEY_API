import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildDiscoveryEnrichment,
  withDiscoveryEnrichment,
} from '../../src/scoring/discoveryEnrichment.js';

describe('discoveryEnrichment', () => {
  it('builds intelligence patterns and work fits from existing metrics', () => {
    const enrichment = buildDiscoveryEnrichment({
      ocean: [
        { scaleKey: 'extraversion', label: 'E', meanScore: 4, percentile: 80, band: 'above' },
        { scaleKey: 'agreeableness', label: 'A', meanScore: 4, percentile: 75, band: 'above' },
        { scaleKey: 'conscientiousness', label: 'C', meanScore: 3.5, percentile: 60, band: 'near' },
        {
          scaleKey: 'emotional_stability',
          label: 'ES',
          meanScore: 3,
          percentile: 45,
          band: 'near',
        },
        { scaleKey: 'intellect', label: 'O', meanScore: 4.2, percentile: 85, band: 'high' },
      ],
      darkTriad: [
        {
          scaleKey: 'machiavellianism',
          label: 'S',
          meanScore: 3,
          percentile: 55,
          classification: 'x',
          framing: 'y',
        },
        {
          scaleKey: 'narcissism',
          label: 'R',
          meanScore: 3,
          percentile: 50,
          classification: 'x',
          framing: 'y',
        },
        {
          scaleKey: 'psychopathy',
          label: 'I',
          meanScore: 2,
          percentile: 25,
          classification: 'x',
          framing: 'y',
        },
      ],
      cortical: {
        assertivenessBps: 7800,
        assertivenessPercentile: 72,
        assertivenessBand: 'above',
        sampleCount: 400,
        blockCount: 12,
        regionEffort: { limbico: 0.7, perceptivo: 0.6, mnemico: 0.5, heuristico: 0.8 },
      },
      likert: {
        medianLatencyMs: 700,
        meanLatencyMs: 750,
        itemCount: 62,
        changeCount: 3,
        decisionTempoPercentile: 40,
        decisionTempoBand: 'near',
      },
    });

    assert.equal(enrichment.intelligencePatterns.length, 3);
    assert.ok(enrichment.intelligencePatterns.every((p) => p.index >= 1 && p.index <= 99));
    assert.ok(enrichment.workFits.length >= 1);
    assert.ok(enrichment.affectiveTone.length >= 1);
    assert.match(enrichment.enrichmentNote, /not IQ/i);
  });

  it('preserves base discovery map fields when enriching', () => {
    const enriched = withDiscoveryEnrichment({
      title: 'Deep Mind Auto-Discovery Map',
      ocean: [
        { scaleKey: 'extraversion', label: 'E', meanScore: 3, percentile: 50, band: 'near' },
        { scaleKey: 'agreeableness', label: 'A', meanScore: 3, percentile: 50, band: 'near' },
        { scaleKey: 'conscientiousness', label: 'C', meanScore: 3, percentile: 50, band: 'near' },
        {
          scaleKey: 'emotional_stability',
          label: 'ES',
          meanScore: 3,
          percentile: 50,
          band: 'near',
        },
        { scaleKey: 'intellect', label: 'O', meanScore: 3, percentile: 50, band: 'near' },
      ],
      darkTriad: [],
      cortical: {
        assertivenessBps: 7000,
        assertivenessPercentile: 50,
        assertivenessBand: 'near',
        sampleCount: 10,
        blockCount: 4,
        regionEffort: {},
      },
      likert: {
        medianLatencyMs: 900,
        meanLatencyMs: 900,
        itemCount: 50,
        changeCount: 0,
        decisionTempoPercentile: 50,
        decisionTempoBand: 'near',
      },
      archetype: { name: 'Steady', summary: 'x', superpowers: [], blindSpots: [] },
    });

    assert.equal(enriched.title, 'Deep Mind Auto-Discovery Map');
    assert.ok(Array.isArray(enriched.intelligencePatterns));
    assert.ok(Array.isArray(enriched.ocean));
  });
});
