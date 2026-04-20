import './Shop.css';
import { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from '../../App.jsx';
import { STORES, ITEM_TYPE, COSMETIC_THEMES, COSMETIC_FONTS, COSMETIC_PASSES } from '../../utils/Constants.js';
import { calculateItemCost, SHOP_CATEGORIES } from '../../utils/Helpers/Shop.js';
import { v4 as uuid } from 'uuid';
import { checkPassiveAchievements, getAchievementByKey } from '../../utils/Achievements.js';

const itemsMatch = (left, right) => {
    if (!left || !right) return false;
    if (left.UUID && right.UUID) return left.UUID === right.UUID;
    return left.name === right.name;
};

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
                    <span>LOG CASH</span>
                    <button type="button" className="close-btn" onClick={onClose}>✕</button>
                </div>

                {usedToday ? (
                    <div className="money-log-locked">
                        <div className="money-log-locked-icon">$</div>
                        <p className="money-log-locked-title">Already logged today</p>
                        <p className="money-log-locked-sub">Cash can only be logged once per day. Come back tomorrow to record more income.</p>
                        <button type="button" className="primary money-log-locked-btn" onClick={onClose}>GOT IT</button>
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
                                LOG CASH
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
        <div className="enjoyment-dots" title={`Distraction level ${level}/3`}>
            {[1, 2, 3].map(i => (
                <span key={i} className={`dot ${i <= level ? 'active' : ''}`} />
            ))}
        </div>
    );
}

function ShopItemCard({ item, cartQty, onAdd, onRemove, onDelete, onEdit }) {
    const cost = item.cost ?? calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
    const isDuration = item.type === ITEM_TYPE.duration;
    const isDollars  = item.currencyType === 'dollars';

    return (
        <div className={`shop-card ${cartQty > 0 ? 'in-cart' : ''}`}>
            <div className="shop-card-icon">{item.icon}</div>
            <div className="shop-card-body">
                <div className="shop-card-header">
                    <span className="shop-card-name">{item.name}</span>
                    <EnjoymentDots level={item.enjoyment} />
                </div>
                <p className="shop-card-desc">{item.description}</p>
                <div className="shop-card-meta">
                    <span className="shop-card-duration">
                        {isDuration ? `${item.duration} min` : `×${item.quantity}`}
                    </span>
                    <span className={`shop-card-type type-${item.enjoyment}`}>
                        {['', 'FOCUS', 'MODERATE', 'HIGH'][item.enjoyment]}
                    </span>
                </div>
            </div>
            <div className="shop-card-purchase">
                <span className={`shop-card-cost ${isDollars ? 'cost-dollars' : ''}`}>
                    <span className={`shop-card-cost-icon ${isDollars ? 'money-icon' : ''}`}>
                        {isDollars ? '$' : '◈'}
                    </span>
                    <span className="shop-card-cost-val">
                        {isDollars ? Number(cost).toFixed(2) : cost}
                    </span>
                </span>
                {cartQty > 0 ? (
                    <div className="cart-controls">
                        <button type="button" className="qty-btn" onClick={() => onRemove(item)}>−</button>
                        <span className="cart-qty">{cartQty}</span>
                        <button type="button" className="qty-btn" onClick={() => onAdd(item)}>+</button>
                    </div>
                ) : (
                    <button type="button" className="add-btn" onClick={() => onAdd(item)}>ADD</button>
                )}
                <div className="shop-card-admin">
                    <button type="button" className="edit-btn" onClick={() => onEdit(item)}>EDIT</button>
                    <button type="button" className="clear-btn" onClick={() => onDelete(item)}>DELETE</button>
                </div>
            </div>
        </div>
    );
}

function ShopItemForm({ initialItem, onSubmit, onClose, categories }) {
    const isEditing = !!initialItem;
    const [form, setForm] = useState(initialItem ? {
        name: initialItem.name || '',
        description: initialItem.description || '',
        type: initialItem.type || ITEM_TYPE.duration,
        duration: initialItem.duration || 30,
        quantity: initialItem.quantity || 1,
        enjoyment: initialItem.enjoyment || 1,
        category: initialItem.category || categories[0] || 'Rest',
        icon: initialItem.icon || '⭐',
        currencyType: initialItem.currencyType || 'tokens',
    } : {
        name: '', description: '', type: ITEM_TYPE.duration,
        duration: 30, quantity: 1, enjoyment: 1, category: categories[0] || 'Rest', icon: '⭐',
        currencyType: 'tokens',
    });
    const [costInput, setCostInput] = useState(
        String(initialItem?.cost ?? calculateItemCost(ITEM_TYPE.duration, 30, 1, 1))
    );
    const [costLocked, setCostLocked] = useState(!!initialItem?.cost);

    const set = (k, v) => {
        const next = { ...form, [k]: v };
        setForm(next);
        // Auto-update cost when relevant fields change and user hasn't overridden
        if (!costLocked && (k === 'duration' || k === 'quantity' || k === 'enjoyment' || k === 'type')) {
            const auto = calculateItemCost(
                k === 'type'      ? v : next.type,
                k === 'duration'  ? v : next.duration,
                k === 'quantity'  ? v : next.quantity,
                k === 'enjoyment' ? v : next.enjoyment,
            );
            setCostInput(String(auto));
        }
    };

    const handleCostChange = (e) => {
        setCostInput(e.target.value);
        setCostLocked(true);
    };

    const resetCost = () => {
        const auto = calculateItemCost(form.type, form.duration, form.quantity, form.enjoyment);
        setCostInput(String(auto));
        setCostLocked(false);
    };

    const isDollars = form.currencyType === 'dollars';
    const finalCost = isDollars
        ? Math.max(0.01, parseFloat(costInput) || 0.01)
        : Math.max(1, parseInt(costInput, 10) || 1);

    return (
        <div className="add-item-overlay" onClick={onClose}>
            <div className="add-item-form" onClick={e => e.stopPropagation()}>
                <div className="form-header">
                    <span>{isEditing ? 'EDIT ITEM' : 'NEW ITEM'}</span>
                    <button type="button" className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="form-grid">
                    <div className="span2 form-identity-row">
                        <label className="form-icon-field">Icon
                            <input value={form.icon} onChange={e => set('icon', e.target.value)} maxLength={2} />
                        </label>
                        <label className="form-name-field">Name
                            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Coffee break" />
                        </label>
                    </div>
                    <label className="span2">Description
                        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} placeholder="Short note for future-you" />
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
                    {form.type === ITEM_TYPE.duration ? (
                        <label>Duration (min)
                            <input type="number" min={1} value={form.duration} onChange={e => set('duration', e.target.value)} />
                        </label>
                    ) : (
                        <label>Quantity
                            <input type="number" min={1} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
                        </label>
                    )}
                    <label>Distraction
                        <select value={form.enjoyment} onChange={e => set('enjoyment', parseInt(e.target.value, 10))}>
                            <option value={1}>1 — Focus-safe</option>
                            <option value={2}>2 — Moderate</option>
                            <option value={3}>3 — High</option>
                        </select>
                    </label>

                    {/* ── Currency / price section ───────────────────── */}
                    <div className="span2 form-price-block">
                        <div className="form-price-label">
                            <span>Price</span>
                            {costLocked
                                ? <span className="cost-badge cost-badge-manual">MANUAL</span>
                                : <span className="cost-badge cost-badge-auto">AUTO</span>
                            }
                            {costLocked && (
                                <button type="button" className="cost-reset-btn" onClick={resetCost}>↺ reset</button>
                            )}
                        </div>
                        <div className="form-price-row">
                            <div className="currency-toggle" role="tablist">
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={!isDollars}
                                    className={`currency-chip ${!isDollars ? 'is-active' : ''}`}
                                    onClick={() => set('currencyType', 'tokens')}
                                >
                                    <span className="currency-chip-icon">◈</span>
                                    <span>Tokens</span>
                                </button>
                                <button
                                    type="button"
                                    role="tab"
                                    aria-selected={isDollars}
                                    className={`currency-chip currency-chip--dollars ${isDollars ? 'is-active' : ''}`}
                                    onClick={() => set('currencyType', 'dollars')}
                                >
                                    <span className="currency-chip-icon">$</span>
                                    <span>Dollars</span>
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
                </div>
                <div className="form-footer">
                    <button type="button" onClick={onClose}>CANCEL</button>
                    <button type="button" className="primary" onClick={() => { onSubmit({ ...form, cost: finalCost }); onClose(); }}>
                        {isEditing ? 'SAVE CHANGES' : 'CREATE ITEM'}
                    </button>
                </div>
            </div>
        </div>
    );
}

