import './Inventory.css';
import { useState, useEffect, useContext, useCallback } from 'react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';
import NiceModal from '@ebay/nice-modal-react';
import InventoryItemPopup from '../../Modals/InventoryItemPopup/InventoryItemPopup.jsx';

function InventoryCard({ item, onConsume }) {
    const isEmpty = item.quantity <= 0;

    return (
        <div
            className={`inv-card ${isEmpty ? 'depleted' : ''}`}
            onClick={() => !isEmpty && onConsume(item)}
            title={isEmpty ? 'Depleted' : 'Click to use'}
        >
            <div className="inv-card-icon">{item.icon || '📦'}</div>
            <div className="inv-card-body">
                <span className="inv-card-name">{item.name}</span>
                <span className="inv-card-cat">{item.category || item.type}</span>
                {item.type === 'duration' && item.duration && (
                    <span className="inv-card-meta">{item.duration} min</span>
                )}
            </div>
            <div className="inv-card-qty">
                <span className="qty-value">{item.quantity}</span>
                <span className="qty-label">LEFT</span>
            </div>
            {!isEmpty && <div className="inv-card-hover-hint">USE</div>}
        </div>
    );
}

function Inventory() {
    const { databaseConnection, timestamp } = useContext(AppContext);
    const [inventory, setInventory] = useState([]);
    const [filter, setFilter] = useState('All');
    const [currentPlayer, setCurrentPlayer] = useState(null);

    const reload = useCallback(async () => {
        const player = await databaseConnection.getCurrentPlayer();
        setCurrentPlayer(player);
        if (!player) return;
        const items = await databaseConnection.getPlayerStore(STORES.inventory, player.UUID);
        setInventory(items);
    }, [databaseConnection]);

    useEffect(() => { reload(); }, [reload, timestamp]);

    const handleConsume = (item) => {
        NiceModal.show(InventoryItemPopup, { item, onConsumed: reload });
    };

    const categories = ['All', ...new Set(inventory.map(i => i.category || i.type).filter(Boolean))];
    const filtered = filter === 'All' ? inventory : inventory.filter(i => (i.category || i.type) === filter);
    const activeItems = filtered.filter(i => i.quantity > 0);
    const depletedItems = filtered.filter(i => i.quantity <= 0);

    return (
        <div className="inventory-page">
            <header className="inv-header">
                <div className="inv-header-title">
                    <span className="inv-title-label">INVENTORY</span>
                    <span className="inv-token-badge">
                        <span className="cost-icon">◈</span>
                        {currentPlayer?.tokens ?? 0}
                    </span>
                </div>
                <nav className="inv-filter-nav">
                    {categories.map(cat => (
                        <button
                            key={cat}
                            className={`filter-tab ${filter === cat ? 'active' : ''}`}
                            onClick={() => setFilter(cat)}
                        >
                            {cat}
                        </button>
                    ))}
                </nav>
            </header>

            <div className="inv-body">
                {inventory.length === 0 ? (
                    <div className="inv-empty">
                        <p className="inv-empty-title">INVENTORY EMPTY</p>
                        <p className="inv-empty-sub">Purchase items from the Shop to stock up.</p>
                    </div>
                ) : (
                    <>
                        {activeItems.length > 0 && (
                            <section className="inv-section">
                                <div className="inv-section-label">AVAILABLE</div>
                                <div className="inv-grid">
                                    {activeItems.map(item => (
                                        <InventoryCard
                                            key={item.UUID}
                                            item={item}
                                            onConsume={handleConsume}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                        {depletedItems.length > 0 && (
                            <section className="inv-section">
                                <div className="inv-section-label depleted-label">DEPLETED</div>
                                <div className="inv-grid">
                                    {depletedItems.map(item => (
                                        <InventoryCard
                                            key={item.UUID}
                                            item={item}
                                            onConsume={handleConsume}
                                        />
                                    ))}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

export default Inventory;
