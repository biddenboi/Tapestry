import '@features/inventory/pages/Inventory/Inventory.css';
import { useState, useEffect, useCallback } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { STORES } from '@domain/constants.js';
import NiceModal from '@ebay/nice-modal-react';
import InventoryItemPopup from '@features/inventory/modals/InventoryItemPopup/InventoryItemPopup.jsx';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import {
  canUseInventoryItem,
  getInventoryItemCooldown,
  isConsumableInventoryItem,
} from '@domain/shop/Shop.js';
import { formatDuration } from '@domain/time/Time.js';
import EmptyState from '@shared/ui/EmptyState.jsx';
import PageHeader from '@shared/ui/PageHeader.jsx';
import SectionTabs from '@shared/ui/SectionTabs.jsx';
import useProgressiveList from '@shared/ui/useProgressiveList.js';

function InventoryItemImage({ item }) {
  const imageUrl = item?.bannerImageUrl;
  const label = String(item?.name || 'Item').trim().charAt(0).toUpperCase() || 'I';

  return (
    <div className={`inv-card-media ${imageUrl ? 'has-image' : ''}`} aria-hidden="true">
      {imageUrl
        ? <ResourceImage value={imageUrl} alt="" />
        : <span>{label}</span>}
    </div>
  );
}

function InventoryCard({ item, onConsume }) {
  const isEmpty = item.quantity <= 0;
  const cooldown = getInventoryItemCooldown(item);
  const usable = canUseInventoryItem(item);
  return (
    <div
      className={`inv-card ${isEmpty ? 'depleted' : ''} ${cooldown.active ? 'on-cooldown' : ''}`}
      onClick={() => usable && onConsume(item)}
      title={isEmpty ? 'Depleted' : cooldown.active ? 'Item is on cooldown' : 'Click to use'}
    >
      <InventoryItemImage item={item} />
      <div className="inv-card-body">
        <span className="inv-card-name">{item.name}</span>
        <span className="inv-card-cat">{item.category || item.type}</span>
        {item.type === 'duration' && item.duration && (
          <span className="inv-card-meta">{item.duration} min</span>
        )}
        {cooldown.active && (
          <span className="inv-card-meta inv-card-meta--cooldown">
            {formatDuration(cooldown.remainingMs)} cooldown
          </span>
        )}
        <span className="inv-card-history">
          Used {Number(item.useCount || 0)} time{Number(item.useCount || 0) === 1 ? '' : 's'}
          {item.lastUsedAt ? ` · ${new Date(item.lastUsedAt).toLocaleDateString()}` : ''}
        </span>
      </div>
      <div className="inv-card-qty">
        <span className="qty-value">{item.quantity}</span>
        <span className="qty-label">Owned</span>
      </div>
      {usable && <div className="inv-card-hover-hint">Use item</div>}
    </div>
  );
}

function ProgressiveInventoryGrid({ items, renderItem }) {
  const { visibleItems, sentinelRef, hasMore } = useProgressiveList(items, 20);

  return (
    <div className="inv-grid">
      {visibleItems.map(renderItem)}
      {hasMore && (
        <div ref={sentinelRef} className="inv-list-sentinel">
          Loading more items.
        </div>
      )}
    </div>
  );
}

function Inventory() {
  const {
    databaseConnection,
    currentPlayer: appCurrentPlayer,
    domainRevisions,
    openInventoryPanel,
  } = useAppContext();
  const [inventory, setInventory]     = useState([]);
  const [filter, setFilter]           = useState('All');
  const playerUUID = appCurrentPlayer?.UUID || null;

  const reload = useCallback(async () => {
    if (!playerUUID) {
      setInventory([]);
      return;
    }
    const repository = databaseConnection.getRepository?.('inventory');
    const items = repository?.getConsumablesByPlayer
      ? await repository.getConsumablesByPlayer(playerUUID)
      : await databaseConnection.getPlayerStore(STORES.inventory, playerUUID);
    setInventory(items.filter(isConsumableInventoryItem));
  }, [databaseConnection, playerUUID]);

  useEffect(() => { reload(); }, [reload, domainRevisions.inventory]);

  const handleConsume = (item) => {
    NiceModal.show(InventoryItemPopup, { item, onConsumed: reload });
  };

  const visibleInventory = inventory.filter(isConsumableInventoryItem);
  const categories = ['All', ...new Set(visibleInventory.map((item) => item.category || item.type).filter(Boolean))];
  const filtered = filter === 'All'
    ? visibleInventory
    : visibleInventory.filter((item) => (item.category || item.type) === filter);

  const activeItems   = filtered.filter((i) => i.quantity > 0);
  const depletedItems = filtered.filter((i) => i.quantity <= 0);

  return (
    <div className="inventory-page">
      <PageHeader
        eyebrow="Owned rewards"
        title="Inventory"
        className="inv-header"
        actions={(
          <div className="inv-header-actions">
            <span className="inv-token-badge"><span className="cost-icon">◈</span>{appCurrentPlayer?.tokens ?? 0}</span>
            <button type="button" className="inv-shop-btn" onClick={() => openInventoryPanel('shop')}>
              Open shop
            </button>
            <button type="button" className="inv-shop-btn inv-pass-btn" onClick={() => openInventoryPanel('pass')}>
              View pass
            </button>
          </div>
        )}
      />
      <SectionTabs
        className="inv-filter-nav"
        items={categories.map((category) => ({ id: category, label: category }))}
        value={filter}
        onChange={setFilter}
        label="Inventory categories"
      />

      <div className="inv-body">
        {visibleInventory.length === 0 ? (
          <EmptyState
            icon="◇"
            title="Inventory is empty."
            description="Buy a reward in the shop to add it here."
            action={<button type="button" className="primary" onClick={() => openInventoryPanel('shop')}>Open shop</button>}
            className="inv-empty"
          />
        ) : (
          <>
            {activeItems.length > 0 && (
              <section className="inv-section">
                <div className="inv-section-label">Available</div>
                <ProgressiveInventoryGrid
                  items={activeItems}
                  renderItem={(item) => <InventoryCard key={item.UUID} item={item} onConsume={handleConsume} />}
                />
              </section>
            )}
            {depletedItems.length > 0 && (
              <section className="inv-section">
                <div className="inv-section-label depleted-label">Depleted</div>
                <ProgressiveInventoryGrid
                  items={depletedItems}
                  renderItem={(item) => <InventoryCard key={item.UUID} item={item} onConsume={handleConsume} />}
                />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default Inventory;
