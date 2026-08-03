export const CHRONICLE_RESURFACE_POLICY = Object.freeze({
  normal: 'normal',
  manualOnly: 'manual_only',
  never: 'never',
});

export function isChronicleResurfaceEligible(subject = {}, {
  proactive = true,
  now = new Date(),
  cooldownDays = 30,
} = {}) {
  if (subject.deletedAt || subject.lifecycleState === 'draft') return false;
  if (subject.resurfacePolicy === CHRONICLE_RESURFACE_POLICY.never) return false;
  if (proactive && subject.resurfacePolicy === CHRONICLE_RESURFACE_POLICY.manualOnly) return false;
  if (subject.dismissedAt) return false;
  const lastShown = new Date(subject.lastShownAt || '').getTime();
  if (!Number.isFinite(lastShown)) return true;
  return now.getTime() - lastShown >= cooldownDays * 24 * 60 * 60 * 1000;
}

export function onThisDayCandidates(entries = [], now = new Date()) {
  return entries
    .filter((entry) => isChronicleResurfaceEligible(entry))
    .filter((entry) => {
      const occurred = new Date(entry.occurrenceAt);
      return Number.isFinite(occurred.getTime())
        && occurred.getFullYear() < now.getFullYear()
        && occurred.getMonth() === now.getMonth()
        && occurred.getDate() === now.getDate();
    })
    .sort((a, b) => String(b.occurrenceAt).localeCompare(String(a.occurrenceAt)));
}