/* ── Cosmetics shop section ─────────────────────────────── */
function CosmeticItem({ item, owned, onBuy, tokens }) {
  const colorMap = { default: '#4da3ff', crimson: '#ff6b6b', emerald: '#34d399', violet: '#a78bfa', gold: '#fbbf24', shadow: '#818cf8' };
  const c = colorMap[item.id];
  const canAfford = tokens >= item.cost;

  return (
    <div className={`shop-card cosmetic-card ${owned ? 'owned' : ''}`}>
      {c && <div className="cosmetic-swatch" style={{ background: c }} />}
      <div className="shop-card-body">
        <div className="shop-card-header">
          <span className="shop-card-name">{item.label}</span>
          {owned && <span className="cosmetic-owned-badge">OWNED</span>}
        </div>
        <p className="shop-card-desc">{item.id === 'default' ? 'Default theme — always available.' : `Unlocks the ${item.label} color theme.`}</p>
      </div>
      <div className="shop-card-purchase">
        <span className="shop-card-cost">
          <span className="cost-icon">◈</span>{item.cost}
        </span>
        {item.free || owned
          ? <span className="add-btn" style={{ background: 'transparent', color: 'var(--text-dim)', cursor: 'default', border: '1px solid var(--border-subtle)' }}>{item.free ? 'FREE' : '✓'}</span>
          : <button type="button" className="add-btn" onClick={() => onBuy(item)} disabled={!canAfford} title={!canAfford ? 'Not enough tokens' : ''}>BUY</button>
        }
      </div>
    </div>
  );
}

