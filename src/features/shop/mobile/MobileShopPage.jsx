import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { v4 as uuid } from 'uuid';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { ITEM_TYPE } from '@domain/constants.js';
import {
  canPurchaseShopItem,
  canUseInventoryItem,
  findInventoryForShopItem,
  getInventoryItemCooldown,
  getShopItemAvailabilityLabel,
  getShopItemCost,
  isCosmeticItem,
  isConsumableInventoryItem,
  SHOP_CATEGORIES,
  sortShopCatalog,
} from '@domain/shop/Shop.js';
import { commitShopPurchase, reconcileShopAuthority } from '@domain/shop/ShopPurchaseService.js';
import { processShopPurchaseSecondaryEffects } from '@domain/shop/ShopPurchaseEffects.js';
import { activateShopItemCommand } from '@domain/shop/ShopActivationService.js';
import getSupabaseAuthService from '@data/sync/supabase/SupabaseAuthService.js';
import { useMobileSurface } from '@app/mobile/MobileSurfaceContext.jsx';
import { simpleMobileFeedback } from '@app/mobile/application/MobileFeedback.js';
import { queryMobileShopState } from '@app/mobile/application/MobileShopQueryService.js';
import { requestPromptReferenceSync } from '@data/sync/ReferenceSyncLanes.js';

const authService = getSupabaseAuthService();
const MODES = Object.freeze(['browse', 'inventory', 'cart']);

function costLabel(item, quantity = 1) {
  const cost = getShopItemCost(item) * quantity;
  return item.currencyType === 'dollars' ? `$${Number(cost).toFixed(2)}` : `◇ ${cost}`;
}

function itemUnit(item) {
  if (isCosmeticItem(item)) return 'Permanent unlock';
  if (item.type === ITEM_TYPE.duration) return `${item.duration || 0} min`;
  return `×${item.quantity || 1}`;
}

function itemsMatch(left, right) {
  return left?.UUID && right?.UUID ? String(left.UUID) === String(right.UUID) : left?.name === right?.name;
}

