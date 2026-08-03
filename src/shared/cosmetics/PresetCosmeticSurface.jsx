import { getCosmeticDefinition, cosmeticPresentationStyle } from '@domain/cosmetics/CosmeticCatalog.js';
import './PresetCosmeticSurface.css';

const PRESET_ASSETS = import.meta.glob('./presets/*/*.svg', {
  eager: true,
  query: '?url',
  import: 'default',
});
const PRESET_MANIFEST_MODULES = import.meta.glob('./presets/*/manifest.json', {
  eager: true,
  import: 'default',
});
const PRESET_MANIFESTS = new Map(Object.values(PRESET_MANIFEST_MODULES).map((manifest) => [manifest.id, Object.freeze(manifest)]));

export function validateBundledPresetManifests() {
  const errors = [];
  for (const [id, manifest] of PRESET_MANIFESTS) {
    if (!manifest.version || !manifest.label || !manifest.description) errors.push(`${id}: incomplete manifest metadata`);
    if (!Array.isArray(manifest.equipSlots) || !manifest.equipSlots.length) errors.push(`${id}: no equip slots`);
    for (const variant of ['default', 'compact', 'preview']) {
      const asset = manifest.assets?.[variant];
      if (!asset || !PRESET_ASSETS[`./presets/${id}/${asset}`]) errors.push(`${id}: missing ${variant} asset`);
    }
    if (!manifest.fallbackId || manifest.reducedMotion == null) errors.push(`${id}: missing fallback or reduced-motion contract`);
  }
  return Object.freeze({ valid: errors.length === 0, manifestCount: PRESET_MANIFESTS.size, errors });
}

const bundledPresetValidation = validateBundledPresetManifests();
if (!bundledPresetValidation.valid) throw new Error(`Invalid bundled cosmetic presets: ${bundledPresetValidation.errors.join('; ')}`);

function resolvePresetAsset(assetPath) {
  if (!assetPath) return null;
  return PRESET_ASSETS[`./presets/${assetPath}`] || null;
}

export function getPresetCosmeticPresentation(slot, id, variant = 'default') {
  const definition = getCosmeticDefinition(slot, id);
  const manifest = PRESET_MANIFESTS.get(definition?.setId || definition?.id);
  const manifestAsset = manifest?.assets?.[variant] || manifest?.assets?.default;
  const asset = resolvePresetAsset(manifestAsset ? `${manifest.id}/${manifestAsset}` : (definition?.assets?.[variant] || definition?.assets?.default));
  return {
    definition,
    manifest,
    asset,
    style: cosmeticPresentationStyle(slot, definition?.id || id),
  };
}

export default function PresetCosmeticSurface({
  as: Component = 'div',
  slot,
  cosmeticId,
  variant = 'default',
  className = '',
  children,
  style,
  ...props
}) {
  const presentation = getPresetCosmeticPresentation(slot, cosmeticId, variant);
  return (
    <Component
      {...props}
      className={`preset-cosmetic-surface preset-cosmetic-surface--${slot} ${className}`.trim()}
      data-cosmetic-slot={slot}
      data-cosmetic-id={presentation.definition?.id || 'default'}
      style={{ ...presentation.style, ...style }}
    >
      {presentation.asset && <img className="preset-cosmetic-surface__asset" src={presentation.asset} alt="" aria-hidden="true" />}
      <div className="preset-cosmetic-surface__content">{children}</div>
    </Component>
  );
}
