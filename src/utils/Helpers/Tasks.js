import { DAY } from '../Constants.js';
import { getLocalDate } from './Time.js';

// ── Completion helpers ────────────────────────────────────────────────────────

export const getTaskDuration = (task) =>
  new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();

export const collectDescendants = (todos, rootId) => {
  const result = [rootId];
  const queue  = [rootId];
  while (queue.length) {
    const id = queue.shift();
    todos
      .filter(t => t.parentNodeId === id)
      .forEach(t => { result.push(t.UUID); queue.push(t.UUID); });
  }
  return result;
};

// ── Eligible todos for dashboard ──────────────────────────────────────────────
//
// Rules:
//  - Never completed or label-only
//  - Standalone (no treeId): always show
//  - In a tree: must be connected to root
//  - Must have a dueDate
//  - Only show the deepest deadline node per branch
//    (i.e. skip a node if any connected descendant also has a deadline)
//
// Root nodes are treated identically to other nodes with ONE addition:
//  - A root node appears in the todo list if it has a dueDate and no
//    connected descendant also has a deadline. Its completion marks the
//    tree as done (strikethrough) in the sidebar.

export const getEligibleTodos = (todos) => {
  const byId       = {};
  const childrenOf = {};
  todos.forEach(t => { byId[t.UUID] = t; childrenOf[t.UUID] = []; });
  todos.forEach(t => {
    if (t.parentNodeId && childrenOf[t.parentNodeId] !== undefined)
      childrenOf[t.parentNodeId].push(t.UUID);
  });

  const connCache = {};
  function isConnected(id) {
    if (id in connCache) return connCache[id];
    const node = byId[id];
    if (!node)              return (connCache[id] = false);
    if (!node.treeId)       return (connCache[id] = true);
    if (node.isRoot)        return (connCache[id] = true);
    if (!node.parentNodeId) return (connCache[id] = false);
    return (connCache[id] = isConnected(node.parentNodeId));
  }

  function hasConnectedDeadlineDescendant(id) {
    for (const childId of (childrenOf[id] || [])) {
      const child = byId[childId];
      if (!child || child.completed || !isConnected(childId)) continue;
      if (child.dueDate && !child.isLabel) return true;
      if (hasConnectedDeadlineDescendant(childId))            return true;
    }
    return false;
  }

  return todos.filter(t => {
    if (t.completed) return false;
    if (t.isLabel)   return false;
    if (t.isNote)    return false;  // sticky notes are visual-only

    // Standalone todos always appear
    if (!t.treeId) return true;

    // Must be connected to the tree root
    if (!isConnected(t.UUID)) return false;

    // Must have a deadline to surface in the todo list
    if (!t.dueDate) return false;

    // Only the deepest deadline node per branch (skip if a descendant has one)
    return !hasConnectedDeadlineDescendant(t.UUID);
  });
};

export const getDirectChildren = (todos, parentId) =>
  todos.filter(t => t.parentNodeId === parentId);

// ── Scheduling ────────────────────────────────────────────────────────────────

export const getDaysUntilDue = (task) => {
  const now = getLocalDate(new Date());
  const due = new Date(task.dueDate + 'T00:00:00');
  return Math.max((due - now) / DAY, 0) + 1;
};

export const getTodoWPD = (task) => {
  const dur  = parseFloat(task.estimatedDuration) || 0;
  const days = getDaysUntilDue(task);
  return dur / days;
};

export const getAllWPDFromArray = (data) => data.map(t => getTodoWPD(t));

export const getWeights = (todoArray) => {
  if (!todoArray.length) return [];
  const today         = getLocalDate(new Date());
  const dueTodayTasks = todoArray.filter(t => t.dueDate && new Date(t.dueDate).getTime() < today.getTime());

  if (dueTodayTasks.length > 0) {
    dueTodayTasks.sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
    return todoArray.map(t => (dueTodayTasks[0].UUID === t.UUID ? 100 : 0));
  }

  today.setHours(0, 0, 0, 0);
  const weights = todoArray.map(t => {
    if (!t.dueDate || !t.estimatedDuration) return 1;
    return getTodoWPD(t);
  });
  const total = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return todoArray.map(() => 100 / todoArray.length);
  return weights.map(w => (w / total) * 100);
};

export const getNextTodo = (todoArray, weightArray = []) => {
  if (!todoArray.length) return null;
  const rng     = 1 + Math.random() * 99;
  let remaining = rng;
  let selected  = todoArray[todoArray.length - 1];
  for (let i = 0; i < weightArray.length; i++) {
    remaining -= weightArray[i];
    if (remaining <= 0) { selected = todoArray[i]; break; }
  }
  return selected;
};