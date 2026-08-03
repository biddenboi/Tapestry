import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [controller, view, domain, styles] = await Promise.all([
  read('./TodoList.jsx'),
  read('./TodoListView.jsx'),
  read('../../../../domain/tasks/TodoView.js'),
  read('./styles/TodoList.hub.css'),
]);

test('task rows open the full task modal without closing the Tasks panel', () => {
  assert.match(controller, /const selectTask = async \(task\) => \{/);
  assert.match(controller, /requestAnimationFrame\(\(\) => showTaskCreationMenu\(\)\)/);
  assert.doesNotMatch(controller, /const selectTask = async \(task\)[\s\S]*?closePanel\(\)[\s\S]*?showTaskCreationMenu/);
  assert.doesNotMatch(view, /TaskInspector/);
  assert.doesNotMatch(styles, /todo-inspector/);
});

test('generic task drafts normalize legacy field shapes and local date-only input', () => {
  assert.match(controller, /normalizeTaskDraft\(task\)/);
  assert.match(domain, /name: String\(task\?\.name \?\? task\?\.title \?\? ''\)/);
  assert.match(domain, /dueDate: due && !Number\.isNaN\(due\.getTime\(\)\) \? due\.toISOString\(\) : null/);
  assert.match(domain, /new Date\(Number\(year\), Number\(month\) - 1, Number\(day\)\)/);
  assert.match(domain, /typeof day === 'string' \? dateOnlyToLocalDate\(day\) : null/);
});

test('task rows retain vertical breathing room and the task surface owns scrolling', () => {
  assert.match(styles, /\.todoist-group-list\s*\{[^}]*gap: 8px;[^}]*padding: 8px;/s);
  assert.match(styles, /\.todoist-row\s*\{[^}]*border: 1px solid var\(--border-subtle\);[^}]*border-radius:/s);
  assert.match(styles, /\.todo-hub-main\s*\{[^}]*overflow-y: auto;/s);
});
