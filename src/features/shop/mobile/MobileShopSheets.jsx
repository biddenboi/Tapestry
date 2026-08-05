import { useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { ITEM_TYPE } from '@domain/constants.js';
import { normalizeCosmeticEquipment } from '@domain/cosmetics/CosmeticCatalog.js';
import { getShopItemCost, isCosmeticItem } from '@domain/shop/Shop.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';

function costLabel(item) {
  const cost = getShopItemCost(item);
  return item.currencyType === 'dollars' ? `$${Number(cost).toFixed(2)}` : `◇ ${cost}`;
}

function previewPlayer(player, item) {
  if (!player || !isCosmeticItem(item)) return player;
  const activeCosmetics = { ...normalizeCosmeticEquipment(player.activeCosmetics) };
  const equipment = cosmeticEquipmentForItem(item);
  Object.assign(activeCosmetics, equipment);
  return { ...player, activeCosmetics };
}

function cosmeticEquipmentForItem(item) {
  const id = item?.itemId || item?.cosmeticId || item?.UUID;
  if (!id) return {};
  if (item.type === ITEM_TYPE.cosmetic_theme) return { appTheme: id, profileTheme: id };
  if (item.type === ITEM_TYPE.cosmetic_title) return { title: id };
  if (item.type === ITEM_TYPE.cosmetic_profile_frame) return { avatarFrame: id };
  return {};
}

export default function MobileShopDetailSheet({ payload }) {
  const { currentPlayer, commitCurrentProfile, invalidateDomains } = useAppContext();
  const { closeSurface, presentFeedback } = useMobileSurface();
  const { item, owned, canAdd, onAdd } = payload;
  const cosmetic = isCosmeticItem(item);
  const equipment = cosmeticEquipmentForItem(item);
  const equippable = Object.keys(equipment).length > 0;
  const activeCosmetics = normalizeCosmeticEquipment(currentPlayer?.activeCosmetics);
  const equipped = equippable && Object.entries(equipment).every(([slot, id]) => activeCosmetics[slot] === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const equip = async () => {
    if (!owned || !equippable || busy) return;
    setBusy(true);
    setError('');
    try {
      await commitCurrentProfile({ ...currentPlayer, activeCosmetics: { ...activeCosmetics, ...equipment } });
      invalidateDomains(DOMAIN_INVALIDATION.profileWrite);
      presentFeedback?.(simpleMobileFeedback('cosmetic-equipped', `${item.name} applied`, { significance: 'meaningful', sourceId: item.UUID }));
      await payload.onEquipped?.();
      closeSurface({ force: true });
    } catch (equipError) {
      setError(equipError?.message || 'This appearance could not be applied.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="mobile-sheet mobile-shop-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-shop-detail-title">
      <header><div><span>{item.category || 'Reward'}</span><h2 id="mobile-shop-detail-title">{item.name}</h2></div><button type="button" onClick={() => closeSurface()}>Close</button></header>
      <div className="mobile-sheet-scroll">
        <div className="mobile-shop-detail-preview">
          {cosmetic ? <ProfileIdentity player={previewPlayer(currentPlayer, item)} rank="compact" avatarSize={64} /> : <span aria-hidden="true">{String(item.name || 'I').charAt(0).toUpperCase()}</span>}
        </div>
        <p>{item.description || 'No description provided.'}</p>
        <dl className="mobile-shop-detail-facts">
          <div><dt>Type</dt><dd>{cosmetic ? 'Permanent cosmetic unlock' : item.type === ITEM_TYPE.duration ? `${item.duration || 0} minute effect` : `${item.quantity || 1} per purchase`}</dd></div>
          <div><dt>Cost</dt><dd>{costLabel(item)}</dd></div>
        </dl>
        {cosmetic && owned && <div className="mobile-owned-note"><strong>{equipped ? 'Equipped' : 'Owned'}</strong><span>{equippable ? 'Apply this appearance on phone and desktop.' : 'Open Appearance Studio on desktop to choose a preset from this unlocked pack.'}</span></div>}
        {error && <div className="mobile-sheet-error" role="alert">{error}</div>}
      </div>
      <footer>{cosmetic && owned ? <button type="button" className={equipped ? '' : 'primary'} disabled={!equippable || equipped || busy} onClick={equip}>{busy ? 'Applying…' : equipped ? 'Equipped' : equippable ? 'Equip now' : 'Owned'}</button> : <button type="button" className="primary" disabled={!canAdd} onClick={() => { onAdd(item); closeSurface({ force: true }); }}>Add to cart · {costLabel(item)}</button>}</footer>
    </article>
  );
}
