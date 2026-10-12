// Lot model clock: local wall time since 2026-01-01 at the rollover hour.
// Dates stay outside src/domain/r1; elapsed session duration always comes from ms.
const ORIGIN = Date.UTC(2026, 0, 1);
export function toModelHours(value, rolloverHour = 4) {
  const d = new Date(value);
  return (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()) - ORIGIN) / 3600000 - rolloverHour;
}
export function fromModelHours(hours, rolloverHour = 4) {
  const d = new Date(ORIGIN + (hours + rolloverHour) * 3600000);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()).toISOString();
}
