import '@features/inventory/modals/InventoryItemPopup/InventoryItemPopup.css';
import { useState, useEffect, useRef } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import { STORES, ITEM_TYPE, MINUTE } from '@domain/constants.js';
import { timeAsHHMMSS } from '@domain/time/Time.js';
import { applyInventoryUseState, canUseInventoryItem, getInventoryItemCooldown } from '@domain/shop/Shop.js';
import ResourceImage from '@shared/resource-image/ResourceImage.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import StatusBadge from '@shared/ui/StatusBadge.jsx';

function InventoryPopupImage({ item }) {
    const imageUrl = item?.bannerImageUrl;
    const label = String(item?.name || 'Item').trim().charAt(0).toUpperCase() || 'I';

    return (
        <span className={`inv-popup-image ${imageUrl ? 'has-image' : ''}`} aria-hidden="true">
            {imageUrl
                ? <ResourceImage value={imageUrl} alt="" />
                : <span>{label}</span>}
        </span>
    );
}

// ── Duration consumption sub-component ──────────────────
function DurationConsumer({ item, onFinish, onTimerChange }) {
    const { databaseConnection, invalidateDomains } = useAppContext();
    const [phase, setPhase] = useState('idle'); // idle | running | overtime | done
    const [elapsed, setElapsed] = useState(0);
    const [penaltiesApplied, setPenaltiesApplied] = useState(0);
    const startTimeRef = useRef(null);
    const intervalRef = useRef(null);
    const penaltyRef = useRef(0);

    const durationMs = (item.duration || 0) * MINUTE;

    useEffect(() => {
        onTimerChange?.({ phase, elapsed, durationMs });
    }, [durationMs, elapsed, onTimerChange, phase]);

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
                        invalidateDomains(DOMAIN_INVALIDATION.walletWrite);
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
                        Start
                    </button>
                </>
            )}

            {(phase === 'running' || phase === 'overtime') && (
                <>
                    <div className={`timer-display ${isOver ? 'overtime' : 'in-time'}`}>
                        <span className="timer-big">{timeAsHHMMSS(isOver ? overtime : durationMs - elapsed)}</span>
                        <span className="timer-label">{isOver ? 'OVERTIME' : 'REMAINING'}</span>
                    </div>

                    {penaltiesApplied > 0 && (
                        <p className="penalty-notice">
                            ⚠ {penaltiesApplied} penalty{penaltiesApplied > 1 ? 's' : ''} applied
                            &nbsp;(−<span className="cost-icon">◈</span>
                            {penaltiesApplied * item.cost})
                        </p>
                    )}

                    <button className={`end-btn ${isOver ? 'danger' : 'primary'}`} onClick={endSession}>
                        End session
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
                Use item
            </button>
        </div>
    );
}