function CartSidebar({ cart, tokens, money, onRemove, onPurchase, onClear, onLogMoney }) {
    const tokenItems  = cart.filter(e => (e.item.currencyType || 'tokens') === 'tokens');
    const dollarItems = cart.filter(e => e.item.currencyType === 'dollars');
    const tokenTotal  = tokenItems.reduce((s, e) => s + e.totalCost, 0);
    const dollarTotal = dollarItems.reduce((s, e) => s + e.totalCost, 0);
    const canAfford   = tokens >= tokenTotal && (money || 0) >= dollarTotal;

    return (
        <aside className="cart-sidebar">
            <div className="cart-header">
                <span>CART</span>
                {cart.length > 0 && (
                    <button type="button" className="clear-btn" onClick={onClear}>CLEAR</button>
                )}
            </div>

            <div className="cart-token-balance">
                <span className="balance-label">TOKENS</span>
                <span className="balance-value"><span className="cost-icon">◈</span>{tokens ?? 0}</span>
            </div>

            <div className="cart-token-balance cart-balance--cash">
                <span className="balance-label">CASH</span>
                <button
                    type="button"
                    className="money-balance-btn"
                    onClick={onLogMoney}
                    title="Log cash income"
                >
                    <span className="money-icon">$</span>
                    <span className="money-balance-val">{(money || 0).toFixed(2)}</span>
                    <span className="money-log-hint-icon" aria-hidden="true">+</span>
                </button>
            </div>

            <div className="cart-items">
                {cart.length === 0 ? (
                    <p className="cart-empty">Your cart is empty.</p>
                ) : cart.map(entry => {
                    const isDollars = entry.item.currencyType === 'dollars';
                    return (
                        <div key={entry.item.UUID || entry.item.name} className="cart-line">
                            <span className="cart-line-icon">{entry.item.icon}</span>
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
                            <span>TOKENS</span>
                            <span className={tokens >= tokenTotal ? 'cost-ok' : 'cost-over'}>◈ {tokenTotal}</span>
                        </div>
                    )}
                    {dollarTotal > 0 && (
                        <div className="cart-total">
                            <span>CASH</span>
                            <span className={`cost-dollars ${(money || 0) >= dollarTotal ? 'cost-ok' : 'cost-over'}`}>
                                $ {dollarTotal.toFixed(2)}
                            </span>
                        </div>
                    )}
                    {!canAfford && <p className="cart-warning">Insufficient balance</p>}
                    <button
                        type="button"
                        className={`purchase-btn ${canAfford ? 'primary' : 'disabled'}`}
                        onClick={canAfford ? onPurchase : undefined}
                        disabled={!canAfford}
                    >
                        PURCHASE
                    </button>
                </div>
            )}
        </aside>
    );
}

