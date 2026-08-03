import { useMemo, useState } from 'react';
import {
  COSMETIC_SLOT_GROUPS,
  DEFAULT_COSMETIC_EQUIPMENT,
  getCosmeticDefinitionsForSlot,
  normalizeCosmeticEquipment,
  cosmeticInventoryId,
} from '@domain/cosmetics/CosmeticCatalog.js';
import PresetCosmeticSurface from '@shared/cosmetics/PresetCosmeticSurface.jsx';
import './AppearanceStudio.css';

const CORE_SURFACE_PRESETS = new Set(['deep-ocean', 'midnight', 'crimson-night', 'forest', 'galaxy', 'void-ember', 'slate', 'aurora']);
const LEGACY_PASS_BY_SLOT = Object.freeze({ matchCard: 'card_banner', lobbyCard: 'lobby_banner', profileBackdrop: 'profile_banner' });
const CLASSIC_PACK_BY_SLOT = Object.freeze({ matchCard: 'preset-pack:match-card-classics', lobbyCard: 'preset-pack:lobby-card-classics', profileBackdrop: 'preset-pack:profile-backdrop-classics' });
const LEGACY_LAYOUT_THEME = Object.freeze({
  nocturne: 'obsidian', terminal: 'pixelated', zine: 'old_windows', paper: 'old_windows',
  gallery: 'minimalist_light', imperial: 'gamification', crimson: 'dreamcore',
});

function ownsDefinition(definition, inventoryIds, equipment) {
  if (!definition) return false;
  if (definition.id === DEFAULT_COSMETIC_EQUIPMENT[definition.equipSlot]) return true;
  if (equipment[definition.equipSlot] === definition.id) return true;
  if (inventoryIds.has(cosmeticInventoryId(definition.equipSlot, definition.id))) return true;
  if (['appTheme', 'profileTheme'].includes(definition.equipSlot) && inventoryIds.has(definition.id)) return true;
  if (definition.equipSlot === 'profileLayout' && inventoryIds.has(LEGACY_LAYOUT_THEME[definition.id])) return true;
  const legacyPass = LEGACY_PASS_BY_SLOT[definition.equipSlot];
  if (legacyPass && inventoryIds.has(legacyPass) && CORE_SURFACE_PRESETS.has(definition.id)) return true;
  const classicPack = CLASSIC_PACK_BY_SLOT[definition.equipSlot];
  if (classicPack && inventoryIds.has(classicPack) && CORE_SURFACE_PRESETS.has(definition.id)) return true;
  return inventoryIds.has(`preset-pack:${definition.setId}`) || inventoryIds.has(definition.setId);
}

function CosmeticPreview({ definition }) {
  if (['appTheme', 'profileTheme', 'profileLayout'].includes(definition.equipSlot)) {
    return <div className="appearance-studio__theme-preview" style={{ '--preview-accent': definition.tokens?.accent || 'var(--accent)' }}><i /><i /><i /><span>{definition.label.slice(0, 2).toUpperCase()}</span></div>;
  }
  return <PresetCosmeticSurface className="appearance-studio__surface-preview" slot={definition.equipSlot} cosmeticId={definition.id}><span>{definition.label.slice(0, 1)}</span><i /></PresetCosmeticSurface>;
}

export default function AppearanceStudio({ player, inventory = [], onEquip, onReset, onSaveLoadout, onApplyLoadout }) {
  const [groupId, setGroupId] = useState('app');
  const [ownedOnly, setOwnedOnly] = useState(false);
  const equipment = useMemo(() => normalizeCosmeticEquipment(player?.activeCosmetics, { profileLayout: player?.profilePersonalization?.skin }), [player]);
  const inventoryIds = useMemo(() => new Set(inventory.flatMap((item) => [item.itemId, item.id, item.name].filter(Boolean).map(String))), [inventory]);
  const group = COSMETIC_SLOT_GROUPS.find((entry) => entry.id === groupId) || COSMETIC_SLOT_GROUPS[0];
  return (
    <div className="appearance-studio">
      <header className="appearance-studio__intro"><div><span>PRESET APPEARANCE SYSTEM</span><h2>Appearance Studio</h2><p>App, profile, identity, social, and competition surfaces equip independently. Rank remains the automatic outer frame.</p></div><label><input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} /> Owned only</label></header>
      <nav className="appearance-studio__tabs" aria-label="Appearance groups">{COSMETIC_SLOT_GROUPS.map((entry) => <button type="button" key={entry.id} className={entry.id === group.id ? 'is-active' : ''} onClick={() => setGroupId(entry.id)}>{entry.label}</button>)}</nav>
      <div className="appearance-studio__loadouts"><span>IDENTITY LOADOUTS</span><button type="button" onClick={() => onApplyLoadout?.(0)} disabled={!player?.identityLoadouts?.[0]}>Apply I</button><button type="button" onClick={() => onSaveLoadout?.(0)}>Save I</button><button type="button" onClick={() => onApplyLoadout?.(1)} disabled={!player?.identityLoadouts?.[1]}>Apply II</button><button type="button" onClick={() => onSaveLoadout?.(1)}>Save II</button></div>
      <div className="appearance-studio__slots">{group.slots.filter((slot) => getCosmeticDefinitionsForSlot(slot).length > 0).map((slot) => {
        const definitions = getCosmeticDefinitionsForSlot(slot).filter((definition) => !ownedOnly || ownsDefinition(definition, inventoryIds, equipment));
        return <section key={slot} className="appearance-studio__slot"><header><div><span>{slot.replace(/([A-Z])/g, ' $1').toUpperCase()}</span><strong>{definitions.find((definition) => definition.id === equipment[slot])?.label || equipment[slot] || 'Default'}</strong></div><button type="button" onClick={() => onReset?.(slot)}>Reset</button></header><div className="appearance-studio__grid">{definitions.map((definition) => {
          const owned = ownsDefinition(definition, inventoryIds, equipment);
          const active = equipment[slot] === definition.id;
          return <button type="button" key={`${slot}:${definition.id}`} className={`${active ? 'is-active' : ''} ${owned ? '' : 'is-locked'}`} onClick={() => owned && onEquip?.(slot, definition.id)} disabled={!owned} aria-pressed={active}><CosmeticPreview definition={definition} /><span><strong>{definition.label}</strong><small>{definition.description}</small></span>{active ? <b>APPLIED</b> : owned ? <b>EQUIP</b> : <b>ROAD</b>}</button>;
        })}</div></section>;
      })}</div>
    </div>
  );
}