// ── Main popup ───────────────────────────────────────────
export default NiceModal.create(({ item, onConsumed }) => {
    const modal = useModal();
    const { databaseConnection, invalidateDomains, notify, emitRewardEvent } = useAppContext();
    const [sessionProgress, setSessionProgress] = useState(null);

    const handleConsumed = async () => {
        if (!canUseInventoryItem(item)) {
            const cooldown = getInventoryItemCooldown(item);
            notify({
                title: 'Item unavailable',
                message: cooldown.active ? 'This item is still on cooldown.' : 'This item is depleted.',
                kind: 'error',
                persist: false,
            });
            return;
        }
        const now = new Date();
        const inventoryRecord = applyInventoryUseState(item, now);
        const player = await databaseConnection.getCurrentPlayer();
        const timelineEvent = player?.UUID ? {
            UUID: uuid(),
            parent: player.UUID,
            type: 'item_use',
            name: item.name,
            icon: null,
            bannerImageUrl: item.bannerImageUrl || null,
            category: item.category || item.type,
            description: `Used ${item.name}`,
            itemType: item.type,
            itemId: item.itemId || item.UUID,
            createdAt: now.toISOString(),
        } : null;

        if (typeof databaseConnection.commitAtomicMutation === 'function') {
            await databaseConnection.commitAtomicMutation({
                label: 'inventory-item-use',
                puts: [
                    { store: STORES.inventory, record: inventoryRecord },
                    ...(timelineEvent ? [{ store: STORES.event, record: timelineEvent }] : []),
                ],
                flush: false,
            });
        } else {
            await databaseConnection.add(STORES.inventory, inventoryRecord);
            if (timelineEvent) await databaseConnection.add(STORES.event, timelineEvent);
        }

        onConsumed?.();
        invalidateDomains(DOMAIN_INVALIDATION.inventoryUse);
        emitRewardEvent?.([{
            label: `Used ${item.name}`,
            kind: 'inventory',
        }], { source: 'inventory' });
        notify({ title: 'Item used', message: `${item.name} was removed from inventory.`, kind: 'success', persist: false });
        modal.hide();
        modal.remove();
    };

    if (!modal.visible) return null;
    const cooldown = getInventoryItemCooldown(item);
    const sessionActive = ['running', 'overtime'].includes(sessionProgress?.phase);
    const sessionRatio = sessionProgress?.durationMs > 0
        ? Math.min(sessionProgress.elapsed / sessionProgress.durationMs, 1)
        : 0;
    const sessionOvertime = sessionProgress?.phase === 'overtime';
    const close = () => {
        modal.hide();
        modal.remove();
    };

    return (
        <ModalFrame
            onClose={close}
            title={item.name}
            subtitle={item.category || item.type}
            eyebrow="Inventory item"
            size="md"
            accent="var(--color-inventory)"
            className="inv-popup"
            hero={(
                <div className="inv-popup-header inv-popup-hero">
                    <InventoryPopupImage item={item} />
                </div>
            )}
        >

                {item.description && (
                    <p className="inv-popup-desc">{item.description}</p>
                )}

                <div className="inv-popup-status">
                    <StatusBadge tone={cooldown.active ? 'warning' : 'success'}>
                        {cooldown.active ? 'On cooldown' : item.quantity > 0 ? 'Ready to use' : 'Depleted'}
                    </StatusBadge>
                </div>

                {sessionActive && (
                    <div className="inv-popup-session-progress" aria-label="Inventory session progress">
                        <div className="inv-popup-session-progress-label">
                            <span>{sessionOvertime ? 'Overtime' : 'Session progress'}</span>
                            <strong>{sessionOvertime ? 'Penalty active' : `${Math.round(sessionRatio * 100)}%`}</strong>
                        </div>
                        <div className="progress-bar-wrap">
                            <div
                                className={`progress-bar-fill ${sessionOvertime ? 'over' : ''}`}
                                style={{ width: `${sessionRatio * 100}%` }}
                            />
                        </div>
                    </div>
                )}

                <div className="inv-popup-stats">
                    {item.type === ITEM_TYPE.duration && (
                        <div className="stat-chip">
                            <span className="chip-val">{item.duration}</span>
                            <span className="chip-label">Minutes</span>
                        </div>
                    )}
                    <div className="stat-chip">
                        <span className="chip-val">{item.quantity}</span>
                        <span className="chip-label">Owned</span>
                    </div>
                    <div className="stat-chip">
                        <span className="chip-val">{Number(item.useCount || 0)}</span>
                        <span className="chip-label">Uses</span>
                    </div>
                    {item.type === ITEM_TYPE.duration && (
                    <div className="stat-chip cost-chip">
                        <span className="chip-val">◈ {item.cost}</span>
                        <span className="chip-label">Overtime penalty</span>
                    </div>
                    )}
                </div>

                {(item.lastUsedAt || cooldown.active) && (
                    <div className="inv-popup-history">
                        {item.lastUsedAt && <span>Last used {new Date(item.lastUsedAt).toLocaleString()}</span>}
                        {cooldown.active && <strong>Cooldown ends {new Date(cooldown.until).toLocaleTimeString()}</strong>}
                    </div>
                )}

                <div className="inv-popup-consumer">
                    {cooldown.active ? (
                        <div className="consumer-cooldown">
                            <strong>Item on cooldown</strong>
                            <span>Available at {new Date(cooldown.until).toLocaleTimeString()}</span>
                        </div>
                    ) : item.type === ITEM_TYPE.duration ? (
                        <DurationConsumer item={item} onFinish={handleConsumed} onTimerChange={setSessionProgress} />
                    ) : (
                        <QuantityConsumer item={item} onFinish={handleConsumed} />
                    )}
                </div>
        </ModalFrame>
    );
});
