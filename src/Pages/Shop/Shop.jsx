import './Shop.css';
import { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from '../../App.jsx';
import { STORES, ITEM_TYPE } from '../../utils/Constants.js';
import { calculateItemCost, DEFAULT_SHOP_ITEMS, SHOP_CATEGORIES } from '../../utils/Helpers/Shop.js';
import { v4 as uuid } from 'uuid';

// ── Enjoyment display ────────────────────────────────────
function EnjoymentDots({ level }) {
    return (
        <div className="enjoyment-dots" title={`Distraction level ${level}/3`}>
            {[1, 2, 3].map(i => (
                <span key={i} className={`dot ${i <= level ? 'active' : ''}`} />
            ))}
        </div>
    );
}

// ── Individual shop card ─────────────────────────────────
function ShopItemCard({ item, cartQty, onAdd, onRemove }) {
    const cost = calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
    const isDuration = item.type === ITEM_TYPE.duration;

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
                <span className="shop-card-cost">
                    <span className="cost-icon">◈</span>
                    {cost}
                </span>
                {cartQty > 0 ? (
                    <div className="cart-controls">
                        <button className="qty-btn" onClick={() => onRemove(item)}>−</button>
                        <span className="cart-qty">{cartQty}</span>
                        <button className="qty-btn" onClick={() => onAdd(item)}>+</button>
                    </div>
                ) : (
                    <button className="add-btn" onClick={() => onAdd(item)}>ADD</button>
                )}
            </div>
        </div>
    );
}

// ── Add item to shop form ────────────────────────────────
function AddItemForm({ onAdd, onClose }) {
    const [form, setForm] = useState({
        name: '', description: '', type: ITEM_TYPE.duration,
        duration: 30, quantity: 1, enjoyment: 1, category: 'Rest', icon: '⭐',
    });

    const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
    const cost = calculateItemCost(form.type, form.duration, form.quantity, form.enjoyment);

    return (
        <div className="add-item-overlay">
            <div className="add-item-form">
                <div className="form-header">
                    <span>NEW ITEM</span>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>
                <div className="form-grid">
                    <label>Icon
                        <input value={form.icon} onChange={e => set('icon', e.target.value)} maxLength={2} />
                    </label>
                    <label>Name
                        <input value={form.name} onChange={e => set('name', e.target.value)} />
                    </label>
                    <label className="span2">Description
                        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} />
                    </label>
                    <label>Type
                        <select value={form.type} onChange={e => set('type', e.target.value)}>
                            <option value={ITEM_TYPE.duration}>Duration</option>
                            <option value={ITEM_TYPE.quantity}>Quantity</option>
                        </select>
                    </label>
                    <label>Category
                        <select value={form.category} onChange={e => set('category', e.target.value)}>
                            {SHOP_CATEGORIES.map(c => <option key={c}>{c}</option>)}
                        </select>
                    </label>
                    {form.type === ITEM_TYPE.duration ? (
                        <label>Duration (min)
                            <input type="number" min={1} value={form.duration}
                                onChange={e => set('duration', e.target.value)} />
                        </label>
                    ) : (
                        <label>Quantity
                            <input type="number" min={1} value={form.quantity}
                                onChange={e => set('quantity', e.target.value)} />
                        </label>
                    )}
                    <label>Distraction
                        <select value={form.enjoyment} onChange={e => set('enjoyment', parseInt(e.target.value))}>
                            <option value={1}>1 — Focus-safe</option>
                            <option value={2}>2 — Moderate</option>
                            <option value={3}>3 — High</option>
                        </select>
                    </label>
                </div>
                <div className="form-footer">
                    <span className="preview-cost">Cost preview: <strong>◈ {cost}</strong></span>
                    <button className="primary" onClick={() => { onAdd(form); onClose(); }}>
                        CREATE ITEM
                    </button>
                </div>
            </div>
        </div>
    );
}

