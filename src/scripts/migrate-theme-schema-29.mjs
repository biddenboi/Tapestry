import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import JSZip from 'jszip';

export const THEME_SCHEMA_VERSION = 29;
export const THEME_ID_MIGRATION = Object.freeze({
  default: 'minimalist',
  pure: 'minimalist_light',
  rose: 'kawaii',
  crimson: 'dreamcore',
  emerald: 'pixelated',
  sand: 'mature_beige',
  paper: 'old_windows',
  violet: 'old_windows',
  shadow: 'obsidian',
  gold: 'gamification',
});

export const CANONICAL_THEME_IDS = new Set([
  'minimalist', 'minimalist_light', 'kawaii', 'dreamcore', 'pixelated',
  'mature_beige', 'old_windows', 'obsidian', 'gamification',
]);

const THEME_LABELS = Object.freeze({
  minimalist: 'Minimalist', minimalist_light: 'Minimalist Light', kawaii: 'Kawaii',
  dreamcore: 'Dreamcore', pixelated: 'Pixelated', mature_beige: 'Mature Beige',
  old_windows: 'Old Windows', obsidian: 'Obsidian', gamification: 'Gamification',
});

export function canonicalThemeId(value) {
  if (CANONICAL_THEME_IDS.has(value)) return value;
  return THEME_ID_MIGRATION[value] || 'minimalist';
}

function migrateObject(value) {
  const sourceType = value.type;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if ((key === 'theme' || key === 'playerTheme' || key === 'requiredTheme') && typeof child === 'string') {
      result[key] = canonicalThemeId(child);
      continue;
    }
    if ((key === 'id' || key === 'itemId') && sourceType === 'cosmetic_theme' && typeof child === 'string') {
      result[key] = canonicalThemeId(child);
      continue;
    }
    result[key] = migrateThemeData(child);
  }
  if (sourceType === 'cosmetic_theme') {
    const id = canonicalThemeId(result.itemId || result.id);
    if ('itemId' in result) result.itemId = id;
    if ('id' in result) result.id = id;
    if (typeof result.name === 'string') result.name = THEME_LABELS[id];
    if (typeof result.label === 'string') result.label = THEME_LABELS[id];
  }
  return result;
}

function dedupeThemeItems(values) {
  const seen = new Map();
  const output = [];
  for (const value of values) {
    if (!value || typeof value !== 'object' || value.type !== 'cosmetic_theme') {
      output.push(value);
      continue;
    }
    const key = `${value.parent || ''}:${value.itemId || value.id || ''}`;
    const prior = seen.get(key);
    if (!prior) {
      seen.set(key, value);
      output.push(value);
      continue;
    }
    prior.quantity = Math.max(Number(prior.quantity) || 0, Number(value.quantity) || 0, 1);
    prior.claimedAt ||= value.claimedAt;
    prior.createdAt ||= value.createdAt;
  }
  return output;
}

export function migrateThemeData(value) {
  if (Array.isArray(value)) return dedupeThemeItems(value.map(migrateThemeData));
  if (!value || typeof value !== 'object') return value;
  return migrateObject(value);
}

export async function migrateThemeArchive(inputPath, outputPath = inputPath) {
  const zip = await JSZip.loadAsync(await readFile(inputPath));
  let updatedFiles = 0;
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir || !name.endsWith('.json') || name.startsWith('__MACOSX/')) continue;
    let parsed;
    try {
      parsed = JSON.parse(await file.async('string'));
    } catch {
      continue;
    }
    zip.file(name, `${JSON.stringify(migrateThemeData(parsed), null, 2)}\n`);
    updatedFiles += 1;
  }
  const tapestryRoot = Object.keys(zip.files).find((name) => name.endsWith('/.tapestry/')) || 'Tapestry Data/.tapestry/';
  zip.file(`${tapestryRoot}schema.json`, `${JSON.stringify({ schemaVersion: THEME_SCHEMA_VERSION, themeProtocol: 'canonical-v1' }, null, 2)}\n`);
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  await writeFile(outputPath, bytes);
  return { outputPath, updatedFiles, schemaVersion: THEME_SCHEMA_VERSION };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3] || inputPath;
  if (!inputPath) throw new Error('Usage: node scripts/migrate-theme-schema-29.mjs <input.zip> [output.zip]');
  const result = await migrateThemeArchive(inputPath, outputPath);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