export default function MobileShopPage() {
  const {
    databaseConnection,
    currentPlayer,
    updateCurrentPlayer,
    ensureDomainLoaded,
    domainRevisions,
    invalidateDomains,
    notify,
  } = useAppContext();
  const { openSurface, presentFeedback } = useMobileSurface();
  const auth = useSyncExternalStore(authService.subscribe, authService.getSnapshot, authService.getSnapshot);
  const [mode, setMode] = useState('browse');
  const [category, setCategory] = useState('All');
  const [catalog, setCatalog] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [money, setMoney] = useState(0);
  const [cart, setCart] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyItem, setBusyItem] = useState(null);
  const [error, setError] = useState('');
  const purchaseOnline = !auth.configured || auth.syncStatus === 'ready';

  useEffect(() => {
    void authService.initialize().catch((initializeError) => {
      setError(initializeError?.message || 'Private purchase status is unavailable.');
    });
  }, []);

  const load = useCallback(async () => {
    if (!currentPlayer?.UUID) return;
    setLoading(true);
    try {
      await ensureDomainLoaded?.(['shop', 'inventory']);
      const state = await queryMobileShopState(databaseConnection, {
        playerUUID: currentPlayer.UUID,
      });
      setCatalog(sortShopCatalog(state.catalog));
      setInventory(state.inventory);
      setMoney(state.money);
    } catch (loadError) {
      setError(loadError?.message || 'The Shop could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [currentPlayer?.UUID, databaseConnection, ensureDomainLoaded]);

  useEffect(() => { void load(); }, [load, domainRevisions.shop, domainRevisions.inventory]);

  const filteredCatalog = useMemo(() => category === 'All'
    ? catalog
    : catalog.filter((item) => item.category === category), [catalog, category]);
  const consumables = useMemo(() => inventory.filter(isConsumableInventoryItem).filter((item) => Number(item.quantity || 0) > 0), [inventory]);
  const cartCount = cart.reduce((sum, entry) => sum + entry.qty, 0);
  const tokenTotal = cart.filter(({ item }) => item.currencyType !== 'dollars').reduce((sum, entry) => sum + getShopItemCost(entry.item) * entry.qty, 0);
  const dollarTotal = cart.filter(({ item }) => item.currencyType === 'dollars').reduce((sum, entry) => sum + getShopItemCost(entry.item) * entry.qty, 0);
  const canAfford = Number(currentPlayer?.tokens || 0) >= tokenTotal && money >= dollarTotal;

  const cartQuantity = (item) => cart.find((entry) => itemsMatch(entry.item, item))?.qty || 0;
  const canAdd = (item) => purchaseOnline && canPurchaseShopItem(item, findInventoryForShopItem(inventory, item), new Date(), cartQuantity(item));

  const add = (item) => {
    if (!canAdd(item)) return;
    setCart((entries) => {
      const existing = entries.find((entry) => itemsMatch(entry.item, item));
      if (existing) return entries.map((entry) => itemsMatch(entry.item, item) ? { ...entry, qty: entry.qty + 1 } : entry);
      return [...entries, { item, qty: 1 }];
    });
    presentFeedback(simpleMobileFeedback('item-added', `${item.name} added to cart`, { sourceId: item.UUID }));
  };

  const remove = (item) => setCart((entries) => {
    const existing = entries.find((entry) => itemsMatch(entry.item, item));
    if (!existing || existing.qty <= 1) return entries.filter((entry) => !itemsMatch(entry.item, item));
    return entries.map((entry) => itemsMatch(entry.item, item) ? { ...entry, qty: entry.qty - 1 } : entry);
  });

  const purchase = async () => {
    if (!cart.length || busy || !canAfford || !purchaseOnline) return;
    setBusy(true);
    setError('');
    try {
      const result = await commitShopPurchase(databaseConnection, {
        playerUUID: currentPlayer.UUID,
        cart,
        purchaseBatchUUID: uuid(),
        origin: 'mobile',
        requireOnlineAuthority: auth.configured,
      });
      updateCurrentPlayer(result.player);
      setMoney(Math.max(0, Number(result.globalMoneyAfter || 0)));
      setInventory(result.playerInventory);
      if (result.catalogRecords?.length) {
        const replacements = new Map(result.catalogRecords.map((item) => [item.UUID, item]));
        setCatalog((items) => sortShopCatalog(items.map((item) => replacements.get(item.UUID) || item)));
      }
      setCart([]);
      setMode('inventory');
      invalidateDomains(DOMAIN_INVALIDATION.shopPurchaseCommit);
      void requestPromptReferenceSync(databaseConnection, 'mobile-commerce-purchase');
      presentFeedback(simpleMobileFeedback('item-purchased', `Purchased ${result.itemCount} item${result.itemCount === 1 ? '' : 's'}`, {
        significance: 'meaningful',
        deltas: [{ key: 'coins', value: -Number(result.tokenCost || 0), label: 'Coins' }],
        sourceId: result.purchaseBatchUUID,
      }));
      void processShopPurchaseSecondaryEffects(databaseConnection, result)
        .then(() => invalidateDomains(DOMAIN_INVALIDATION.shopPurchaseSecondary))
        .catch((secondaryError) => {
          console.warn('[Mobile Shop] post-purchase processing will retry later.', secondaryError);
          notify?.({
            title: 'Purchase saved',
            message: 'Progress processing will retry in the background.',
            kind: 'info',
            persist: false,
          });
        });
    } catch (purchaseError) {
      setError(purchaseError?.message || 'The purchase could not be completed.');
      try {
        const canonical = await reconcileShopAuthority(databaseConnection, currentPlayer.UUID);
        if (canonical) {
          updateCurrentPlayer(canonical.player);
          setMoney(Math.max(0, Number(canonical.globalMoneyAfter || 0)));
          setInventory(canonical.inventoryRecords);
          setCatalog(sortShopCatalog(canonical.catalogRecords));
        }
      } catch (reconcileError) {
        console.warn('[Mobile Shop] authority reconciliation will retry on the next sync.', reconcileError);
      }
    } finally {
      setBusy(false);
    }
  };

  const activate = async (item) => {
    if (!canUseInventoryItem(item) || busyItem) return;
    setBusyItem(item.UUID);
    setError('');
    try {
      const result = await activateShopItemCommand(databaseConnection, item);
      setInventory((items) => items.map((candidate) => candidate.UUID === result.inventoryRecord.UUID ? result.inventoryRecord : candidate));
      invalidateDomains(DOMAIN_INVALIDATION.inventoryUse);
      databaseConnection.syncRuntime?.scheduleSync?.('mobile-commerce-activation');
      presentFeedback(simpleMobileFeedback('item-activated', `${item.name} activated`, {
        significance: 'meaningful',
        sourceId: result.operationId || item.UUID,
      }));
    } catch (activationError) {
      setError(activationError?.message || 'The item could not be activated.');
      notify?.({ title: 'Item unavailable', message: activationError?.message || 'The item could not be activated.', kind: 'error', persist: false });
    } finally {
      setBusyItem(null);
    }
  };

  return (
    <section className="mobile-page mobile-shop-page">
      <header className="mobile-page-header"><div><span>Rewards</span><h1>Shop</h1></div><div className="mobile-wallet" aria-label="Wallet"><strong>$ {money.toFixed(2)}</strong><strong>◇ {Math.floor(Number(currentPlayer?.tokens || 0))}</strong></div></header>
      <div className="mobile-mode-control" role="tablist" aria-label="Shop mode">{MODES.map((id) => <button key={id} type="button" role="tab" aria-selected={mode === id} className={mode === id ? 'is-active' : ''} onClick={() => setMode(id)}>{id[0].toUpperCase() + id.slice(1)}{id === 'cart' && cartCount > 0 ? ` ${cartCount}` : ''}</button>)}</div>
      {mode === 'browse' && <>
        <div className="mobile-category-rail" aria-label="Shop categories"><button type="button" className={category === 'All' ? 'is-active' : ''} onClick={() => setCategory('All')}>All</button>{SHOP_CATEGORIES.map((name) => <button key={name} type="button" className={category === name ? 'is-active' : ''} onClick={() => setCategory(name)}>{name}</button>)}</div>
        <main className="mobile-shop-list">{filteredCatalog.map((item) => {
          const owned = Boolean(findInventoryForShopItem(inventory, item) && isCosmeticItem(item));
          const available = canAdd(item);
          return <article key={item.UUID} className="mobile-shop-row"><button type="button" className="mobile-shop-row__body" onClick={() => openSurface('shop-detail', { item, owned, canAdd: available, onAdd: add, onEquipped: load })}><span aria-hidden="true">{String(item.name || 'I').charAt(0).toUpperCase()}</span><div><strong>{item.name}</strong><small>{itemUnit(item)} · {item.category || 'Reward'}</small></div></button><div className="mobile-shop-row__action"><b>{owned ? 'Owned' : costLabel(item)}</b><button type="button" aria-label={`Add ${item.name} to cart`} disabled={!available} onClick={() => add(item)}>{owned ? '✓' : '+'}</button></div></article>;
        })}{!loading && !filteredCatalog.length && <div className="mobile-compact-empty">No items in this category.</div>}</main>
      </>}
      {mode === 'inventory' && <main className="mobile-inventory-list">{consumables.map((item) => {
        const cooldown = getInventoryItemCooldown(item);
        return <article key={item.UUID} className="mobile-inventory-row"><div><strong>{item.name}</strong><small>Quantity {item.quantity}{cooldown.active ? ` · Ready ${new Date(cooldown.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</small></div><button type="button" className="primary" disabled={!canUseInventoryItem(item) || busyItem === item.UUID} onClick={() => activate(item)}>{busyItem === item.UUID ? 'Using…' : cooldown.active ? 'Cooling down' : 'Use'}</button></article>;
      })}{!loading && !consumables.length && <div className="mobile-compact-empty"><strong>No consumables yet</strong><span>Purchased activatable rewards appear here. Cosmetics stay in Browse as Owned.</span></div>}</main>}
      {mode === 'cart' && <main className="mobile-cart"><div className="mobile-cart-lines">{cart.map((entry) => <article key={entry.item.UUID}><div><strong>{entry.item.name}</strong><small>×{entry.qty}</small></div><b>{costLabel(entry.item, entry.qty)}</b><button type="button" aria-label={`Remove one ${entry.item.name}`} onClick={() => remove(entry.item)}>−</button></article>)}{!cart.length && <div className="mobile-compact-empty"><strong>Your cart is empty</strong><span>Add rewards from Browse.</span></div>}</div>{cart.length > 0 && <footer className="mobile-cart-footer"><div>{tokenTotal > 0 && <span>◇ {tokenTotal}</span>}{dollarTotal > 0 && <span>${dollarTotal.toFixed(2)}</span>}</div><button type="button" className="primary" disabled={busy || !canAfford || !purchaseOnline} onClick={purchase}>{busy ? 'Buying…' : !purchaseOnline ? 'Connect to buy' : !canAfford ? 'Insufficient balance' : 'Checkout'}</button></footer>}</main>}
      {loading && <div className="mobile-feature-loading">Loading Shop…</div>}
      {error && <div className="mobile-page-error" role="alert">{error}</div>}
    </section>
  );
}