// ── Cart sidebar ─────────────────────────────────────────
function CartSidebar({ cart, tokens, onRemove, onPurchase, onClear }) {
    const totalCost = cart.reduce((sum, entry) => sum + entry.totalCost, 0);
    const canAfford = tokens >= totalCost;

    return (
        <aside className="cart-sidebar">
            <div className="cart-header">
                <span>CART</span>
                {cart.length > 0 && (
                    <button className="clear-btn" onClick={onClear}>CLEAR</button>
                )}
            </div>

            <div className="cart-token-balance">
                <span className="balance-label">BALANCE</span>
                <span className="balance-value">
                    <span className="cost-icon">◈</span>
                    {tokens ?? 0}
                </span>
            </div>

            <div className="cart-items">
                {cart.length === 0 ? (
                    <p className="cart-empty">Your cart is empty.</p>
                ) : cart.map(entry => (
                    <div key={entry.item.UUID || entry.item.name} className="cart-line">
                        <span className="cart-line-icon">{entry.item.icon}</span>
                        <div className="cart-line-info">
                            <span className="cart-line-name">{entry.item.name}</span>
                            <span className="cart-line-sub">×{entry.qty}</span>
                        </div>
                        <span className="cart-line-cost">◈ {entry.totalCost}</span>
                        <button className="cart-remove" onClick={() => onRemove(entry.item, entry.qty)}>✕</button>
                    </div>
                ))}
            </div>

            {cart.length > 0 && (
                <div className="cart-footer">
                    <div className="cart-total">
                        <span>TOTAL</span>
                        <span className={canAfford ? 'cost-ok' : 'cost-over'}>◈ {totalCost}</span>
                    </div>
                    {!canAfford && (
                        <p className="cart-warning">Insufficient tokens</p>
                    )}
                    <button
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

// ── Main Shop page ────────────────────────────────────────
function Shop() {
    const { databaseConnection, timestamp } = useContext(AppContext);
    const [shopItems, setShopItems] = useState([]);
    const [currentPlayer, setCurrentPlayer] = useState(null);
    const [activeCategory, setActiveCategory] = useState('All');
    const [cart, setCart] = useState([]);
    const [showAddForm, setShowAddForm] = useState(false);
    const [purchaseFlash, setPurchaseFlash] = useState(false);

    // Seed default items if shop is empty
    const loadShop = useCallback(async () => {
        const items = await databaseConnection.getAll(STORES.shop);
        if (items.length === 0) {
            for (const item of DEFAULT_SHOP_ITEMS) {
                await databaseConnection.add(STORES.shop, {
                    ...item,
                    UUID: uuid(),
                    cost: calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment),
                });
            }
            const seeded = await databaseConnection.getAll(STORES.shop);
            setShopItems(seeded);
        } else {
            setShopItems(items);
        }
        const player = await databaseConnection.getCurrentPlayer();
        setCurrentPlayer(player);
    }, [databaseConnection]);

    useEffect(() => { loadShop(); }, [loadShop, timestamp]);

    const categories = ['All', ...new Set(shopItems.map(i => i.category).filter(Boolean))];

    const filtered = activeCategory === 'All'
        ? shopItems
        : shopItems.filter(i => i.category === activeCategory);

    const getCartQty = (item) => {
        const entry = cart.find(e => e.item.UUID === item.UUID || e.item.name === item.name);
        return entry ? entry.qty : 0;
    };

    const addToCart = (item) => {
        const cost = calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
        setCart(prev => {
            const existing = prev.find(e => e.item.name === item.name);
            if (existing) {
                return prev.map(e => e.item.name === item.name
                    ? { ...e, qty: e.qty + 1, totalCost: (e.qty + 1) * cost }
                    : e
                );
            }
            return [...prev, { item, qty: 1, totalCost: cost }];
        });
    };

    const removeFromCart = (item, removeAll = false) => {
        const cost = calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
        setCart(prev => {
            const existing = prev.find(e => e.item.name === item.name);
            if (!existing) return prev;
            if (removeAll || existing.qty <= 1) return prev.filter(e => e.item.name !== item.name);
            return prev.map(e => e.item.name === item.name
                ? { ...e, qty: e.qty - 1, totalCost: (e.qty - 1) * cost }
                : e
            );
        });
    };

    const handlePurchase = async () => {
        if (!currentPlayer) return;
        const totalCost = cart.reduce((sum, e) => sum + e.totalCost, 0);
        if (currentPlayer.tokens < totalCost) return;

        // Deduct tokens
        await databaseConnection.add(STORES.player, {
            ...currentPlayer,
            tokens: currentPlayer.tokens - totalCost,
        });

        // Add to inventory (merge with existing stacks)
        for (const entry of cart) {
            const allInventory = await databaseConnection.getAll(STORES.inventory);
            const existing = allInventory.find(
                inv => inv.parent === currentPlayer.UUID && inv.name === entry.item.name
            );
            if (existing) {
                await databaseConnection.add(STORES.inventory, {
                    ...existing,
                    quantity: existing.quantity + entry.qty,
                });
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

        setCart([]);
        setPurchaseFlash(true);
        setTimeout(() => setPurchaseFlash(false), 800);
        loadShop();
    };

    const handleAddItem = async (formData) => {
        const cost = calculateItemCost(formData.type, formData.duration, formData.quantity, formData.enjoyment);
        await databaseConnection.add(STORES.shop, {
            ...formData,
            UUID: uuid(),
            cost,
            duration: formData.type === ITEM_TYPE.duration ? parseFloat(formData.duration) : null,
            quantity: formData.type === ITEM_TYPE.quantity ? parseFloat(formData.quantity) : null,
            enjoyment: parseInt(formData.enjoyment),
        });
        loadShop();
    };

    return (
        <div className={`shop-page ${purchaseFlash ? 'purchase-flash' : ''}`}>

            {/* Category nav */}
            <nav className="shop-category-nav">
                {categories.map(cat => (
                    <button
                        key={cat}
                        className={`cat-tab ${activeCategory === cat ? 'active' : ''}`}
                        onClick={() => setActiveCategory(cat)}
                    >
                        {cat}
                    </button>
                ))}
                <button className="cat-tab add-tab" onClick={() => setShowAddForm(true)}>
                    + NEW ITEM
                </button>
            </nav>

            <div className="shop-body">
                {/* Item grid */}
                <main className="shop-grid-area">
                    {SHOP_CATEGORIES.filter(c => activeCategory === 'All' || c === activeCategory).map(category => {
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
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </main>

                {/* Cart */}
                <CartSidebar
                    cart={cart}
                    tokens={currentPlayer?.tokens ?? 0}
                    onRemove={removeFromCart}
                    onPurchase={handlePurchase}
                    onClear={() => setCart([])}
                />
            </div>

            {showAddForm && (
                <AddItemForm onAdd={handleAddItem} onClose={() => setShowAddForm(false)} />
            )}
        </div>
    );
}

export default Shop;
