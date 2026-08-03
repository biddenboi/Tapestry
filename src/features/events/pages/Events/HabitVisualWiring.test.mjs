import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('duration history uses fixed-size HTML points over the non-uniform SVG plot', async () => {
  const [component, css] = await Promise.all([
    read('./HabitPage.jsx'),
    read('./styles/Habits.page.css'),
  ]);
  assert.match(component, /className="habit-line-point"/);
  assert.doesNotMatch(component, /<circle/);
  assert.match(css, /\.habit-line-point\s*\{[\s\S]*?width:\s*7px;[\s\S]*?height:\s*7px;/);
  assert.match(css, /transform:\s*translate\(-50%, -50%\)/);
});

test('habit editor is a centered, wider rectangle with a mobile inset fallback', async () => {
  const [habitCss, shellCss] = await Promise.all([
    read('./styles/Habits.page.css'),
    read('../../../../app/shell/GameHub/styles/GameHub.current.css'),
  ]);
  for (const css of [habitCss, shellCss]) {
    assert.match(css, /\.evt-editor-capsule:has\(\.habit-editor\)/);
    assert.match(css, /calc\(\(100% - 720px\) \/ 2\)/);
  }
  assert.match(shellCss, /@media \(max-width: 760px\)[\s\S]*?\.evt-editor-capsule:has\(\.habit-editor\)/);
});