function Shop() {
    const { databaseConnection, timestamp, refreshApp, notify } = useContext(AppContext);
    const [shopItems, setShopItems] = useState([]);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [activeCategory, setActiveCategory] = useState('All');
    const [cart, setCart] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [purchaseFlash, setPurchaseFlash] = useState(false);
    const [ownedCosmetics, setOwnedCosmetics] = useState([]);
    const [showMoneyLog, setShowMoneyLog] = useState(false);

    const loadShop = useCallback(async () => {
        const items = await databaseConnection.getAll(STORES.shop);
        setShopItems(items);
        const player = await databaseConnection.getCurrentPlayer();
        setCurrentPlayer(player);
        if (player) {
            const inv = await databaseConnection.getPlayerStore(STORES.inventory, player.UUID);
            setOwnedCosmetics(inv.filter(i => i.type === 'cosmetic_theme' || i.type === 'cosmetic_font').map(i => i.itemId || i.name));
        }
    }, [databaseConnection]);

    useEffect(() => {
        loadShop();
    }, [loadShop, timestamp]);

    const handleMoneyLog = async ({ title, description, amount }) => {
        if (!currentPlayer) return;
        const now = new Date().toISOString();
        const today = new Date().toDateString();
        // Log as a transaction so it lives in the dedicated money ledger
        // (the profile timeline also surfaces transactions alongside events)
        await databaseConnection.add(STORES.transaction, {
            UUID: uuid(),
            parent: currentPlayer.UUID,
            type: 'money_log',
            name: title,
            description: description || '',
            amount,
            cost: amount,
            createdAt: now,
            completedAt: now,
        });
        // Update player money and log date
        const newMoney = Math.max(0, (currentPlayer.money || 0) + amount);
        await databaseConnection.add(STORES.player, {
            ...currentPlayer,
            money: newMoney,
            lastMoneyLogDate: today,
        });
        setShowMoneyLog(false);
        refreshApp();
        notify?.({ title: 'Cash logged', message: `+$${amount.toFixed(2)} added to your balance.`, kind: 'success', persist: false });
        loadShop();
    };

    const handleBuyCosmetic = async (item) => {
        if (!currentPlayer) return;
        if (currentPlayer.tokens < item.cost) return;
        await databaseConnection.add(STORES.player, { ...currentPlayer, tokens: currentPlayer.tokens - item.cost });
        await databaseConnection.add(STORES.inventory, {
            UUID: uuid(), parent: currentPlayer.UUID,
            itemId: item.id, name: item.label,
            type: item.font != null ? 'cosmetic_font' : 'cosmetic_theme',
            quantity: 1, cost: item.cost,
            createdAt: new Date().toISOString(),
        });
        refreshApp();
        notify?.({ title: 'Cosmetic unlocked!', message: `${item.label} is now available in Settings.`, kind: 'success', persist: false });

        // Check hobbyist/completionist/maximalist achievements
        const freshPlayer = await databaseConnection.getCurrentPlayer();
        if (freshPlayer) {
          const newlyEarned = await checkPassiveAchievements(freshPlayer, databaseConnection);
          for (const key of newlyEarned) {
            const a = getAchievementByKey(key);
            if (a) notify?.({ title: 'Achievement Unlocked', message: a.label, kind: 'success', persist: false });
          }
        }

        loadShop();
    };

    const navCategories = ['All', ...new Set(shopItems.map(i => i.category).filter(Boolean)), 'Cosmetics'];
    const formCategories = [...new Set([...SHOP_CATEGORIES, ...shopItems.map(i => i.category).filter(Boolean)])];

    useEffect(() => {
        if (activeCategory !== 'All' && !navCategories.includes(activeCategory)) {
            setActiveCategory('All');
        }
    }, [activeCategory, navCategories]);

    const filtered = activeCategory === 'All' ? shopItems : shopItems.filter(i => i.category === activeCategory);

    const getCartQty = (item) => {
        const entry = cart.find(e => itemsMatch(e.item, item));
        return entry ? entry.qty : 0;
    };

    const addToCart = (item) => {
        const cost = item.cost ?? calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
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
        const cost = item.cost ?? calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
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
        if (!item?.UUID) return;
        await databaseConnection.remove(STORES.shop, item.UUID);
        setCart(prev => prev.filter(entry => !itemsMatch(entry.item, item)));
        refreshApp();
        notify?.({ title: 'Shop updated', message: `${item.name} removed from the catalog.`, kind: 'info', persist: false });
        loadShop();
    };

    const handlePurchase = async () => {
        if (!currentPlayer) return;
        const tokenItems  = cart.filter(e => (e.item.currencyType || 'tokens') === 'tokens');
        const dollarItems = cart.filter(e => e.item.currencyType === 'dollars');
        const tokenCost   = tokenItems.reduce((s, e) => s + e.totalCost, 0);
        const dollarCost  = dollarItems.reduce((s, e) => s + e.totalCost, 0);
        if (currentPlayer.tokens < tokenCost) return;
        if ((currentPlayer.money || 0) < dollarCost) return;

        await databaseConnection.add(STORES.player, {
            ...currentPlayer,
            tokens: currentPlayer.tokens - tokenCost,
            money:  Math.max(0, (currentPlayer.money || 0) - dollarCost),
        });

        const allInventory = await databaseConnection.getAll(STORES.inventory);
        for (const entry of cart) {
            const existing = allInventory.find(inv => inv.parent === currentPlayer.UUID && inv.itemUUID === entry.item.UUID)
                || allInventory.find(inv => inv.parent === currentPlayer.UUID && inv.name === entry.item.name);

            if (existing) {
                await databaseConnection.add(STORES.inventory, { ...existing, quantity: existing.quantity + entry.qty });
            } else {
                await databaseConnection.add(STORES.inventory, {
                    UUID: uuid(),
                    parent: currentPlayer.UUID,
                    itemUUID: entry.item.UUID,
                    name: entry.item.name,
                    description: entry.item.description,
                    icon: entry.item.icon,
                    type: entry.item.type,
                    duration: entry.item.duration,
                    quantity: entry.qty,
                    enjoyment: entry.item.enjoyment,
                    cost: calculateItemCost(entry.item.type, entry.item.duration, entry.item.quantity, entry.item.enjoyment),
                    category: entry.item.category,
                });
            }
        }

        const itemCount = cart.reduce((sum, entry) => sum + entry.qty, 0);
        setCart([]);
        refreshApp();
        notify?.({ title: 'Purchase complete', message: `Added ${itemCount} item${itemCount === 1 ? '' : 's'} to inventory.`, kind: 'success', persist: false });
        setPurchaseFlash(true);
        setTimeout(() => setPurchaseFlash(false), 800);
        loadShop();
    };

    const handleSubmitItem = async (formData) => {
        const isEditing = !!editingItem;
        const record = {
            ...(isEditing ? editingItem : {}),
            ...formData,
            UUID: isEditing ? editingItem.UUID : uuid(),
            cost: formData.cost ?? calculateItemCost(formData.type, formData.duration, formData.quantity, formData.enjoyment),
            duration: formData.type === ITEM_TYPE.duration ? parseFloat(formData.duration) : null,
            quantity: formData.type === ITEM_TYPE.quantity ? parseFloat(formData.quantity) : null,
            enjoyment: parseInt(formData.enjoyment, 10),
            currencyType: formData.currencyType || 'tokens',
        };
        await databaseConnection.add(STORES.shop, record);
        // Drop from cart if it's stale (type/cost changed)
        if (isEditing) {
            setCart((prev) => prev.filter((entry) => !itemsMatch(entry.item, record)));
        }
        refreshApp();
        notify?.({
            title: 'Shop updated',
            message: `${record.name} ${isEditing ? 'updated' : 'added to the shop'}.`,
            kind: 'success',
            persist: false,
        });
        loadShop();
    };

    const visibleCategories = activeCategory === 'All' ? [...new Set(filtered.map(item => item.category).filter(Boolean))] : [activeCategory];

    return (
        <div className={`shop-page ${purchaseFlash ? 'purchase-flash' : ''}`}>
            <nav className="shop-category-nav">
                {navCategories.map(cat => (
                    <button key={cat} type="button" className={`cat-tab ${activeCategory === cat ? 'active' : ''}`} onClick={() => setActiveCategory(cat)}>{cat}</button>
                ))}
                <button type="button" className="cat-tab add-tab" onClick={() => setShowAddForm(true)}>+ NEW ITEM</button>
            </nav>

            <div className="shop-body">
                <main className="shop-grid-area">
                    {activeCategory === 'Cosmetics' ? (
                        <div>
                            <section className="shop-category-section">
                                <div className="category-label">THEMES</div>
                                <div className="shop-grid">
                                    {COSMETIC_THEMES.map(t => (
                                        <CosmeticItem key={t.id} item={t} owned={t.free || ownedCosmetics.includes(t.id)} onBuy={handleBuyCosmetic} tokens={currentPlayer?.tokens ?? 0} />
                                    ))}
                                </div>
                            </section>
                            <section className="shop-category-section">
                                <div className="category-label">FONTS</div>
                                <div className="shop-grid">
                                    {COSMETIC_FONTS.map(f => (
                                        <CosmeticItem key={f.id} item={{ ...f, font: true }} owned={f.free || ownedCosmetics.includes(f.id)} onBuy={(item) => handleBuyCosmetic({ ...item, type: 'cosmetic_font' })} tokens={currentPlayer?.tokens ?? 0} />
                                    ))}
                                </div>
                            </section>
                            <section className="shop-category-section">
                                <div className="category-label">PASSES</div>
                                <div className="shop-grid">
                                    {COSMETIC_PASSES.map(pass => (
                                        <CosmeticItem key={pass.id}
                                            item={{ id: pass.id, label: pass.label, cost: pass.cost, desc: pass.desc, icon: pass.icon }}
                                            owned={ownedCosmetics.includes(pass.id) || ownedCosmetics.includes(pass.type)}
                                            onBuy={() => handleBuyCosmetic({ id: pass.id, label: pass.label, cost: pass.cost, type: pass.type })}
                                            tokens={currentPlayer?.tokens ?? 0}
                                        />
                                    ))}
                                </div>
                            </section>
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="cart-empty">No shop items yet.</p>
                    ) : visibleCategories.map(category => {
                        const items = filtered.filter(i => i.category === category);
                        if (items.length === 0) return null;
                        return (
                            <section key={category} className="shop-category-section">
                                <div className="category-label">{category}</div>
                                <div className="shop-grid">
                                    {items.map(item => (
                                        <ShopItemCard
                                            key={item.UUID || item.name}
                                            item={item}
                                            cartQty={getCartQty(item)}
                                            onAdd={addToCart}
                                            onRemove={removeFromCart}
                                            onDelete={handleDeleteItem}
                                            onEdit={setEditingItem}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </main>

                <CartSidebar
                    cart={cart}
                    tokens={currentPlayer?.tokens ?? 0}
                    money={currentPlayer?.money ?? 0}
                    onRemove={removeFromCart}
                    onPurchase={handlePurchase}
                    onClear={() => setCart([])}
                    onLogMoney={() => setShowMoneyLog(true)}
                />
            </div>

            {(showAddForm || editingItem) && (
                <ShopItemForm
                    initialItem={editingItem}
                    onSubmit={handleSubmitItem}
                    onClose={() => { setShowAddForm(false); setEditingItem(null); }}
                    categories={formCategories}
                />
            )}

            {showMoneyLog && (
                <MoneyLogModal
                    currentPlayer={currentPlayer}
                    onSubmit={handleMoneyLog}
                    onClose={() => setShowMoneyLog(false)}
                />
            )}
        </div>
    );
}

export default Shop;
