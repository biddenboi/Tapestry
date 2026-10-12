import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';
import { GATE_SETTING_ID, GateError, normalizeGateState, lockGateItem } from '@domain/gate/Gate.js';

const gateRecord = (state, now) => ({ UUID: GATE_SETTING_ID, kind: 'gate-state', value: state, updatedAt: now });

export async function loadGate(db, now = new Date().toISOString()) {
  const record = await db.get(STORES.appSetting, GATE_SETTING_ID);
  return normalizeGateState(record?.value, now);
}
export async function saveGate(db, state) {
  await db.add(STORES.appSetting, gateRecord(state, new Date().toISOString()));
}
export async function loadGateInputs(db) {
  const [completedTasks, todos] = await Promise.all([db.getAll(STORES.task), db.getAll(STORES.todo)]);
  return { completedTasks, todos };
}
export async function lockItemWithCoins(db, player, state, id) {
  const ledgerUUID = uuid();
  const { state: next, price } = lockGateItem(state, id, { ledgerUUID });
  if (price > 0 && Number(player.tokens || 0) < price) throw new GateError('insufficient-coins');
  const now = new Date().toISOString();
  const item = next.window.items.find((entry) => entry.id === id);
  const puts = price > 0 ? [
    { store: STORES.player, record: { ...player, tokens: Number(player.tokens || 0) - price } },
    { store: STORES.transaction, record: { UUID: ledgerUUID, parent: player.UUID, type: 'gate_item', name: item.text, category: 'Gate', currencyType: 'tokens', quantity: 1, unitCost: price, totalCost: price, cost: price, createdAt: now, completedAt: now } },
  ] : [];
  puts.push({ store: STORES.appSetting, record: gateRecord(next, now) });
  await db.commitAtomicMutation({ label: 'gate-lock-item', operationId: ledgerUUID, flush: true, puts });
  return { state: next, price };
}
