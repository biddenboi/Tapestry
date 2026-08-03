import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8');
const [endDay, profileSwitcher, wakePopup, automation] = await Promise.all([
  read('./EndDayConfirm.jsx'),
  read('../../../profile/modals/ProfileSwitcher/ProfileSwitcher.jsx'),
  read('../WakePopup/WakePopup.jsx'),
  read('../../../../app/day-boundary/useDayBoundaryAutomation.js'),
]);

test('end-of-day completion saves the next-launch receipt before the goodnight close', () => {
  assert.match(endDay, /requireDailyLifecycleProfileSelection/);
  assert.match(endDay, /await databaseConnection\.flushWrites\?\.\(\)/);
  assert.match(endDay, /setCompletionPhase\('goodnight'\)/);
  assert.match(endDay, /requestApplicationClose/);
  assert.match(endDay, /remote\?\.getCurrentWindow\?\.\(\)/);
  assert.match(endDay, /targetWindow\.close\?\.\(\)/);
  assert.doesNotMatch(endDay, /loadProfileSwitcher|NiceModal\.show\(ProfileSwitcher/);
});

test('the next launch orders profile selection before the selected profile wake checklist', () => {
  assert.match(automation, /profile-selection-required/);
  assert.match(automation, /showProfileSwitcher\(\{/);
  assert.match(profileSwitcher, /requireDailyLifecycleWake/);
  assert.match(automation, /wake-required/);
  assert.match(automation, /NiceModal\.show\(WakePopup/);
  assert.doesNotMatch(
    automation,
    /const WakePopup = await loadWakePopup\(\);[\s\S]{0,120}if \(cancelled\) return/,
  );
  assert.match(wakePopup, /completeDailyLifecycleLaunch/);
});

test('the wake checklist remains mandatory until its durable launch flow completes', () => {
  assert.match(wakePopup, /wakeState === 'completed' && !lifecycleFlowId/);
  assert.match(wakePopup, /flowId: lifecycleFlowId/);
  assert.match(wakePopup, /await databaseConnection\.flushWrites\?\.\(\)/);
});
