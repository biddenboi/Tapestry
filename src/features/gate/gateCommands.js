import { v4 as uuid } from 'uuid';
import { STORES } from '@domain/constants.js';
import { GATE_SETTING_ID, GateError, normalizeGateState, lockGateItem } from '@domain/gate/Gate.js';

const gateRecord = (state, now) => ({ UUID: GATE_SETTING_ID, kind: 'gate-state', value: state, updatedAt: now });

export async function loadGate(db, now = new Date().toISOString()) {
  const record = await db.get(STORES.appSetting, GATE_SETTING_ID);
  return normalizeGateState(record?.value, now);
}
const taskId = (window, item) => `gate:v${window.release}:${item.id}`;
const gateTask = (window, item, parent, now) => ({ UUID: taskId(window, item), parent, name: item.text,
  r1Category: 'Tapestry', gateItemId: item.id, gateRelease: window.release,
  estimatedDuration: item.estimateMinutes, dueDate: window.endsAt, startDate: window.openedAt,
  isHabit: false, createdAt: now, updatedAt: now });
export async function saveGate(db, state) {
  const now = new Date().toISOString(); const prior = await loadGate(db, now);
  const puts = [{ store: STORES.appSetting, record: gateRecord(state, now) }]; const deletes=[];
  for(const item of prior.window?.items || []) {
    const retained = state.window?.items.find(i=>i.id===item.id && state.window.release===prior.window.release);
    const UUID=taskId(prior.window,item); const task=await db.get(STORES.todo,UUID);
    if(!retained && task) deletes.push({store:STORES.todo,UUID});
    else if(retained?.step==='done' && item.step!=='done' && task) puts.push({store:STORES.todo,record:{...task,completedAt:now,updatedAt:now}});
  }
  await db.commitAtomicMutation({label:'gate-save-state',puts,deletes,flush:true});
}
export async function loadGateInputs(db, now = new Date()) {
  const [completedTasks, todos] = await Promise.all([db.getAll(STORES.task), db.getAll(STORES.todo)]);
  const result = await db.decideR1({ now, todos });
  return { completedTasks, todos, r1: result.decision };
}
export async function lockItemWithCoins(db, player, state, id, { estimateMinutes } = {}) {
  if (!Number.isInteger(estimateMinutes) || estimateMinutes < 1) throw new GateError('missing-estimate');
  const ledgerUUID = uuid();
  const { state: next, price } = lockGateItem(state, id, { ledgerUUID, estimateMinutes });
  if (price > 0 && Number(player.tokens || 0) < price) throw new GateError('insufficient-coins');
  const now = new Date().toISOString();
  const item = next.window.items.find((entry) => entry.id === id);
  const puts = price > 0 ? [
    { store: STORES.player, record: { ...player, tokens: Number(player.tokens || 0) - price } },
    { store: STORES.transaction, record: { UUID: ledgerUUID, parent: player.UUID, type: 'gate_item', name: item.text, category: 'Gate', currencyType: 'tokens', quantity: 1, unitCost: price, totalCost: price, cost: price, createdAt: now, completedAt: now } },
  ] : [];
  puts.push({ store: STORES.appSetting, record: gateRecord(next, now) });
  puts.push({ store: STORES.todo, record: gateTask(next.window, item, player.UUID, now) });
  await db.commitAtomicMutation({ label: 'gate-lock-item', operationId: ledgerUUID, flush: true, puts });
  return { state: next, price };
}
