// Lot crates/lot-model/src/lib.rs:39-100. Only observable facts cross this seam.
export const EVENT_FIELDS = Object.freeze({
  add: ['id', 'now', 'q', 'd', 'start', 'cycle', 'habit', 'category'],
  estimate: ['id', 'now', 'q'], deadline: ['id', 'now', 'd'], start: ['id', 'now', 'start'],
  complete: ['id', 'now'], reopen: ['id', 'now'], remove: ['id', 'now'],
  log: ['start', 'dur', 'kind', 'ref'], block: ['id', 'now', 'block'],
  after: ['id', 'now', 'after'], hold: ['id', 'now', 'until'],
});
export function validateEvent(event) {
  const fields = EVENT_FIELDS[event?.ev];
  if (!fields) throw new TypeError('Unknown R1 event');
  for (const key of Object.keys(event)) if (key !== 'ev' && !fields.includes(key)) throw new TypeError(`Unexpected R1 field: ${key}`);
  for (const key of ['now', 'q', 'd', 'start', 'cycle', 'dur', 'block', 'until']) {
    if (event[key] != null && !Number.isFinite(event[key])) throw new TypeError(`Invalid R1 ${key}`);
  }
  if (event.ev === 'log') {
    if (!Number.isFinite(event.start) || !Number.isFinite(event.dur) || !['work', 'extra', 'reward', 'rest', 'wait', 'adjust'].includes(event.kind) || typeof event.ref !== 'string') throw new TypeError('Invalid R1 log');
    if (event.kind !== 'adjust' && event.dur < 0) throw new TypeError('Negative R1 duration');
  } else if (!event.id || !Number.isFinite(event.now)) throw new TypeError('R1 event requires id and time');
  if (event.ev === 'add' && (!Number.isFinite(event.q) || event.q < 0 || !Number.isFinite(event.d) || (event.cycle != null && event.cycle <= 0))) throw new TypeError('Invalid R1 item');
  return { ...event };
}
// Rust lot-model lib.rs:100-117.
export const eventAt = (event) => event.ev === 'log' ? event.start + event.dur : event.now;
