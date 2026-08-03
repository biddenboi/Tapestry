export function normalizeGlobalMoney(amount) {
  const numeric = Number(amount);
  return Math.max(0, Number.isFinite(numeric) ? numeric : 0);
}

export function readGlobalMoney(state = {}) {
  return normalizeGlobalMoney(state.globalMoney);
}

export function writeGlobalMoney(amount, state = {}) {
  const normalized = normalizeGlobalMoney(amount);
  state.globalMoney = normalized;
  return normalized;
}

export function createEconomyState(globalMoney) {
  return { globalMoney: normalizeGlobalMoney(globalMoney) };
}

export function parseEconomyState(value, source = 'economy state') {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} must contain a JSON object.`);
  }

  const globalMoney = Number(value.globalMoney);
  if (!Number.isFinite(globalMoney) || globalMoney < 0) {
    throw new Error(`${source} has an invalid globalMoney value.`);
  }
  return { globalMoney };
}
