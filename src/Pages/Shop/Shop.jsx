import './Shop.css';
import { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from '../../App.jsx';
import { STORES, ITEM_TYPE, COSMETIC_THEMES, COSMETIC_FONTS, COSMETIC_PASSES } from '../../utils/Constants.js';
import { calculateItemCost, SHOP_CATEGORIES } from '../../utils/Helpers/Shop.js';
import { v4 as uuid } from 'uuid';

const itemsMatch = (left, right) => {
    if (!left || !right) return false;
    if (left.UUID && right.UUID) return left.UUID === right.UUID;
    return left.name === right.name;
};

function EnjoymentDots({ level }) {
    return (
        <div className="enjoyment-dots" title={`Distraction level ${level}/3`}>
            {[1, 2, 3].map(i => (
                <span key={i} className={`dot ${i <= level ? 'active' : ''}`} />
            ))}
        </div>
    );
}

function ShopItemCard({ item, cartQty, onAdd, onRemove, onDelete }) {
    // Use stored cost; formula is fallback for legacy items
    const cost = item.cost ?? calculateItemCost(item.type, item.duration, item.quantity, item.enjoyment);
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
                        <button type="button" className="qty-btn" onClick={() => onRemove(item)}>−</button>
                        <span className="cart-qty">{cartQty}</span>
                        <button type="button" className="qty-btn" onClick={() => onAdd(item)}>+</button>
                    </div>
                ) : (
                    <button type="button" className="add-btn" onClick={() => onAdd(item)}>ADD</button>
                )}
                <button type="button" className="clear-btn" onClick={() => onDelete(item)}>DELETE</button>
            </div>
        </div>
    );
}

function AddItemForm({ onAdd, onClose, categories }) {
    const [form, setForm] = useState({
        name: '', description: '', type: ITEM_TYPE.duration,
        duration: 30, quantity: 1, enjoyment: 1, category: categories[0] || 'Rest', icon: '⭐',
    });
    const [costInput, setCostInput] = useState(
        String(calculateItemCost(ITEM_TYPE.duration, 30, 1, 1))
    );
    const [costLocked, setCostLocked] = useState(false);

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

    const finalCost = Math.max(1, parseInt(costInput, 10) || 1);

    return (
        <div className="add-item-overlay" onClick={onClose}>
            <div className="add-item-form" onClick={e => e.stopPropagation()}>
                <div className="form-header">
                    <span>NEW ITEM</span>
                    <button type="button" className="close-btn" onClick={onClose}>✕</button>
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
                    <label className="span2 cost-label">
                        <span className="cost-label-row">
                            Token Cost
                            {costLocked
                                ? <span className="cost-badge cost-badge-manual">MANUAL</span>
                                : <span className="cost-badge cost-badge-auto">AUTO</span>
                            }
                            {costLocked && (
                                <button type="button" className="cost-reset-btn" onClick={resetCost}>↺ reset</button>
                            )}
                        </span>
                        <div className="cost-input-wrap">
                            <span className="cost-input-icon">◈</span>
                            <input
                                type="number"
                                min={1}
                                value={costInput}
                                onChange={handleCostChange}
                                className={costLocked ? 'cost-input-locked' : ''}
                            />
                        </div>
                    </label>
                </div>
                <div className="form-footer">
                    <button type="button" className="primary" onClick={() => { onAdd({ ...form, cost: finalCost }); onClose(); }}>
                        CREATE ITEM
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

function CartSidebar({ cart, tokens, onRemove, onPurchase, onClear }) {
    const totalCost = cart.reduce((sum, entry) => sum + entry.totalCost, 0);
    const canAfford = tokens >= totalCost;

    return (
        <aside className="cart-sidebar">
            <div className="cart-header">
                <span>CART</span>
                {cart.length > 0 && (
                    <button type="button" className="clear-btn" onClick={onClear}>CLEAR</button>
                )}
            </div>

            <div className="cart-token-balance">
                <span className="balance-label">BALANCE</span>
                <span className="balance-value"><span className="cost-icon">◈</span>{tokens ?? 0}</span>
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
                        <button type="button" className="cart-remove" onClick={() => onRemove(entry.item, entry.qty)}>✕</button>
                    </div>
                ))}
            </div>

            {cart.length > 0 && (
                <div className="cart-footer">
                    <div className="cart-total">
                        <span>TOTAL</span>
                        <span className={canAfford ? 'cost-ok' : 'cost-over'}>◈ {totalCost}</span>
                    </div>
                    {!canAfford && <p className="cart-warning">Insufficient tokens</p>}
                    <button type="button" className={`purchase-btn ${canAfford ? 'primary' : 'disabled'}`} onClick={canAfford ? onPurchase : undefined} disabled={!canAfford}>PURCHASE</button>
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
    const [purchaseFlash, setPurchaseFlash] = useState(false);
    const [ownedCosmetics, setOwnedCosmetics] = useState([]);

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
        const totalCost = cart.reduce((sum, e) => sum + e.totalCost, 0);
        if (currentPlayer.tokens < totalCost) return;

        await databaseConnection.add(STORES.player, {
            ...currentPlayer,
            tokens: currentPlayer.tokens - totalCost,
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

    const handleAddItem = async (formData) => {
        const created = {
            ...formData,
            UUID: uuid(),
            cost: formData.cost ?? calculateItemCost(formData.type, formData.duration, formData.quantity, formData.enjoyment),
            duration: formData.type === ITEM_TYPE.duration ? parseFloat(formData.duration) : null,
            quantity: formData.type === ITEM_TYPE.quantity ? parseFloat(formData.quantity) : null,
            enjoyment: parseInt(formData.enjoyment, 10),
        };
        await databaseConnection.add(STORES.shop, created);
        refreshApp();
        notify?.({ title: 'Shop updated', message: `${created.name} added to the shop.`, kind: 'success', persist: false });
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
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </main>

                <CartSidebar cart={cart} tokens={currentPlayer?.tokens ?? 0} onRemove={removeFromCart} onPurchase={handlePurchase} onClear={() => setCart([])} />
            </div>

            {showAddForm && <AddItemForm onAdd={handleAddItem} onClose={() => setShowAddForm(false)} categories={formCategories} />}
        </div>
    );
}

export default Shop;
