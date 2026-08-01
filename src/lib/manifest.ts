import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type ManifestItem = {
  itemId: string;
  sequenceIndex: number;
  itemTextEn: string;
  scaleKey: string;
  keyedDirection: -1 | 1;
};

export type InstrumentSeed = {
  instrumentCode: string;
  instrumentVersion: number;
  locale: string;
  responseScale: {
    min: number;
    max: number;
    anchors: Record<string, string>;
  };
  items: ManifestItem[];
};

export function computeManifestHash(seed: InstrumentSeed): string {
  const canonical = {
    instrumentCode: seed.instrumentCode,
    instrumentVersion: seed.instrumentVersion,
    locale: seed.locale,
    responseScale: seed.responseScale,
    items: seed.items
      .slice()
      .sort((a, b) => a.sequenceIndex - b.sequenceIndex)
      .map((item) => ({
        itemId: item.itemId,
        sequenceIndex: item.sequenceIndex,
        itemTextEn: item.itemTextEn,
        scaleKey: item.scaleKey,
        keyedDirection: item.keyedDirection,
      })),
  };
  const digest = createHash('sha256')
    .update(JSON.stringify(canonical), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

export function loadBundledEnglishInstrument(): InstrumentSeed {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(
    here,
    '..',
    '..',
    '..',
    'DATABASE',
    'seed',
    'ipip_bfm_50_en.json',
  );
  return JSON.parse(readFileSync(path, 'utf8')) as InstrumentSeed;
}
