import '@features/shop/pages/Shop/Shop.css';
import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import { useAppContext } from '@app/hooks/useAppContext.js';
import {
    usePanelLifecycle,
    usePanelRequestScope,
} from '@app/panel-lifecycle/PanelLifecycleContext.jsx';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
    STORES,
    ITEM_TYPE,
} from '@domain/constants.js';
import {
    calculateItemCost,
    getShopCoinEarningRate,
    getShopPriceTier,
    SHOP_CATEGORIES,
    SHOP_AVERAGE_WORK_MINUTES,
    SHOP_PRICE_TIERS,
    canPurchaseShopItem,
    canUseInventoryItem,
    getInventoryItemCooldown,
    getShopItemAvailabilityLabel,
    getShopItemCost,
    isShopItemAvailable,
    sortShopCatalog,
} from '@domain/shop/Shop.js';
import { recordAnalyticsEvent } from '@domain/analytics/AnalyticsEvents.js';
import { getAchievementByKey } from '@domain/achievements/Achievements.js';
import {
    ACHIEVEMENT_EVENT_TYPE,
    createAchievementEvent,
    queueAchievementEvent,
} from '@domain/achievements/AchievementProcessing.js';
import { commitShopPurchase, reconcileShopAuthority } from '@domain/shop/ShopPurchaseService.js';
import { processShopPurchaseSecondaryEffects } from '@domain/shop/ShopPurchaseEffects.js';
import { activateShopItemCommand, cancelShopEffectCommand } from '@domain/shop/ShopActivationService.js';
import { compressImageToBase64 } from '@shared/media/ImageCompression.js';
import { v4 as uuid } from 'uuid';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import { findOrCreateResource } from '@shared/resources/Resources.js';
import ActionRow from '@shared/ui/ActionRow.jsx';
import ConfirmDialog from '@shared/ui/ConfirmDialog.jsx';
import EmptyState from '@shared/ui/EmptyState.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import PageHeader from '@shared/ui/PageHeader.jsx';
import StatusBadge from '@shared/ui/StatusBadge.jsx';
import useProgressiveList from '@shared/ui/useProgressiveList.js';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { useLocalSectionRoute } from '@shared/navigation/LocalSectionNav/LocalSectionRouteState.js';
import getSupabaseAuthService from '@data/sync/supabase/SupabaseAuthService.js';

const shopAuthService = getSupabaseAuthService();

const SHOP_IMAGE_TARGET_KB = 90;
const SHOP_IMAGE_MAX_DIM = 900;
const SHOP_CATEGORY_COLORS = {
    Rest: '#22d3ee',
    Exercise: '#84cc16',
    Focus: '#60a5fa',
    Food: '#fb923c',
    Entertainment: '#a78bfa',
    Social: '#facc15',
    Wellness: '#34d399',
    Cosmetics: '#f472b6',
    Misc: '#fbbf24',
    Other: '#fbbf24',
};
const SHOP_PAGES = Object.freeze([
    { id: 'featured', label: 'Featured', icon: 'shop' },
    { id: 'browse', label: 'Browse', icon: 'search' },
    { id: 'collections', label: 'Collections', icon: 'grid' },
    { id: 'history', label: 'History', icon: 'history' },
    { id: 'inventory', label: 'Inventory', icon: 'inventory' },
]);
const MOBILE_SHOP_PAGES = Object.freeze([
    { id: 'browse', label: 'Browse', icon: 'search' },
    { id: 'inventory', label: 'Inventory', icon: 'inventory' },
]);

const getShopCategoryColor = (category) => SHOP_CATEGORY_COLORS[category] || 'var(--color-shop)';

const itemsMatch = (left, right) => {
    if (!left || !right) return false;
    if (left.UUID && right.UUID) return left.UUID === right.UUID;
    return left.name === right.name;
};

const isCosmeticItem = (item) => String(item?.type || '').startsWith('cosmetic_');
const isSystemCosmeticItem = (item) => isCosmeticItem(item) && (item?.itemClass === 'unlock' || item?.source === 'system' || item?.UUID?.startsWith?.('shop-title-'));
const SHOP_FORM_STEPS = [
    { id: 'info', label: 'Info' },
    { id: 'pricing', label: 'Pricing' },
    { id: 'conditions', label: 'Conditions' },
];

const shopItemPriceTier = (item) => getShopPriceTier(item?.priceTier ?? item?.enjoyment ?? 2);
const shopItemCost = (item) => getShopItemCost(item);

const findInventoryForShopItem = (inventory = [], item = null) => {
    if (!item) return null;
    return inventory.find((entry) => entry.itemUUID === item.UUID)
        || inventory.find((entry) => item.itemId && entry.type === item.type && entry.itemId === item.itemId)
        || inventory.find((entry) => entry.type === item.type && entry.name === item.name)
        || null;
};

const shopItemUnitLabel = (item) => {
    if (item?.type === ITEM_TYPE.duration) return `${item.duration} min`;
    if (isCosmeticItem(item)) return 'Unlock';
    return `x${item?.quantity || 1}`;
};

const shopItemTypeLabel = (item) => {
    if (item?.type === ITEM_TYPE.duration) return 'Timed reward';
    if (item?.type === ITEM_TYPE.quantity) return 'Quantity reward';
    if (item?.type === ITEM_TYPE.cosmetic_title) return 'Title cosmetic';
    if (isCosmeticItem(item)) return 'Cosmetic unlock';
    return 'Reward';
};

function ShopItemImage({ item, className = '' }) {
    const imageUrl = item?.bannerImageUrl;
    const label = String(item?.name || 'Item').trim().charAt(0).toUpperCase() || 'I';

    return (
        <span className={`shop-item-image ${imageUrl ? 'has-image' : ''} ${className}`} aria-hidden="true">
            {imageUrl
                ? <ResourceImage value={imageUrl} alt="" />
                : <span>{label}</span>}
        </span>
    );
}

