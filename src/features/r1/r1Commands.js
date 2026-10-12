import { appendR1Events as append, loadR1State as load, recordR1Change as record, R1_REWARD_SETTING } from '@data/persistence/services/R1EventService.js';
export const appendR1Events = (db, events, options) => append(db, events, options);
export const loadR1State = (db) => load(db);
export const recordR1Change = (db, options) => record(db, options);
export async function setRewardMinutes(db, minutes) {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1440) throw new TypeError('Reward time must be 0–1440 whole minutes.');
  return db.commitAtomicMutation({ label: 'r1-reward-setting', puts: [{ store: 'appSettings', record: { UUID: R1_REWARD_SETTING, value: minutes, updatedAt: new Date().toISOString() } }] });
}
export async function recordR1Override(db, { target, kind = 'work', suggested = null, now = new Date() }) {
  const { toModelHours } = await import('@data/persistence/services/R1Clock.js');
  return append(db, [{ ev: 'log', start: toModelHours(now), dur: 0, kind, ref: String(target || kind) }], {
    sourceKey: `override:${crypto.randomUUID()}`, meta: { picked_by: 'user', suggested },
  });
}
