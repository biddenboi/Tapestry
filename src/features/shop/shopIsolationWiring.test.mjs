import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  featureLoader,
  gameHub,
  panelRegistry,
  requirements,
  shopView,
  inventoryView,
  purchaseService,
  purchaseEffects,
  revisions,
  shopCss,
] = await Promise.all([
  read('./loaders.js'),
  read('../../app/shell/GameHub/GameHub.jsx'),
  read('../../app/shell/GameHub/panelRegistry.js'),
  read('../../app/data-source/panelDomainRequirements.js'),
  read('./pages/Shop/Shop.jsx'),
  read('../inventory/pages/Inventory/Inventory.jsx'),
  read('../../domain/shop/ShopPurchaseService.js'),
  read('../../domain/shop/ShopPurchaseEffects.js'),
  read('../../app/context/domainRevisions.js'),
  read('./pages/Shop/Shop.css'),
]);

test('the Shop feature bundle remains behind its dynamic import boundary', () => {
  assert.match(featureLoader, /import\('\.\/pages\/Shop\/Shop\.jsx'\)/);
  assert.doesNotMatch(gameHub, /from '@features\/shop\/pages\/Shop\/Shop\.jsx'/);
  assert.match(panelRegistry, /const Shop = lazyFeature\(loadShop\)/);
});

test('catalog and owned inventory have independent hydration boundaries', () => {
  assert.match(requirements, /shop: Object\.freeze\(\[D\.shop\]\)/);
  assert.match(requirements, /inventory: Object\.freeze\(\[D\.inventory\]\)/);
  assert.match(shopView, /const loadCatalog = useCallback/);
  assert.match(shopView, /const loadOwnedInventory = useCallback/);
  assert.match(shopView, /ensureDomainLoaded\?\.\('inventory'\)/);
  assert.match(shopView, /domainRevisions\.shop/);
  assert.match(shopView, /domainRevisions\.inventory/);
  assert.doesNotMatch(inventoryView, /domainRevisions\.shop/);
  assert.doesNotMatch(inventoryView, /domainRevisions\.profiles/);
});

test('purchase commits one authoritative transaction before secondary effects start', () => {
  assert.match(purchaseService, /commitAtomicMutation\(\{/);
  assert.match(purchaseService, /label: 'shop-purchase'/);
  assert.match(purchaseService, /flush: true/);
  const handler = shopView.slice(shopView.indexOf('const handlePurchase = async'));
  const commitIndex = handler.indexOf('await commitShopPurchase');
  const effectsIndex = handler.indexOf('processShopPurchaseSecondaryEffects');
  assert.ok(commitIndex >= 0 && effectsIndex > commitIndex);
  assert.doesNotMatch(handler.slice(0, effectsIndex), /databaseConnection\.add\(STORES\.(?:player|inventory|shop|transaction)/);
  assert.match(purchaseEffects, /recordAnalyticsEvent/);
  assert.match(purchaseEffects, /queueAchievementEvent/);
  assert.doesNotMatch(purchaseService, /recordAnalyticsEvent|queueAchievementEvent/);
});

test('Shop and inventory invalidation stays domain-specific', () => {
  assert.match(revisions, /shopCatalogWrite: freezeDomains\(\[DATA_DOMAIN\.shop\]\)/);
  assert.match(revisions, /shopPurchaseCommit: freezeDomains\(\[\s*DATA_DOMAIN\.shop,\s*DATA_DOMAIN\.inventory,\s*DATA_DOMAIN\.profiles,\s*DATA_DOMAIN\.profileSummaries,\s*\]\)/);
  assert.match(revisions, /inventoryWrite: freezeDomains\(\[\s*DATA_DOMAIN\.inventory,/);
  const purchasePolicy = revisions.slice(
    revisions.indexOf('shopPurchaseCommit:'),
    revisions.indexOf('shopPurchaseSecondary:'),
  );
  assert.doesNotMatch(purchasePolicy, /DATA_DOMAIN\.feed/);
});

test('catalog cards use the media boundary instead of a height-dependent overlay divider', () => {
  assert.match(shopCss, /\.shop-card-media \{[\s\S]*?border-bottom:/);
  assert.doesNotMatch(shopCss, /\.shop-card::before/);
  assert.doesNotMatch(shopCss, /\.shop-card[\s\S]*?top: 50%/);
});
