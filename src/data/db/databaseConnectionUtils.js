import { STORES } from '@domain/constants.js';

const IGT_STORES = new Set([
  STORES.task,
  STORES.journal,
  STORES.event,
  STORES.transaction,
  STORES.match,
  STORES.friendship,
  STORES.notification,
  STORES.journalComment,
  STORES.eventLog,
  STORES.goalArea,
  STORES.goalMilestone,
  STORES.goalUpdate,
  STORES.goalLink,
  STORES.goalParticipant,
  STORES.actionPlan,
  STORES.actionSession,
  STORES.handoff,
  STORES.rhythmOpportunity,
  STORES.interventionDecision,
  STORES.rewardProvenance,
  STORES.worldConsequenceReceipt,
  STORES.matchScoreEvent,
  STORES.profileContextItem,
  STORES.profileContextRecipient,
  STORES.profileContextSuggestion,
  STORES.profileContextPreference,
  STORES.profileContextAudit,
]);

export const TIMESTAMPED_STORES = new Set([...IGT_STORES, STORES.contribution]);

export const IMAGE_LIMIT_KB = 30;
export const IMAGE_MAX_DIM = 1200;
const isDataImage = (value) => typeof value === 'string' && /^data:image\//i.test(value);

export function compressDataUrl(dataUrl, targetKB = IMAGE_LIMIT_KB, maxDim = IMAGE_MAX_DIM) {
  if (!isDataImage(dataUrl)) return Promise.resolve(dataUrl);
  if ((dataUrl.length * 0.75) / 1024 <= targetKB) return Promise.resolve(dataUrl);
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width: w, height: h } = img;
      if (w > h) { if (w > maxDim) { h = Math.round((h / w) * maxDim); w = maxDim; } }
      else        { if (h > maxDim) { w = Math.round((w / h) * maxDim); h = maxDim; } }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      let lo = 0.05, hi = 0.92, result = '';
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        result = canvas.toDataURL('image/jpeg', mid);
        if ((result.length * 0.75) / 1024 > targetKB) hi = mid; else lo = mid;
      }
      resolve(result);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export function normalizePlayerEloFields(player = {}, existing = null) {
  const currentElo = Math.max(0, Number(
    player?.elo
    ?? existing?.elo
    ?? player?.igtBaseElo
    ?? existing?.igtBaseElo
    ?? 0,
  ));
  const baseElo = Math.max(0, Number(
    player?.igtBaseElo
    ?? existing?.igtBaseElo
    ?? player?.elo
    ?? existing?.elo
    ?? 0,
  ));
  return {
    ...player,
    elo: currentElo,
    igtBaseElo: baseElo,
  };
}

export function createEmptyStoreMap() {
  return new Map(Object.values(STORES).map((store) => [store, new Map()]));
}

export function createEmptyAppState() {
  return {
    activePlayerUUID: null,
    activePlayerChangedAt: null,
    mobileWorkingSetAppliedAt: null,
    mobileWorkingSetSchemaVersion: 0,
    pendingCustomization: {
      playerImages: {},
      eventBanners: {},
      shopImages: {},
      journalImages: {},
    },
    violations: {},
    banPending: {},
  };
}

export function cloneValue(value) {
  if (value == null) return value;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); }
    catch { /* fall back for non-cloneable handles */ }
  }
  if (Array.isArray(value)) return value.map(cloneValue);
  if (typeof value === 'object') return { ...value };
  return value;
}

export function matchesIndex(record, indexName, key) {
  if (!record) return false;
  const value = record[indexName];
  if (Array.isArray(value)) return value.some((entry) => String(entry) === String(key));
  return String(value) === String(key);
}

export function normalizePendingCustomization(value = {}) {
  return {
    playerImages: value.playerImages && typeof value.playerImages === 'object' ? value.playerImages : {},
    eventBanners: value.eventBanners && typeof value.eventBanners === 'object' ? value.eventBanners : {},
    shopImages: value.shopImages && typeof value.shopImages === 'object' ? value.shopImages : {},
    journalImages: value.journalImages && typeof value.journalImages === 'object' ? value.journalImages : {},
  };
}

export function normalizeAppState(value = {}) {
  const base = createEmptyAppState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  return {
    activePlayerUUID: value.activePlayerUUID || null,
    activePlayerChangedAt: value.activePlayerChangedAt || null,
    mobileWorkingSetAppliedAt: value.mobileWorkingSetAppliedAt || null,
    mobileWorkingSetSchemaVersion: Math.max(0, Number(value.mobileWorkingSetSchemaVersion) || 0),
    pendingCustomization: normalizePendingCustomization(value.pendingCustomization),
    violations: value.violations && typeof value.violations === 'object' ? value.violations : {},
    banPending: value.banPending && typeof value.banPending === 'object' ? value.banPending : {},
  };
}
