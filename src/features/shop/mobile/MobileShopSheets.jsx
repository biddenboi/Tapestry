import { useAppContext } from '@app/hooks/useAppContext.js';
import { ITEM_TYPE } from '@domain/constants.js';
import { getShopItemCost, isCosmeticItem } from '@domain/shop/Shop.js';
import ProfileIdentity from '@shared/profile-identity/ProfileIdentity.jsx';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';

function costLabel(item) {
  const cost = getShopItemCost(item);
  return item.currencyType === 'dollars' ? `$${Number(cost).toFixed(2)}` : `◇ ${cost}`;
}

function previewPlayer(player, item) {
  if (!player || !isCosmeticItem(item)) return player;
  const activeCosmetics = { ...(player.activeCosmetics || {}) };
  if (item.type === 'cosmetic_title') activeCosmetics.title = item.itemId || item.UUID;
  else if (item.type === 'cosmetic_frame') activeCosmetics.avatarFrame = item.itemId || item.UUID;
  else if (item.type === 'cosmetic_banner') activeCosmetics.cardBanner = item.itemId || item.UUID;
  return { ...player, activeCosmetics };
}

export default function MobileShopDetailSheet({ payload }) {
  const { currentPlayer } = useAppContext();
  const { closeSurface } = useMobileSurface();
  const { item, owned, canAdd, onAdd } = payload;
  const cosmetic = isCosmeticItem(item);
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
        {cosmetic && owned && <div className="mobile-owned-note"><strong>Owned</strong><span>Configure on desktop. Your equipped choice renders on mobile.</span></div>}
      </div>
      <footer>{cosmetic && owned ? <button type="button" disabled>Owned</button> : <button type="button" className="primary" disabled={!canAdd} onClick={() => { onAdd(item); closeSurface({ force: true }); }}>Add to cart · {costLabel(item)}</button>}</footer>
    </article>
  );
}
