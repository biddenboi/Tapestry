import './InventoryItemPopup.css';
import { useState, useEffect, useRef, useContext } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES, ITEM_TYPE, MINUTE } from '../../utils/Constants.js';
import { timeAsHHMMSS } from '../../utils/Helpers/Time.js';

// ── Duration consumption sub-component ──────────────────
function DurationConsumer({ item, onFinish, onClose }) {
    const { databaseConnection, refreshApp, notify } = useContext(AppContext);
    const [phase, setPhase] = useState('idle'); // idle | running | overtime | done
    const [elapsed, setElapsed] = useState(0);
    const [penaltiesApplied, setPenaltiesApplied] = useState(0);
    const startTimeRef = useRef(null);
    const intervalRef = useRef(null);
    const penaltyRef = useRef(0);

    const durationMs = (item.duration || 0) * MINUTE;

    useEffect(() => {
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, []);

    const startSession = () => {
        startTimeRef.current = Date.now();
        setPhase('running');
        intervalRef.current = setInterval(async () => {
            const now = Date.now();
            const el = now - startTimeRef.current;
            setElapsed(el);

            if (el > durationMs) {
                setPhase('overtime');
                // Apply penalty for every extra interval elapsed (fires immediately at 1 second over)
                const overtimeMs = el - durationMs;
                const newPenaltyCount = Math.ceil(overtimeMs / durationMs);
                if (newPenaltyCount > penaltyRef.current) {
                    const penaltiesToApply = newPenaltyCount - penaltyRef.current;
                    penaltyRef.current = newPenaltyCount;
                    setPenaltiesApplied(newPenaltyCount);
                    // Deduct tokens
                    const player = await databaseConnection.getCurrentPlayer();
                    if (player) {
                        const deduction = penaltiesToApply * item.cost;
                        await databaseConnection.add(STORES.player, {
                            ...player,
                            tokens: Math.max(0, player.tokens - deduction),
                        });
                        refreshApp();
                    }
                }
            }
        }, 1000);
    };

    const endSession = async () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
        setPhase('done');
        onFinish();
    };

    const ratio = durationMs > 0 ? Math.min(elapsed / durationMs, 1) : 0;
    const isOver = elapsed > durationMs;
    const overtime = isOver ? elapsed - durationMs : 0;

    return (
        <div className="consumer-duration">
            {phase === 'idle' && (
                <>
                    <p className="consumer-hint">
                        Your session lasts <strong>{item.duration} minutes</strong>.
                        Going overtime deducts <span className="cost-icon">◈</span>{item.cost} per additional
                        &nbsp;<strong>{item.duration} min</strong>.
                    </p>
                    <button className="primary consume-start-btn" onClick={startSession}>
                        START SESSION
                    </button>
                </>
            )}

            {(phase === 'running' || phase === 'overtime') && (
                <>
                    <div className={`timer-display ${isOver ? 'overtime' : 'in-time'}`}>
                        <span className="timer-big">{timeAsHHMMSS(isOver ? overtime : durationMs - elapsed)}</span>
                        <span className="timer-label">{isOver ? 'OVERTIME' : 'REMAINING'}</span>
                    </div>

                    {/* Progress arc */}
                    <div className="progress-bar-wrap">
                        <div
                            className={`progress-bar-fill ${isOver ? 'over' : ''}`}
                            style={{ width: `${ratio * 100}%` }}
                        />
                    </div>

                    {penaltiesApplied > 0 && (
                        <p className="penalty-notice">
                            ⚠ {penaltiesApplied} penalty{penaltiesApplied > 1 ? 's' : ''} applied
                            &nbsp;(−<span className="cost-icon">◈</span>
                            {penaltiesApplied * item.cost})
                        </p>
                    )}

                    <button className={`end-btn ${isOver ? 'danger' : 'primary'}`} onClick={endSession}>
                        END SESSION
                    </button>
                </>
            )}

            {phase === 'done' && (
                <p className="done-msg">Session complete. Item consumed.</p>
            )}
        </div>
    );
}

// ── Quantity consumption sub-component ──────────────────
function QuantityConsumer({ item, onFinish }) {
    return (
        <div className="consumer-quantity">
            <p className="consumer-hint">
                Consuming <strong>{item.name}</strong> will use one unit from your inventory.
                You currently have <strong>{item.quantity}</strong> remaining.
            </p>
            <button className="primary" onClick={onFinish}>
                CONSUME
            </button>
        </div>
    );
}

// ── Main popup ───────────────────────────────────────────
export default NiceModal.create(({ item, onConsumed }) => {
    const modal = useModal();
    const { databaseConnection, refreshApp, notify } = useContext(AppContext);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') { modal.hide(); modal.remove(); }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    const handleConsumed = async () => {
        // Decrement inventory quantity
        await databaseConnection.add(STORES.inventory, {
            ...item,
            quantity: Math.max(0, item.quantity - 1),
        });

        // Write a timeline event so consumption shows up in the profile history
        const player = await databaseConnection.getCurrentPlayer();
        if (player?.UUID) {
            await databaseConnection.add(STORES.event, {
                UUID: uuid(),
                parent: player.UUID,
                type: 'item_use',
                name: item.name,
                icon: item.icon || '▤',
                category: item.category || item.type,
                description: `Used ${item.name}`,
                itemType: item.type,
                itemId: item.itemId || item.UUID,
                createdAt: new Date().toISOString(),
            });
        }

        onConsumed?.();
        refreshApp();
        notify({ title: 'Item consumed', message: `${item.name} resolved successfully.`, kind: 'success', persist: false });
        modal.hide();
        modal.remove();
    };

    if (!modal.visible) return null;

    return (
        <div className="inv-popup-overlay">
            <div className="blanker" onClick={() => { modal.hide(); modal.remove(); }} />
            <div className="inv-popup">
                {/* Header */}
                <div className="inv-popup-header">
                    <span className="inv-popup-icon">{item.icon || '📦'}</span>
                    <div>
                        <p className="inv-popup-name">{item.name}</p>
                        <p className="inv-popup-category">{item.category || item.type}</p>
                    </div>
                    <button className="close-btn" onClick={() => { modal.hide(); modal.remove(); }}>✕</button>
                </div>

                {/* Description */}
                {item.description && (
                    <p className="inv-popup-desc">{item.description}</p>
                )}

                {/* Stats row */}
                <div className="inv-popup-stats">
                    {item.type === ITEM_TYPE.duration && (
                        <div className="stat-chip">
                            <span className="chip-val">{item.duration}</span>
                            <span className="chip-label">MIN</span>
                        </div>
                    )}
                    <div className="stat-chip">
                        <span className="chip-val">{item.quantity}</span>
                        <span className="chip-label">LEFT</span>
                    </div>
                    {item.type === ITEM_TYPE.duration && (
                    <div className="stat-chip cost-chip">
                        <span className="chip-val">◈ {item.cost}</span>
                        <span className="chip-label">PENALTY</span>
                    </div>
                    )}
                </div>

                {/* Consumer */}
                <div className="inv-popup-consumer">
                    {item.type === ITEM_TYPE.duration ? (
                        <DurationConsumer item={item} onFinish={handleConsumed} onClose={() => { modal.hide(); modal.remove(); }} />
                    ) : (
                        <QuantityConsumer item={item} onFinish={handleConsumed} />
                    )}
                </div>
            </div>
        </div>
    );
});