/* ── Money log modal ────────────────────────────────────── */
function MoneyLogModal({ currentPlayer, onSubmit, onClose }) {
    const today = new Date().toDateString();
    const usedToday = currentPlayer?.lastMoneyLogDate === today;
    const [title, setTitle]       = useState('');
    const [description, setDesc]  = useState('');
    const [amount, setAmount]     = useState('');

    const amountNum = parseFloat(amount);
    const canSubmit = !usedToday && title.trim() && amountNum > 0;

    return (
        <div className="add-item-overlay" onClick={onClose}>
            <div className="add-item-form money-log-form" onClick={e => e.stopPropagation()}>
                <div className="form-header">
                    <span>Log cash</span>
                    <button type="button" className="close-btn" onClick={onClose}>✕</button>
                </div>

                {usedToday ? (
                    <div className="money-log-locked">
                        <div className="money-log-locked-icon">$</div>
                        <p className="money-log-locked-title">Already logged today</p>
                        <p className="money-log-locked-sub">Cash can only be logged once per day. Come back tomorrow to record more income.</p>
                        <button type="button" className="primary money-log-locked-btn" onClick={onClose}>Close</button>
                    </div>
                ) : (
                    <>
                        <div className="money-log-body">
                            <p className="money-log-hint">
                                Logging cash counts like completing a task — it lands on your timeline and updates your balance.
                                You can log once per day.
                            </p>

                            <label className="money-log-field">Title
                                <input
                                    value={title}
                                    onChange={e => setTitle(e.target.value)}
                                    placeholder="e.g. Freelance payment received"
                                />
                            </label>
                            <label className="money-log-field">Note <span className="money-log-optional">(optional)</span>
                                <textarea
                                    value={description}
                                    onChange={e => setDesc(e.target.value)}
                                    rows={2}
                                    placeholder="Brief context for this income…"
                                />
                            </label>
                            <label className="money-log-field money-log-field--amount">Amount
                                <div className="cost-input-wrap cost-input-wrap--dollars">
                                    <span className="cost-input-icon money-icon">$</span>
                                    <input
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        value={amount}
                                        onChange={e => setAmount(e.target.value)}
                                        placeholder="0.00"
                                    />
                                </div>
                            </label>
                        </div>
                        <div className="form-footer money-log-footer">
                            <span className="money-log-preview">
                                {amountNum > 0
                                    ? <>Will add <strong>${amountNum.toFixed(2)}</strong> to your balance</>
                                    : 'Enter an amount to continue'}
                            </span>
                            <button
                                type="button"
                                className="primary"
                                disabled={!canSubmit}
                                onClick={() => onSubmit({ title: title.trim(), description: description.trim(), amount: amountNum })}
                            >
                                Log cash
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function EnjoymentDots({ level }) {
    return (
        <div className="enjoyment-dots" title={`Activity tier ${level}/3`}>
            {[1, 2, 3].map(i => (
                <span key={i} className={`dot ${i <= level ? 'active' : ''}`} />
            ))}
        </div>
    );
}

function ShopItemCard({
    item,
    inventoryItem,
    inventoryReady,
    cartQty,
    onAdd,
    onRemove,
    onDelete,
    onEdit,
    onOpen,
    readOnly = false,
    adminEnabled = true,
}) {
    const cost = shopItemCost(item);
    const isDollars  = item.currencyType === 'dollars';
    const isCosmetic = isCosmeticItem(item);
    const priceTier = shopItemPriceTier(item);
    const typeBadge = isCosmetic
        ? (item.type === ITEM_TYPE.cosmetic_title ? 'TITLE' : 'COSMETIC')
        : priceTier.shortLabel.toUpperCase();
    const available = !readOnly && inventoryReady && canPurchaseShopItem(item, inventoryItem, new Date(), cartQty);
    const availabilityLabel = inventoryReady ? getShopItemAvailabilityLabel(item) : 'Checking ownership…';

    return (
        <div
            className={`shop-card ${cartQty > 0 ? 'in-cart' : ''} ${available ? '' : 'is-unavailable'}`}
            style={{ '--shop-color': getShopCategoryColor(item.category) }}
        >
            <ShopItemImage item={item} className="shop-card-media" />
            <div className="shop-card-body">
                <div className="shop-card-header">
                    <span className="shop-card-name">{item.name}</span>
                    {!isCosmetic && <EnjoymentDots level={priceTier.level} />}
                </div>
                <p className="shop-card-desc">{item.description}</p>
                <div className="shop-card-meta">
                    <span className="shop-card-duration">
                        {shopItemUnitLabel(item)}
                    </span>
                    <span className={`shop-card-type type-${priceTier.level}`}>
                        {typeBadge}
                    </span>
                    <span className={`shop-card-availability ${isShopItemAvailable(item) ? '' : 'is-closed'}`}>
                        {availabilityLabel}
                    </span>
                    {Number(item.cooldownMs || 0) > 0 && (
                        <span className="shop-card-cooldown">
                            {Math.round(Number(item.cooldownMs) / 60000)}m cooldown
                        </span>
                    )}
                </div>
            </div>
            <div className="shop-card-purchase">
                <button type="button" className="shop-card-view" onClick={() => onOpen(item)}>View</button>
                <span className={`shop-card-cost ${isDollars ? 'cost-dollars' : ''}`}>
                    <span className={`shop-card-cost-icon ${isDollars ? 'money-icon' : ''}`}>
                        {isDollars ? '$' : '◈'}
                    </span>
                    <span className="shop-card-cost-val">
                        {isDollars ? Number(cost).toFixed(2) : cost}
                    </span>
                </span>
                {readOnly ? (
                    <button type="button" className="add-btn" disabled title="Purchases require the online account service">
                        Online only
                    </button>
                ) : cartQty > 0 ? (
                    <div className="cart-controls">
                        <button type="button" className="qty-btn" onClick={() => onRemove(item)}>−</button>
                        <span className="cart-qty">{cartQty}</span>
                        <button type="button" className="qty-btn" onClick={() => onAdd(item)} disabled={!available}>+</button>
                    </div>
                ) : (
                    <button type="button" className="add-btn" onClick={() => onAdd(item)} disabled={!available}>
                        {inventoryReady ? (available ? 'Add' : 'Unavailable') : 'Loading…'}
                    </button>
                )}
                {adminEnabled && !isSystemCosmeticItem(item) && (
                    <div className="shop-card-admin">
                        <button type="button" className="edit-btn" onClick={() => onEdit(item)}>Edit</button>
                        <button type="button" className="clear-btn" onClick={() => onDelete(item)}>Delete</button>
                    </div>
                )}
            </div>
        </div>
    );
}

function ProgressiveShopCatalog({
    entries,
    playerInventory,
    inventoryReady,
    getCartQty,
    onAdd,
    onRemove,
    onDelete,
    onEdit,
    onOpen,
    readOnly = false,
    adminEnabled = true,
}) {
    const { visibleItems: visibleEntries, sentinelRef, hasMore } = useProgressiveList(entries, 24);
    const categories = [...new Set(visibleEntries.map(({ item }) => item.category || 'Other'))];
    const renderItem = (entry) => (
        <ShopItemCard
            key={entry.item.UUID || entry.item.name}
            item={entry.item}
            inventoryItem={findInventoryForShopItem(playerInventory, entry.item)}
            inventoryReady={inventoryReady}
            cartQty={getCartQty(entry.item)}
            onAdd={onAdd}
            onRemove={onRemove}
            onDelete={onDelete}
            onEdit={onEdit}
            onOpen={onOpen}
            readOnly={readOnly}
            adminEnabled={adminEnabled}
        />
    );

    return (
        <>
            {categories.map((category) => {
                const categoryItems = visibleEntries.filter(({ item }) => (item.category || 'Other') === category);
                return (
                    <section key={category} className="shop-category-section">
                        <div className="category-label">{category}</div>
                        <div className="shop-grid">
                            {categoryItems.map((entry) => renderItem(entry))}
                        </div>
                    </section>
                );
            })}
            {hasMore && (
                <div ref={sentinelRef} className="shop-list-sentinel">
                    Loading more rewards.
                </div>
            )}
        </>
    );
}

function ShopItemDetail({ item, inventoryItem, inventoryReady, cartQty, onAdd, onClose, readOnly = false }) {
    if (!item) return null;
    const cost = shopItemCost(item);
    const isDollars = item.currencyType === 'dollars';
    const available = !readOnly && inventoryReady && canPurchaseShopItem(item, inventoryItem, new Date(), cartQty);
    const availabilityLabel = inventoryReady ? getShopItemAvailabilityLabel(item) : 'Checking ownership…';
    const priceTier = shopItemPriceTier(item);
    const details = [
        ['Type', shopItemTypeLabel(item)],
        [!isCosmeticItem(item) ? 'Activity tier' : null, !isCosmeticItem(item) ? priceTier.label : null],
        ['Reward', item.type === ITEM_TYPE.duration ? `${item.duration} minutes` : isCosmeticItem(item) ? 'Permanent unlock' : `${item.quantity} per purchase`],
        ['Availability', availabilityLabel],
        [Number(item.cooldownMs || 0) > 0 ? 'Cooldown' : null, Number(item.cooldownMs || 0) > 0 ? `${Math.round(Number(item.cooldownMs) / 60000)} minutes` : null],
        [Number(item.purchaseLimitPerPlayer || 0) > 0 ? 'Player limit' : null, Number(item.purchaseLimitPerPlayer || 0) > 0 ? `${item.purchaseLimitPerPlayer} total` : null],
        [Number(item.stockLimit || 0) > 0 ? 'Stock' : null, Number(item.stockLimit || 0) > 0 ? `${Math.max(0, Number(item.stockLimit) - Number(item.soldCount || 0))} left` : null],
    ].filter(([label]) => label);

    return (
        <ModalFrame
            onClose={onClose}
            title={item.name}
            subtitle={item.category || 'Reward'}
            eyebrow="Shop item"
            size="md"
            accent="var(--color-shop)"
            className="shop-item-detail"
            hero={(
                <div className="shop-item-detail-hero">
                    <ShopItemImage item={item} className="shop-item-detail-media" />
                    <div>
                        <StatusBadge tone={available ? 'success' : 'warning'}>{availabilityLabel}</StatusBadge>
                        <strong>{isDollars ? `$${Number(cost).toFixed(2)}` : `◈ ${cost}`}</strong>
                    </div>
                </div>
            )}
            footer={(
                <ActionRow>
                    <button type="button" onClick={onClose}>Close</button>
                    <button
                        type="button"
                        className="primary"
                        disabled={!available}
                        onClick={() => { onAdd(item); onClose(); }}
                    >
                        {readOnly ? 'Online account required' : inventoryReady ? (available ? 'Add to cart' : availabilityLabel) : 'Loading inventory…'}
                    </button>
                </ActionRow>
            )}
        >
            <p className="shop-item-detail-description">{item.description || 'No description provided.'}</p>
            <dl className="shop-item-detail-rows">
                {details.map(([label, value]) => (
                    <div key={label}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                    </div>
                ))}
            </dl>
            {!available && (
                <p className="shop-item-detail-note">
                    {inventoryReady ? 'This item cannot be purchased right now.' : 'Owned inventory is still loading.'}
                </p>
            )}
        </ModalFrame>
    );
}

function ShopItemForm({ initialItem, onSubmit, onClose, categories }) {
    const { databaseConnection, currentPlayer } = useAppContext();
    const isEditing = !!initialItem;
    const initialTier = getShopPriceTier(initialItem?.priceTier ?? initialItem?.enjoyment ?? 2);
    const initialForm = initialItem ? {
        name: initialItem.name || '',
        description: initialItem.description || '',
        type: initialItem.type === ITEM_TYPE.cosmetic_title ? ITEM_TYPE.duration : initialItem.type || ITEM_TYPE.duration,
        itemId: initialItem.itemId || '',
        duration: initialItem.duration || 30,
        quantity: initialItem.quantity || 1,
        enjoyment: initialTier.level,
        priceTier: initialTier.id,
        category: initialItem.category || categories[0] || 'Rest',
        bannerImageUrl: initialItem.bannerImageUrl || '',
        currencyType: initialItem.currencyType || 'tokens',
        cooldownMinutes: Math.round(Number(initialItem.cooldownMs || 0) / 60000),
        purchaseLimitPerPlayer: initialItem.purchaseLimitPerPlayer || '',
        stockLimit: initialItem.stockLimit ?? '',
    } : {
        name: '', description: '', type: ITEM_TYPE.duration, itemId: '',
        duration: 30, quantity: 1, enjoyment: 2, priceTier: 'neutral', category: categories[0] || 'Rest', bannerImageUrl: '',
        currencyType: 'tokens',
        cooldownMinutes: 0,
        purchaseLimitPerPlayer: '',
        stockLimit: '',
    };
    const [form, setForm] = useState(initialForm);
    const [step, setStep] = useState(0);
    const autoCost = useMemo(
        () => calculateItemCost(form.type, form.duration, form.quantity, form.priceTier ?? form.enjoyment),
        [form.duration, form.enjoyment, form.priceTier, form.quantity, form.type],
    );
    const [costInput, setCostInput] = useState(
        String(initialItem?.cost ?? calculateItemCost(initialForm.type, initialForm.duration, initialForm.quantity, initialForm.priceTier))
    );
    const [costLocked, setCostLocked] = useState(!!initialItem?.cost);
    const [savingItem, setSavingItem] = useState(false);
    const isDollars = form.currencyType === 'dollars';
    const priceTier = getShopPriceTier(form.priceTier ?? form.enjoyment);
    const expectedRoll = getShopCoinEarningRate() * SHOP_AVERAGE_WORK_MINUTES;
    const earnedPerMinute = getShopCoinEarningRate();

    const set = (k, v) => {
        setForm((previous) => {
            const next = { ...previous, [k]: v };
            if (k === 'priceTier') next.enjoyment = getShopPriceTier(v).level;
            return next;
        });
    };

    const handleCostChange = (e) => {
        setCostInput(e.target.value);
        setCostLocked(true);
    };

    const resetCost = () => {
        setCostInput(String(autoCost));
        setCostLocked(false);
    };

    const setCurrency = (currencyType) => {
        set('currencyType', currencyType);
        if (currencyType === 'tokens') {
            setCostInput(String(autoCost));
            setCostLocked(false);
        } else if (!isDollars) {
            setCostInput('1.00');
            setCostLocked(true);
        }
    };

    useEffect(() => {
        if (!costLocked && !isDollars) setCostInput(String(autoCost));
    }, [autoCost, costLocked, isDollars]);

    const handleImageUpload = async (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (!file) return;
        const compressed = await compressImageToBase64(file, SHOP_IMAGE_TARGET_KB, SHOP_IMAGE_MAX_DIM);
        const resource = await findOrCreateResource(databaseConnection, compressed, {
            parent: currentPlayer?.UUID || null,
            kind: 'shopImage',
        });
        set('bannerImageUrl', resource);
    };

    const finalCost = isDollars
        ? Math.max(0.01, parseFloat(costInput) || 0.01)
        : Math.max(1, parseInt(costInput, 10) || 1);
    const canLeaveInfo = String(form.name || '').trim() && String(form.category || '').trim();
    const canLeavePricing = finalCost > 0 && (form.type === ITEM_TYPE.duration ? Number(form.duration) > 0 : Number(form.quantity) > 0);
    const canAdvance = step === 0 ? canLeaveInfo : step === 1 ? canLeavePricing : true;
    const unitLabel = form.type === ITEM_TYPE.duration
        ? `${Math.max(1, Number(form.duration) || 1)} minutes`
        : `${Math.max(1, Number(form.quantity) || 1)} use${Number(form.quantity) === 1 ? '' : 's'}`;

    const saveItem = async () => {
        if (savingItem || !canLeaveInfo || !canLeavePricing) return;
        if (form.type === ITEM_TYPE.cosmetic_title) return;
        setSavingItem(true);
        try {
            await onSubmit({
                ...form,
                enjoyment: priceTier.level,
                priceTier: priceTier.id,
                bannerImageUrl: form.bannerImageUrl || null,
                cost: finalCost,
            });
            onClose();
        } finally {
            setSavingItem(false);
        }
    };

    const content = (
        <div className="add-item-overlay" onClick={onClose}>
            <div className="add-item-form" onClick={e => e.stopPropagation()}>
                <div className="form-header">
                    <span>{isEditing ? 'EDIT ITEM' : 'NEW ITEM'}</span>
                    <button type="button" className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="shop-editor-steps" aria-label="Shop item editor steps">
                    {SHOP_FORM_STEPS.map((entry, index) => (
                        <button
                            key={entry.id}
                            type="button"
                            className={`shop-editor-step ${step === index ? 'is-active' : ''} ${step > index ? 'is-complete' : ''}`}
                            onClick={() => {
                                if (index <= step || canAdvance) setStep(index);
                            }}
                        >
                            <span>{index + 1}</span>
                            <strong>{entry.label}</strong>
                        </button>
                    ))}
                </div>
                <div className="form-grid shop-editor-page" data-step={SHOP_FORM_STEPS[step].id}>
                    {step === 0 && (
                        <>
                            <div className="span2 form-media-row">
                                <div className="form-image-field">
                                    <span className="form-image-label">Image</span>
                                    <div className="shop-image-picker">
                                        <ShopItemImage item={{ name: form.name, bannerImageUrl: form.bannerImageUrl }} className="shop-image-preview" />
                                        <div className="shop-image-actions">
                                            <label className="shop-image-upload">
                                                Upload
                                                <input type="file" accept="image/*" onChange={handleImageUpload} />
                                            </label>
                                            {form.bannerImageUrl && (
                                                <button type="button" className="shop-image-remove" onClick={() => set('bannerImageUrl', '')}>
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                                <label className="form-name-field">Name
                                    <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Coffee break" />
                                </label>
                            </div>
                            <label className="span2">Description
                                <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={3} placeholder="Short note for future-you" />
                            </label>
                            <label>Type
                                <select value={form.type} onChange={e => set('type', e.target.value)}>
                                    <option value={ITEM_TYPE.duration}>Duration</option>
                                    <option value={ITEM_TYPE.quantity}>Quantity</option>
                                </select>
                            </label>
                            <label>Category
                                <select value={form.category} onChange={e => set('category', e.target.value)}>
                                    {categories.map(c => <option key={c}>{c}</option>)}
                                </select>
                            </label>
                        </>
                    )}

                    {step === 1 && (
                        <>
                            {form.type === ITEM_TYPE.duration ? (
                                <label>Duration (min)
                                    <input type="number" min={1} value={form.duration} onChange={e => set('duration', e.target.value)} />
                                </label>
                            ) : (
                                <label>Quantity
                                    <input type="number" min={1} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
                                </label>
                            )}
                            <div className="shop-pricing-math">
                                <div>
                                    <span>Avg roll</span>
                                    <strong>◈ {expectedRoll.toFixed(1)}</strong>
                                </div>
                                <div>
                                    <span>Work rate</span>
                                    <strong>◈ {earnedPerMinute.toFixed(2)}/min</strong>
                                </div>
                                <div>
                                    <span>Auto price</span>
                                    <strong>◈ {autoCost}</strong>
                                </div>
                            </div>
                            <div className="span2 shop-tier-grid" role="radiogroup" aria-label="Activity tier">
                                {SHOP_PRICE_TIERS.map((tier) => (
                                    <button
                                        key={tier.id}
                                        type="button"
                                        role="radio"
                                        aria-checked={priceTier.id === tier.id}
                                        className={`shop-tier-card tier-${tier.level} ${priceTier.id === tier.id ? 'is-active' : ''}`}
                                        onClick={() => set('priceTier', tier.id)}
                                    >
                                        <span>{tier.label}</span>
                                        <strong>{tier.multiplier.toFixed(1)}x</strong>
                                        <small>{tier.description}</small>
                                    </button>
                                ))}
                            </div>
                            <div className="span2 form-price-block">
                                <div className="form-price-label">
                                    <span>Price</span>
                                    {costLocked
                                        ? <span className="cost-badge cost-badge-manual">Manual</span>
                                        : <span className="cost-badge cost-badge-auto">Auto</span>
                                    }
                                    {costLocked && !isDollars && (
                                        <button type="button" className="cost-reset-btn" onClick={resetCost}>reset</button>
                                    )}
                                </div>
                                <div className="form-price-row">
                                    <div className="currency-toggle" role="tablist">
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={!isDollars}
                                            className={`currency-chip ${!isDollars ? 'is-active' : ''}`}
                                            onClick={() => setCurrency('tokens')}
                                        >
                                            <span className="currency-chip-icon">◈</span>
                                            <span>Coins</span>
                                        </button>
                                        <button
                                            type="button"
                                            role="tab"
                                            aria-selected={isDollars}
                                            className={`currency-chip currency-chip--dollars ${isDollars ? 'is-active' : ''}`}
                                            onClick={() => setCurrency('dollars')}
                                        >
                                            <span className="currency-chip-icon">$</span>
                                            <span>Cash</span>
                                        </button>
                                    </div>
                                    <div className={`cost-input-wrap ${isDollars ? 'cost-input-wrap--dollars' : ''}`}>
                                        <span className={`cost-input-icon ${isDollars ? 'money-icon' : ''}`}>
                                            {isDollars ? '$' : '◈'}
                                        </span>
                                        <input
                                            type="number"
                                            min={isDollars ? 0.01 : 1}
                                            step={isDollars ? 0.01 : 1}
                                            value={costInput}
                                            onChange={handleCostChange}
                                            className={costLocked ? 'cost-input-locked' : ''}
                                        />
                                    </div>
                                </div>
                            </div>
                        </>
                    )}

                    {step === 2 && (
                        <>
                            <label>Cooldown (min)
                                <input type="number" min={0} value={form.cooldownMinutes} onChange={e => set('cooldownMinutes', e.target.value)} />
                            </label>
                            <label>Per-player limit
                                <input type="number" min={1} value={form.purchaseLimitPerPlayer} onChange={e => set('purchaseLimitPerPlayer', e.target.value)} placeholder="Unlimited" />
                            </label>
                            <label>Stock limit
                                <input type="number" min={1} value={form.stockLimit} onChange={e => set('stockLimit', e.target.value)} placeholder="Unlimited" />
                            </label>
                            <div className="shop-editor-preview">
                                <span>Preview</span>
                                <strong>{form.name || 'Untitled reward'}</strong>
                                <p>{unitLabel} · {priceTier.label} · {isDollars ? `$${Number(finalCost).toFixed(2)}` : `◈ ${finalCost}`}</p>
                            </div>
                        </>
                    )}
                </div>
                <div className="form-footer">
                    <button type="button" onClick={onClose}>Cancel</button>
                    <div className="form-footer-nav">
                        {step > 0 && (
                            <button type="button" onClick={() => setStep((value) => Math.max(0, value - 1))}>Back</button>
                        )}
                        {step < SHOP_FORM_STEPS.length - 1 ? (
                            <button type="button" className="primary" onClick={() => setStep((value) => Math.min(SHOP_FORM_STEPS.length - 1, value + 1))} disabled={!canAdvance}>
                                Next
                            </button>
                        ) : (
                            <button type="button" className="primary" onClick={saveItem} disabled={savingItem || !canLeaveInfo || !canLeavePricing}>
                                {savingItem ? 'Saving...' : (isEditing ? 'Save' : 'Add item')}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    if (typeof document === 'undefined') return content;
    return createPortal(content, document.body);
}

function CartSidebar({ cart, tokens, money, purchaseReady, onRemove, onPurchase, onClear, onLogMoney }) {
    const tokenItems  = cart.filter(e => (e.item.currencyType || 'tokens') === 'tokens');
    const dollarItems = cart.filter(e => e.item.currencyType === 'dollars');
    const tokenTotal  = tokenItems.reduce((s, e) => s + e.totalCost, 0);
    const dollarTotal = dollarItems.reduce((s, e) => s + e.totalCost, 0);
    const canAfford   = purchaseReady && tokens >= tokenTotal && (money || 0) >= dollarTotal;

    return (
        <aside className="cart-sidebar">
            <div className="cart-header">
                <span>Cart</span>
                {cart.length > 0 && (
                    <button type="button" className="clear-btn" onClick={onClear}>Clear</button>
                )}
            </div>

            <div className="cart-token-balance">
                <span className="balance-label">Tokens</span>
                <span className="balance-value"><span className="cost-icon">◈</span>{tokens ?? 0}</span>
            </div>

            <div className="cart-token-balance cart-balance--cash">
                <span className="balance-label">Cash</span>
                {onLogMoney ? <button
                    type="button" className="money-balance-btn" onClick={onLogMoney} title="Log cash income"
                >
                    <span className="money-icon">$</span>
                    <span className="money-balance-val">{(money || 0).toFixed(2)}</span>
                    <span className="money-log-hint-icon" aria-hidden="true">+</span>
                </button> : <span className="money-balance-btn">
                    <span className="money-icon">$</span>
                    <span className="money-balance-val">{(money || 0).toFixed(2)}</span>
                </span>}
            </div>

            <div className="cart-items">
                {cart.length === 0 ? (
                    <p className="cart-empty">Your cart is empty.</p>
                ) : cart.map(entry => {
                    const isDollars = entry.item.currencyType === 'dollars';
                    return (
                        <div key={entry.item.UUID || entry.item.name} className="cart-line">
                            <ShopItemImage item={entry.item} className="cart-line-media" />
                            <div className="cart-line-info">
                                <span className="cart-line-name">{entry.item.name}</span>
                                <span className="cart-line-sub">×{entry.qty}</span>
                            </div>
                            <span className={`cart-line-cost ${isDollars ? 'cost-dollars' : ''}`}>
                                {isDollars ? `$ ${entry.totalCost.toFixed(2)}` : `◈ ${entry.totalCost}`}
                            </span>
                            <button type="button" className="cart-remove" onClick={() => onRemove(entry.item, entry.qty)}>✕</button>
                        </div>
                    );
                })}
            </div>

            {cart.length > 0 && (
                <div className="cart-footer">
                    {tokenTotal > 0 && (
                        <div className="cart-total">
                            <span>Tokens</span>
                            <span className={tokens >= tokenTotal ? 'cost-ok' : 'cost-over'}>◈ {tokenTotal}</span>
                        </div>
                    )}
                    {dollarTotal > 0 && (
                        <div className="cart-total">
                            <span>Cash</span>
                            <span className={`cost-dollars ${(money || 0) >= dollarTotal ? 'cost-ok' : 'cost-over'}`}>
                                $ {dollarTotal.toFixed(2)}
                            </span>
                        </div>
                    )}
                    {!purchaseReady
                        ? <p className="cart-warning">Connection and private account sign-in required</p>
                        : !canAfford && <p className="cart-warning">Insufficient balance</p>}
                    <button
                        type="button"
                        className={`purchase-btn ${canAfford ? 'primary' : 'disabled'}`}
                        onClick={canAfford ? onPurchase : undefined}
                        disabled={!canAfford}
                    >
                        {purchaseReady ? 'Buy' : 'Connection required'}
                    </button>
                </div>
            )}
        </aside>
    );
}

function ShopInventoryPanel({ inventory, effects, online, busyId, onUse, onCancel }) {
    const now = Date.now();
    const orderedInventory = [...inventory].sort((left, right) => {
        const leftActive = effects.some((entry) => entry.sourceId === left.UUID && new Date(entry.endsAt).getTime() > now);
        const rightActive = effects.some((entry) => entry.sourceId === right.UUID && new Date(entry.endsAt).getTime() > now);
        return Number(rightActive) - Number(leftActive);
    });
    return (
        <div className="shop-mobile-inventory">
            {orderedInventory.map((item) => {
                const cooldown = getInventoryItemCooldown(item);
                const effect = effects.find((entry) => entry.sourceId === item.UUID && new Date(entry.endsAt).getTime() > now);
                const remaining = effect ? Math.max(0, new Date(effect.endsAt).getTime() - now) : 0;
                const usable = online && canUseInventoryItem(item) && !effect;
                return (
                    <article key={item.UUID}>
                        <ShopItemImage item={item} />
                        <div>
                            <strong>{item.name}</strong>
                            <small>{effect
                                ? `${Math.ceil(remaining / 60000)} min active`
                                : cooldown.active ? `Cooldown until ${new Date(cooldown.until).toLocaleTimeString()}`
                                    : `${Number(item.quantity || 0)} owned`}</small>
                        </div>
                        <button type="button" className={effect ? 'danger' : 'primary'} disabled={(!effect && !usable) || busyId === item.UUID} onClick={() => effect ? onCancel(effect, item) : onUse(item)}>
                            {busyId === item.UUID ? 'Working…' : effect ? 'End early' : online ? 'Use' : 'Connection required'}
                        </button>
                    </article>
                );
            })}
            {!inventory.length && <EmptyState icon="◇" title="No owned items yet." description="Purchased items appear here." />}
        </div>
    );
}

function Shop({ mobileRestricted = false }) {
    const {
        databaseConnection,
        currentPlayer: appCurrentPlayer,
        ensureDomainLoaded,
        domainRevisions,
        invalidateDomains,
        notify,
        emitRewardEvent,
    } = useAppContext();
    const { canLoad, isActive } = usePanelLifecycle();
    const beginPanelRequest = usePanelRequestScope();
    const [shopItems, setShopItems] = useState([]);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [activeCategory, setActiveCategory] = useState('All');
    const [cart, setCart] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [purchaseFlash, setPurchaseFlash] = useState(false);
    const [playerInventory, setPlayerInventory] = useState([]);
    const [inventoryStatus, setInventoryStatus] = useState('idle');
    const [showMoneyLog, setShowMoneyLog] = useState(false);
    const [selectedItem, setSelectedItem] = useState(null);
    const [pendingDelete, setPendingDelete] = useState(null);
    const [purchaseConfirm, setPurchaseConfirm] = useState(false);
    const [purchaseHistory, setPurchaseHistory] = useState([]);
    const [activeEffects, setActiveEffects] = useState([]);
    const [activationBusyId, setActivationBusyId] = useState(null);
    const [mobileCheckout, setMobileCheckout] = useState(false);
    const [pendingCancellation, setPendingCancellation] = useState(null);
    const purchaseFlashTimerRef = useRef(null);
    const syncAccount = useSyncExternalStore(
        shopAuthService.subscribe,
        shopAuthService.getSnapshot,
        shopAuthService.getSnapshot,
    );
    const purchaseOnline = !syncAccount.configured || syncAccount.syncStatus === 'ready';

    const playerUUID = appCurrentPlayer?.UUID || null;
    const { activePageId, selectPage } = useLocalSectionRoute({
        sectionId: 'shop',
        pages: mobileRestricted ? MOBILE_SHOP_PAGES : SHOP_PAGES,
        profileUUID: playerUUID,
        databaseConnection,
        defaultPageId: mobileRestricted ? 'browse' : 'featured',
    });

    useEffect(() => {
        setCurrentPlayer(appCurrentPlayer || null);
    }, [appCurrentPlayer]);

    useEffect(() => {
        void shopAuthService.initialize().catch(() => undefined);
    }, []);

    const loadCatalog = useCallback(async (request = null) => {
        const repository = databaseConnection.getRepository?.('shop');
        const items = repository
            ? await repository.getCatalog()
            : await databaseConnection.getAll(STORES.shop);
        if (request && !request.isCurrent()) return;
        setShopItems(sortShopCatalog(items));
    }, [databaseConnection]);

    const loadOwnedInventory = useCallback(async (request = null) => {
        if (!playerUUID) {
            setPlayerInventory([]);
            setInventoryStatus('ready');
            return;
        }
        setInventoryStatus('loading');
        await ensureDomainLoaded?.('inventory');
        if (request && !request.isCurrent()) return;
        const repository = databaseConnection.getRepository?.('inventory');
        const inventory = repository
            ? await repository.getOwnedByPlayer(playerUUID)
            : await databaseConnection.getPlayerStore(STORES.inventory, playerUUID);
        if (request && !request.isCurrent()) return;
        setPlayerInventory(inventory);
        setInventoryStatus('ready');
    }, [databaseConnection, ensureDomainLoaded, playerUUID]);

    const loadPurchaseHistory = useCallback(async () => {
        if (!playerUUID) return setPurchaseHistory([]);
        const transactions = await databaseConnection.getAll(STORES.transaction);
        setPurchaseHistory(transactions
            .filter((entry) => entry.parent === playerUUID && entry.type === 'shop_purchase')
            .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || ''))));
    }, [databaseConnection, playerUUID]);

    const loadActiveEffects = useCallback(async () => {
        if (!playerUUID || !databaseConnection.syncRuntime?.client?.query) return setActiveEffects([]);
        const rows = await databaseConnection.syncRuntime.client.query({
            sql: `SELECT effect.id,effect.player_id AS playerId,effect.source_id AS sourceId,effect.effect_scope AS effectScope,
                         starts_at AS startsAt,ends_at AS endsAt,multiplier,stacking_rule AS stackingRule
                  FROM effect_intervals effect
                  LEFT JOIN effect_cancellation_receipts cancellation ON cancellation.interval_id=effect.id
                  WHERE effect.player_id=? AND effect.ends_at>? AND cancellation.id IS NULL ORDER BY effect.ends_at`,
            bind: [playerUUID, new Date().toISOString()],
            result: 'all',
        });
        setActiveEffects(rows);
    }, [databaseConnection, playerUUID]);

    useEffect(() => {
        if (!canLoad) return undefined;
        const request = beginPanelRequest();
        loadCatalog(request)
            .catch((error) => console.warn('[Shop] catalog load failed:', error))
            .finally(request.finish);
        return request.cancel;
    }, [
        beginPanelRequest,
        canLoad,
        loadCatalog,
        domainRevisions.shop,
    ]);

    useEffect(() => {
        if (!canLoad) return;
        loadPurchaseHistory().catch((error) => console.warn('[Shop] history load failed:', error));
    }, [canLoad, domainRevisions.shop, loadPurchaseHistory]);

    useEffect(() => {
        if (canLoad) void loadActiveEffects().catch((error) => console.warn('[Shop] active effects unavailable:', error));
    }, [canLoad, domainRevisions.inventory, loadActiveEffects]);

    useEffect(() => {
        if (!canLoad) return undefined;
        const request = beginPanelRequest();
        loadOwnedInventory(request)
            .catch((error) => {
                if (request.isCurrent()) setInventoryStatus('error');
                console.warn('[Shop] inventory load failed:', error);
            })
            .finally(request.finish);
        return request.cancel;
    }, [
        beginPanelRequest,
        canLoad,
        loadOwnedInventory,
        domainRevisions.inventory,
    ]);

    useEffect(() => {
        if (isActive) return undefined;
        if (purchaseFlashTimerRef.current != null) {
            window.clearTimeout(purchaseFlashTimerRef.current);
            purchaseFlashTimerRef.current = null;
        }
        setPurchaseFlash(false);
        return undefined;
    }, [isActive]);

    useEffect(() => () => {
        if (purchaseFlashTimerRef.current != null) {
            window.clearTimeout(purchaseFlashTimerRef.current);
        }
    }, []);

    const handleMoneyLog = async ({ title, description, amount }) => {
        if (!currentPlayer) return;
        const now = new Date().toISOString();
        const today = new Date().toDateString();
        // Log as a transaction so it lives in the dedicated money ledger
        // (the profile timeline also surfaces transactions alongside events)
        const transactionUUID = uuid();
        const transaction = {
            UUID: transactionUUID,
            parent: currentPlayer.UUID,
            type: 'money_log',
            name: title,
            description: description || '',
            amount,
            cost: amount,
            createdAt: now,
            completedAt: now,
        };
        // The ledger entry, shared balance, and per-player daily marker are one
        // financial command. A crash cannot now save the money without its log
        // (or save the log without the corresponding balance change).
        const currentMoney = databaseConnection.getGlobalMoney();
        await databaseConnection.commitAtomicMutation({
            label: 'shop-money-log',
            puts: [
                { store: STORES.transaction, record: transaction },
                { store: STORES.player, record: { ...currentPlayer, lastMoneyLogDate: today } },
            ],
            globalMoney: currentMoney + amount,
            flush: false,
        });
        setShowMoneyLog(false);
        setCurrentPlayer((player) => player ? { ...player, lastMoneyLogDate: today } : player);
        invalidateDomains(DOMAIN_INVALIDATION.walletWrite);
        emitRewardEvent?.([{ amount, unit: 'cash', kind: 'coins' }], { source: 'shop' });
        notify?.({ title: 'Cash logged', message: `+$${amount.toFixed(2)} added to your balance.`, kind: 'success', persist: false });
        await ensureDomainLoaded?.('achievements');
        await queueAchievementEvent(databaseConnection, createAchievementEvent({
            type: ACHIEVEMENT_EVENT_TYPE.economyLogged,
            parent: currentPlayer.UUID,
            sourceUUID: transactionUUID,
            occurredAt: now,
            payload: { amount },
        }), {
            onEarned: (keys) => keys.forEach((key) => {
                const achievement = getAchievementByKey(key);
                if (achievement) notify?.({ title: 'Achievement Unlocked', message: achievement.label, kind: 'success', persist: false });
            }),
        });
        loadCatalog();
    };

    const navCategories = useMemo(
        () => ['All', ...new Set(shopItems.map((item) => item.category).filter(Boolean))],
        [shopItems],
    );
    const formCategories = useMemo(
        () => [...new Set([...SHOP_CATEGORIES, ...shopItems.map((item) => item.category).filter(Boolean)])],
        [shopItems],
    );

    useEffect(() => {
        if (activeCategory !== 'All' && !navCategories.includes(activeCategory)) {
            setActiveCategory('All');
        }
    }, [activeCategory, navCategories]);

    const catalogEntries = useMemo(
        () => shopItems.map((item) => ({ item })),
        [shopItems],
    );

    const filteredEntries = useMemo(
        () => {
            const pageEntries = activePageId === 'collections'
                ? catalogEntries.filter(({ item }) => isCosmeticItem(item))
                : activePageId === 'featured'
                    ? catalogEntries.filter(({ item }, index) => item.featured || isSystemCosmeticItem(item) || index < 6)
                    : catalogEntries;
            return activeCategory === 'All'
                ? pageEntries
                : pageEntries.filter(({ item }) => item.category === activeCategory);
        },
        [activeCategory, activePageId, catalogEntries],
    );

    const getCartQty = (item) => {
        const entry = cart.find(e => itemsMatch(e.item, item));
        return entry ? entry.qty : 0;
    };

    const addToCart = (item) => {
        if (!purchaseOnline) return;
        if (inventoryStatus !== 'ready') return;
        const inventoryItem = findInventoryForShopItem(playerInventory, item);
        const pending = getCartQty(item);
        if (!canPurchaseShopItem(item, inventoryItem, new Date(), pending)) {
            recordAnalyticsEvent(databaseConnection, currentPlayer, {
                surface: 'shop',
                targetType: 'shopItem',
                targetUUID: item.UUID || item.name,
                eventName: 'shop_item_unavailable',
                metadata: { name: item.name || null, category: item.category || null, source: 'shop-add' },
            }).catch((error) => console.warn('[Shop] unavailable analytics tracking failed:', error));
            return;
        }
        recordAnalyticsEvent(databaseConnection, currentPlayer, {
            surface: 'shop',
            targetType: 'shopItem',
            targetUUID: item.UUID || item.name,
            eventName: 'shop_item_added_to_cart',
            metadata: { name: item.name || null, category: item.category || null, source: 'shop-add' },
        }).catch((error) => console.warn('[Shop] add analytics tracking failed:', error));
        const cost = shopItemCost(item);
        setCart(prev => {
            const existing = prev.find(e => itemsMatch(e.item, item));
            if (existing) {
                return prev.map(e => itemsMatch(e.item, item)
                    ? { ...e, qty: e.qty + 1, totalCost: (e.qty + 1) * cost }
                    : e
                );
            }
            return [...prev, { item, qty: 1, totalCost: cost }];
        });
    };

    const removeFromCart = (item, removeAll = false) => {
        const cost = shopItemCost(item);
        setCart(prev => {
            const existing = prev.find(e => itemsMatch(e.item, item));
            if (!existing) return prev;
            if (removeAll || existing.qty <= 1) return prev.filter(e => !itemsMatch(e.item, item));
            return prev.map(e => itemsMatch(e.item, item)
                ? { ...e, qty: e.qty - 1, totalCost: (e.qty - 1) * cost }
                : e
            );
        });
    };

    const handleDeleteItem = async (item) => {
        if (mobileRestricted) return;
        if (!item?.UUID) return;
        if (isSystemCosmeticItem(item)) return;
        await databaseConnection.remove(STORES.shop, item.UUID);
        setCart(prev => prev.filter(entry => !itemsMatch(entry.item, item)));
        invalidateDomains(DOMAIN_INVALIDATION.shopCatalogWrite);
        notify?.({ title: 'Shop updated', message: `${item.name} removed from the catalog.`, kind: 'info', persist: false });
        loadCatalog();
    };

    const handleOpenItem = (item) => {
        if (!item) return;
        recordAnalyticsEvent(databaseConnection, currentPlayer, {
            surface: 'shop',
            targetType: 'shopItem',
            targetUUID: item.UUID || item.name,
            eventName: 'shop_item_opened',
            metadata: { name: item.name || null, category: item.category || null, source: 'shop-detail' },
        }).catch((error) => console.warn('[Shop] open analytics tracking failed:', error));
        setSelectedItem(item);
    };

    const handlePurchase = async () => {
        if (!purchaseOnline) return;
        if (!currentPlayer || inventoryStatus !== 'ready' || cart.length === 0) return;
        try {
            const purchase = await commitShopPurchase(databaseConnection, {
                playerUUID: currentPlayer.UUID,
                cart,
                purchaseBatchUUID: uuid(),
                origin: mobileRestricted ? 'mobile' : 'desktop',
                requireOnlineAuthority: syncAccount.configured,
            });

            // The authoritative purchase is committed before any analytics or
            // achievement work is started.
            setCurrentPlayer(purchase.player);
            setPlayerInventory(purchase.playerInventory);
            if (purchase.catalogRecords.length > 0) {
                const replacements = new Map(purchase.catalogRecords.map((item) => [item.UUID, item]));
                setShopItems((items) => sortShopCatalog(items.map((item) => replacements.get(item.UUID) || item)));
            }
            setCart([]);
            setMobileCheckout(false);
            invalidateDomains(DOMAIN_INVALIDATION.shopPurchaseCommit);
            void databaseConnection.syncRuntime?.synchronize?.({ reason: 'mobile-commerce-purchase' }).catch(() => undefined);

            emitRewardEvent?.([
                purchase.tokenCost > 0 ? { amount: -purchase.tokenCost, unit: 'coins', kind: 'event-penalty' } : null,
                purchase.dollarCost > 0 ? { label: `-$${purchase.dollarCost.toFixed(2)} cash`, kind: 'event-penalty' } : null,
                { label: `Added ${purchase.itemCount} item${purchase.itemCount === 1 ? '' : 's'}`, kind: 'inventory' },
            ].filter(Boolean), { source: 'shop' });
            notify?.({
                title: 'Purchase complete',
                message: `Added ${purchase.itemCount} item${purchase.itemCount === 1 ? '' : 's'} to inventory.`,
                kind: 'success',
                persist: false,
            });

            void processShopPurchaseSecondaryEffects(databaseConnection, purchase, {
                onAchievementEarned: (keys) => keys.forEach((key) => {
                    const achievement = getAchievementByKey(key);
                    if (achievement) notify?.({ title: 'Achievement Unlocked', message: achievement.label, kind: 'success', persist: false });
                }),
            }).then(() => {
                invalidateDomains(DOMAIN_INVALIDATION.shopPurchaseSecondary);
            }).catch((error) => {
                console.warn('[Shop] post-purchase processing failed:', error);
            });

            setPurchaseFlash(true);
            await loadPurchaseHistory();
            if (purchaseFlashTimerRef.current != null) {
                window.clearTimeout(purchaseFlashTimerRef.current);
            }
            purchaseFlashTimerRef.current = window.setTimeout(() => {
                purchaseFlashTimerRef.current = null;
                setPurchaseFlash(false);
            }, 800);
        } catch (error) {
            console.warn('[Shop] purchase failed:', error);
            try {
                const canonical = await reconcileShopAuthority(databaseConnection, currentPlayer.UUID);
                if (canonical) {
                    setCurrentPlayer(canonical.player);
                    setPlayerInventory(canonical.inventoryRecords);
                    setShopItems(sortShopCatalog(canonical.catalogRecords));
                    invalidateDomains(DOMAIN_INVALIDATION.shopPurchaseCommit);
                }
            } catch (reconcileError) {
                console.warn('[Shop] authority reconciliation failed:', reconcileError);
            }
            notify?.({
                title: 'Purchase not completed',
                message: error?.message || 'The purchase could not be committed.',
                kind: 'warning',
                persist: false,
            });
            void loadCatalog();
            void loadOwnedInventory();
        }
    };

    const handleUseInventory = async (item) => {
        if (!purchaseOnline || activationBusyId) return;
        setActivationBusyId(item.UUID);
        try {
            const activation = await activateShopItemCommand(databaseConnection, item);
            setPlayerInventory((records) => records.map((record) => (
                record.UUID === activation.inventoryRecord.UUID ? activation.inventoryRecord : record
            )));
            if (activation.effectInterval) setActiveEffects((records) => [...records, activation.effectInterval]);
            invalidateDomains(DOMAIN_INVALIDATION.inventoryUse);
            void databaseConnection.syncRuntime?.synchronize?.({ reason: 'mobile-commerce-activation' }).catch(() => undefined);
            notify?.({ title: 'Item active', message: `${item.name} is now active on every connected device.`, kind: 'success', persist: false });
        } catch (error) {
            notify?.({ title: 'Item unavailable', message: error?.message || 'The item could not be used.', kind: 'error', persist: false });
        } finally {
            setActivationBusyId(null);
        }
    };

    const handleCancelEffect = async () => {
        const pending = pendingCancellation;
        if (!pending?.effect || activationBusyId) return;
        setPendingCancellation(null);
        setActivationBusyId(pending.item.UUID);
        try {
            await cancelShopEffectCommand(databaseConnection, pending.effect);
            setActiveEffects((records) => records.filter((record) => record.id !== pending.effect.id));
            invalidateDomains(DOMAIN_INVALIDATION.inventoryUse);
            void databaseConnection.syncRuntime?.synchronize?.({ reason: 'mobile-commerce-cancellation' }).catch(() => undefined);
            notify?.({ title: 'Effect ended', message: `${pending.item.name} ended early. No refund was issued.`, kind: 'info', persist: false });
        } catch (cancelError) {
            notify?.({ title: 'Effect still active', message: cancelError?.message || 'The effect could not be ended.', kind: 'error', persist: false });
        } finally {
            setActivationBusyId(null);
        }
    };

    const handleSubmitItem = async (formData) => {
        if (mobileRestricted) return;
        const isEditing = !!editingItem;
        if (isEditing && isSystemCosmeticItem(editingItem)) return;
        if (formData.type === ITEM_TYPE.cosmetic_title) return;
        const record = {
            ...(isEditing ? editingItem : {}),
            ...formData,
            UUID: isEditing ? editingItem.UUID : uuid(),
            itemId: formData.itemId || null,
            cost: formData.cost ?? calculateItemCost(formData.type, formData.duration, formData.quantity, formData.priceTier ?? formData.enjoyment),
            duration: formData.type === ITEM_TYPE.duration ? parseFloat(formData.duration) : null,
            quantity: formData.type === ITEM_TYPE.quantity ? parseFloat(formData.quantity) : 1,
            enjoyment: parseInt(formData.enjoyment, 10),
            priceTier: getShopPriceTier(formData.priceTier ?? formData.enjoyment).id,
            currencyType: formData.currencyType || 'tokens',
            icon: null,
            bannerImageUrl: formData.bannerImageUrl || null,
            cooldownMs: Math.max(0, Number(formData.cooldownMinutes || 0)) * 60000,
            purchaseLimitPerPlayer: formData.purchaseLimitPerPlayer ? Math.max(1, Number(formData.purchaseLimitPerPlayer)) : null,
            stockLimit: formData.stockLimit ? Math.max(1, Number(formData.stockLimit)) : null,
            displayOrder: Number.isFinite(Number(editingItem?.displayOrder))
                ? Number(editingItem.displayOrder)
                : (shopItems.length + 1) * 100,
        };
        await databaseConnection.add(STORES.shop, record);
        // Drop from cart if it's stale (type/cost changed)
        if (isEditing) {
            setCart((prev) => prev.filter((entry) => !itemsMatch(entry.item, record)));
        }
        invalidateDomains(DOMAIN_INVALIDATION.shopCatalogWrite);
        notify?.({
            title: 'Shop updated',
            message: `${record.name} ${isEditing ? 'updated' : 'added to the shop'}.`,
            kind: 'success',
            persist: false,
        });
        loadCatalog();
    };

    const purchaseItemCount = cart.reduce((sum, entry) => sum + entry.qty, 0);
    const purchaseTokenTotal = cart
        .filter((entry) => (entry.item.currencyType || 'tokens') === 'tokens')
        .reduce((sum, entry) => sum + entry.totalCost, 0);
    const purchaseDollarTotal = cart
        .filter((entry) => entry.item.currencyType === 'dollars')
        .reduce((sum, entry) => sum + entry.totalCost, 0);
    const purchaseCostLabel = [
        purchaseTokenTotal ? `${purchaseTokenTotal} tokens` : null,
        purchaseDollarTotal ? `$${purchaseDollarTotal.toFixed(2)}` : null,
    ].filter(Boolean).join(' and ');

    const editorOpen = !mobileRestricted && (showAddForm || Boolean(editingItem));

    return (
        <div className={`shop-page ${mobileRestricted ? 'shop-page--mobile' : ''} ${mobileCheckout ? 'shop-page--checkout' : ''} ${purchaseFlash ? 'purchase-flash' : ''} ${editorOpen ? 'shop-page--editing' : ''}`}>
            <PageHeader
                eyebrow="Rewards"
                title="Shop"
                className="shop-page-header"
            />
            {mobileRestricted && (
                <div className="shop-mobile-toolbar">
                    <div><span>Wallet</span><strong>◈ {currentPlayer?.tokens ?? 0}</strong></div>
                    <button type="button" className={activePageId === 'inventory' && !mobileCheckout ? 'is-active' : ''} onClick={() => { setMobileCheckout(false); selectPage('inventory'); }}>Inventory</button>
                    <button type="button" className={mobileCheckout ? 'is-active' : ''} onClick={() => setMobileCheckout(true)}>
                        Cart{purchaseItemCount > 0 && <b>{purchaseItemCount}</b>}
                    </button>
                </div>
            )}
            {!mobileRestricted && <LocalSectionNav
                items={SHOP_PAGES}
                value={activePageId}
                onChange={selectPage}
                label="Shop sections"
            />}
            {mobileRestricted && !mobileCheckout && activePageId === 'inventory' && (
                <button type="button" className="shop-mobile-browse-link" onClick={() => selectPage('browse')}>← Browse shop</button>
            )}
            {!mobileCheckout && activePageId === 'browse' && (
                <nav className="shop-category-nav">
                    {navCategories.map(cat => (
                        <button key={cat} type="button" className={`cat-tab ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>{cat}</button>
                    ))}
                    {!mobileRestricted && <button type="button" className="cat-tab add-tab" onClick={() => setShowAddForm(true)}>Add item</button>}
                </nav>
            )}

            {mobileCheckout ? (
                <section className="shop-mobile-checkout">
                    <button type="button" className="shop-mobile-browse-link" onClick={() => setMobileCheckout(false)}>← Continue shopping</button>
                    <header><span>Checkout</span><h2>Review your rewards</h2></header>
                    <CartSidebar
                        cart={cart}
                        tokens={currentPlayer?.tokens ?? 0}
                        money={databaseConnection.getGlobalMoney()}
                        purchaseReady={inventoryStatus === 'ready' && purchaseOnline}
                        onRemove={removeFromCart}
                        onPurchase={() => setPurchaseConfirm(true)}
                        onClear={() => setCart([])}
                    />
                </section>
            ) : <div className="shop-body">
                <main className="shop-grid-area">
                    {activePageId === 'inventory' ? (
                        <ShopInventoryPanel
                            inventory={playerInventory}
                            effects={activeEffects}
                            online={purchaseOnline}
                            busyId={activationBusyId}
                            onUse={handleUseInventory}
                            onCancel={(effect, item) => setPendingCancellation({ effect, item })}
                        />
                    ) : activePageId === 'history' ? (
                        <div className="shop-history">
                            {purchaseHistory.map((entry) => (
                                <article key={entry.UUID}>
                                    <ShopItemImage item={entry} />
                                    <div>
                                        <strong>{entry.name}</strong>
                                        <span>{new Date(entry.createdAt).toLocaleString()}</span>
                                    </div>
                                    <span>×{entry.quantity || 1}</span>
                                    <b>{entry.currencyType === 'dollars' ? `$${Number(entry.totalCost).toFixed(2)}` : `◈ ${entry.totalCost}`}</b>
                                </article>
                            ))}
                            {!purchaseHistory.length && <EmptyState icon="◇" title="No purchases yet." />}
                        </div>
                    ) : filteredEntries.length === 0 ? (
                        <EmptyState
                            icon="◇"
                            title="No shop items."
                            description={mobileRestricted ? 'Catalog items will appear after your account syncs.' : 'Create the first reward.'}
                            action={mobileRestricted ? null : <button type="button" className="primary" onClick={() => setShowAddForm(true)}>Add item</button>}
                        />
                    ) : (
                        <ProgressiveShopCatalog
                            entries={filteredEntries}
                            playerInventory={playerInventory}
                            inventoryReady={inventoryStatus === 'ready'}
                            getCartQty={getCartQty}
                            onAdd={addToCart}
                            onRemove={removeFromCart}
                            onDelete={setPendingDelete}
                            onEdit={(item) => {
                                if (isSystemCosmeticItem(item)) return;
                                setEditingItem(item);
                            }}
                            onOpen={handleOpenItem}
                            readOnly={!purchaseOnline}
                            adminEnabled={!mobileRestricted}
                        />
                    )}
                </main>

                {!mobileRestricted && !editorOpen && !['history', 'inventory'].includes(activePageId) && (
                    <CartSidebar
                        cart={cart}
                        tokens={currentPlayer?.tokens ?? 0}
                        money={databaseConnection.getGlobalMoney()}
                        purchaseReady={inventoryStatus === 'ready' && purchaseOnline}
                        onRemove={removeFromCart}
                        onPurchase={() => setPurchaseConfirm(true)}
                        onClear={() => setCart([])}
                        onLogMoney={mobileRestricted ? null : () => setShowMoneyLog(true)}
                    />
                )}
            </div>}

            {!mobileRestricted && (showAddForm || editingItem) && (
                <ShopItemForm
                    initialItem={editingItem}
                    onSubmit={handleSubmitItem}
                    onClose={() => { setShowAddForm(false); setEditingItem(null); }}
                    categories={formCategories}
                />
            )}

            {!mobileRestricted && showMoneyLog && (
                <MoneyLogModal
                    currentPlayer={currentPlayer}
                    onSubmit={handleMoneyLog}
                    onClose={() => setShowMoneyLog(false)}
                />
            )}

            <ShopItemDetail
                item={selectedItem}
                inventoryItem={findInventoryForShopItem(playerInventory, selectedItem)}
                inventoryReady={inventoryStatus === 'ready'}
                cartQty={selectedItem ? getCartQty(selectedItem) : 0}
                onAdd={addToCart}
                onClose={() => setSelectedItem(null)}
                readOnly={!purchaseOnline}
            />

            {!mobileRestricted && <ConfirmDialog
                open={Boolean(pendingDelete)}
                title="Delete this shop item?"
                message="It will be removed from the catalog."
                target={pendingDelete?.name || ''}
                confirmLabel="Delete"
                destructive
                onCancel={() => setPendingDelete(null)}
                onConfirm={async () => {
                    const item = pendingDelete;
                    setPendingDelete(null);
                    await handleDeleteItem(item);
                }}
            />}

            <ConfirmDialog
                open={purchaseConfirm}
                title="Confirm purchase"
                message={`Buy ${purchaseItemCount} item${purchaseItemCount === 1 ? '' : 's'} for ${purchaseCostLabel}?`}
                confirmLabel="Buy"
                onCancel={() => setPurchaseConfirm(false)}
                onConfirm={async () => {
                    setPurchaseConfirm(false);
                    await handlePurchase();
                }}
            />
            <ConfirmDialog
                open={Boolean(pendingCancellation)}
                title="End this effect early?"
                message="The effect stops immediately on every device. Its original interval remains as evidence and no refund is issued."
                target={pendingCancellation?.item?.name || ''}
                confirmLabel="End effect"
                destructive
                onCancel={() => setPendingCancellation(null)}
                onConfirm={handleCancelEffect}
            />
        </div>
    );
}

export default Shop;
