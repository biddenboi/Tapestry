import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [profile, view, personalization] = await Promise.all([
  read('../profile/pages/Profile/Profile.jsx'),
  read('./components/LifeContextBlock.jsx'),
  read('../../domain/profile/ProfilePersonalization.js'),
]);

test('Profile owns authoring, policy preview, suggestions, and the unique free Life Context block', () => {
  assert.match(profile, /useProfileContextController/);
  assert.match(profile, /<LifeContextBlock/);
  assert.match(view, /Edit context/);
  assert.match(view, /ContextStudio/);
  assert.match(personalization, /type: 'lifeContext'/);
  assert.match(personalization, /free: true/);
  assert.match(personalization, /unique: true/);
  assert.match(personalization, /columns: 12, height: 360/);
});
