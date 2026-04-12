import { useContext, useMemo, useState, useRef } from 'react';
import { AppContext } from '../../App';
import NiceModal from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants';
import { getEligibleTodos, getWeights, getNextTodo, collectDescendants } from '../../utils/Helpers/Tasks';
import { prettyPrintDate } from '../../utils/Helpers/Time';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { v4 as uuid } from 'uuid';
import './TodoList.css';

// ── Date bucket helpers ───────────────────────────────────────────────────────
function todayMidnight() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function getBucketKey(dueDateStr) {
  if (!dueDateStr) return 'none';
  const today    = todayMidnight();
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const weekEnd  = new Date(today); weekEnd.setDate(today.getDate() + 7);
  const due      = new Date(dueDateStr);
  const dueDay   = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  if (dueDay < today)                          return 'overdue';
  if (dueDay.getTime() === today.getTime())    return 'today';
  if (dueDay.getTime() === tomorrow.getTime()) return 'tomorrow';
  if (dueDay < weekEnd)                        return 'week';
  return 'later';
}

const BUCKET_ORDER  = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none'];
const BUCKET_LABELS = {
  overdue:  'Overdue',
  today:    'Today',
  tomorrow: 'Tomorrow',
  week:     'This Week',
  later:    'Later',
  none:     'No Due Date',
};

// ── Flat sort options ─────────────────────────────────────────────────────────
const FLAT_SORTS = [
  { value: 'due-asc',  label: 'Due: Soonest'          },
  { value: 'due-desc', label: 'Due: Latest'            },
  { value: 'dur-asc',  label: 'Duration: Short → Long' },
  { value: 'dur-desc', label: 'Duration: Long → Short' },
  { value: 'name-asc', label: 'Name: A → Z'            },
];

function sortedFlat(list, sortKey) {
  return [...list].sort((a, b) => {
    switch (sortKey) {
      case 'due-asc':  return (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity);
      case 'due-desc': return (b.dueDate ? new Date(b.dueDate) : 0)        - (a.dueDate ? new Date(a.dueDate) : 0);
      case 'dur-asc':  return (parseFloat(a.estimatedDuration) || 0)       - (parseFloat(b.estimatedDuration) || 0);
      case 'dur-desc': return (parseFloat(b.estimatedDuration) || 0)       - (parseFloat(a.estimatedDuration) || 0);
      case 'name-asc': return (a.name || '').localeCompare(b.name || '');
      default:         return 0;
    }
  });
}

function buildGroups(list) {
  const groups = {};
  BUCKET_ORDER.forEach(b => { groups[b] = []; });
  list.forEach(t => groups[getBucketKey(t.dueDate)]?.push(t));
  // Within each bucket sort by due date, then name
  Object.values(groups).forEach(g =>
    g.sort((a, b) => {
      if (a.dueDate && b.dueDate) return new Date(a.dueDate) - new Date(b.dueDate);
      return (a.name || '').localeCompare(b.name || '');
    })
  );
  return groups;
}

function applyFilters(todos, { search, treeFilter, quickFilter, minDur, maxDur }) {
  let list = [...todos];
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter(t => (t.name || '').toLowerCase().includes(q));
  }
  if (treeFilter) list = list.filter(t => (t.treeId || t.UUID) === treeFilter);
  switch (quickFilter) {
    case 'overdue': list = list.filter(t => getBucketKey(t.dueDate) === 'overdue'); break;
    case 'today':   list = list.filter(t => getBucketKey(t.dueDate) === 'today');   break;
    case 'nodate':  list = list.filter(t => !t.dueDate);                            break;
    default: break;
  }
  if (minDur !== '') list = list.filter(t => parseFloat(t.estimatedDuration || 0) >= +minDur);
  if (maxDur !== '') list = list.filter(t => parseFloat(t.estimatedDuration || 0) <= +maxDur);
  return list;
}

// ── Sub-components ────────────────────────────────────────────────────────────
function TodoItem({ todo, onComplete, onOpen, isNext }) {
  return (
    <div className={`todo-item${isNext ? ' todo-item--next' : ''}${todo.completed ? ' todo-item--done' : ''}`}>
      <button className="todo-check" onClick={e => { e.stopPropagation(); onComplete(todo); }}>
        {todo.completed && (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        )}
      </button>
      <div className="todo-body" onClick={() => onOpen(todo)}>
        <span className="todo-name">{todo.name || 'Untitled'}</span>
        {todo.treeName && <span className="todo-tree-tag">{todo.treeName}</span>}
        <div className="todo-meta">
          {todo.dueDate           && <span className="todo-date">{prettyPrintDate(todo.dueDate)}</span>}
          {todo.estimatedDuration && <span className="todo-dur">{todo.estimatedDuration}m</span>}
        </div>
      </div>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="6.5" cy="6.5" r="4.5" /><line x1="10" y1="10" x2="14" y2="14" />
    </svg>
  );
}

function DateGroupHeader({ bucket, count }) {
  return (
    <div className={`todo-group-header todo-group-header--${bucket}`}>
      <span className="todo-group-label">{BUCKET_LABELS[bucket]}</span>
      <span className="todo-group-count">{count}</span>
      <hr className="todo-group-section-divider"/>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
function TodoList() {
  const { databaseConnection: db, hasAccess, todos = [], cacheReady, refresh } = useContext(AppContext);

  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [viewMode,    setViewMode]    = useState('grouped'); // 'grouped' | 'flat'
  const [sortKey,     setSortKey]     = useState('due-asc');
  const [showFilter,  setShowFilter]  = useState(false);
  const [treeFilter,  setTreeFilter]  = useState('');
  const [quickFilter, setQuickFilter] = useState('');
  const [minDur,      setMinDur]      = useState('');
  const [maxDur,      setMaxDur]      = useState('');
  const searchRef = useRef(null);

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 30); };
  const closeSearch = () => { if (!search) setSearchOpen(false); };

  const { allEligible, nextTodo } = useMemo(() => {
    const rootMap = {};
    todos.filter(t => t.isRoot).forEach(t => { rootMap[t.treeId || t.UUID] = t.name; });
    const enriched = todos.map(t => ({ ...t, treeName: t.treeId ? rootMap[t.treeId] : null }));
    const eligible = getEligibleTodos(enriched);
    const weights  = getWeights(eligible);
    const next     = hasAccess ? getNextTodo(eligible, weights) : null;
    return { allEligible: eligible, nextTodo: next };
  }, [todos, hasAccess]);

  const availableTrees = useMemo(
    () => todos.filter(t => t.isRoot).map(t => ({ id: t.treeId || t.UUID, name: t.name || 'Untitled' })),
    [todos]
  );

  const filtered = useMemo(
    () => applyFilters(allEligible, { search, treeFilter, quickFilter, minDur, maxDur }),
    [allEligible, search, treeFilter, quickFilter, minDur, maxDur]
  );

  const groups   = useMemo(() => viewMode === 'grouped' ? buildGroups(filtered) : null,         [filtered, viewMode]);
  const flatList = useMemo(() => viewMode === 'flat'    ? sortedFlat(filtered, sortKey) : null, [filtered, viewMode, sortKey]);

  const activeFilterCount = [treeFilter, quickFilter, minDur, maxDur].filter(Boolean).length;

  const handleComplete = async (todo) => {
    const ids = collectDescendants(todos, todo.UUID);
    const now = new Date().toISOString();
    for (const id of ids) {
      const node = todos.find(t => t.UUID === id);
      if (!node || node.completed) continue;
      if (id === todo.UUID) {
        await db.add(STORES.task, { ...node, UUID: uuid(), nodeId: node.UUID, createdAt: now, completedAt: now });
      }
      await db.add(STORES.todo, { ...node, completed: true, completedAt: now });
    }
    if (refresh) refresh({ syncRemote: false });
  };

  const handleOpen    = (todo) => NiceModal.show(TaskCreationMenu, { todoId: todo.UUID });
  const handleNewTodo = ()     => NiceModal.show(TaskCreationMenu, {});
  const clearFilters  = ()     => { setTreeFilter(''); setQuickFilter(''); setMinDur(''); setMaxDur(''); };

  if (!cacheReady) return <div className="todolist-empty">Loading...</div>;

  const renderItems = (list) =>
    list.map(todo => (
      <TodoItem
        key={todo.UUID}
        todo={todo}
        onComplete={handleComplete}
        onOpen={handleOpen}
        isNext={nextTodo?.UUID === todo.UUID}
      />
    ));

  return (
    <div className="todolist">
      {/* ── Header ── */}
      <div className="todolist-header">
        <span className="todolist-title">Tasks</span>
        <div className="todolist-controls">
          <div className={`search-wrap${searchOpen ? ' search-wrap--open' : ''}`}>
            {searchOpen ? (
              <input
                ref={searchRef}
                className="todolist-search"
                type="text"
                placeholder="Search tasks..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                onBlur={closeSearch}
              />
            ) : (
              <button className="search-icon-btn" onClick={openSearch}><SearchIcon /></button>
            )}
          </div>

          {/* Grouped / flat toggle */}
          <div className="todolist-view-toggle">
            <button
              className={`view-toggle-btn${viewMode === 'grouped' ? ' view-toggle-btn--active' : ''}`}
              onClick={() => setViewMode('grouped')}
              title="Group by due date"
            >
              {/* stacked rows with left indent on rows 2-3 = "grouped" icon */}
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1.5"  x2="5"  y2="1.5" />
                <line x1="7" y1="1.5"  x2="12" y2="1.5" />
                <line x1="3" y1="5.5"  x2="12" y2="5.5" />
                <line x1="3" y1="9.5"  x2="12" y2="9.5" />
              </svg>
            </button>
            <button
              className={`view-toggle-btn${viewMode === 'flat' ? ' view-toggle-btn--active' : ''}`}
              onClick={() => setViewMode('flat')}
              title="Sorted flat list"
            >
              <svg width="13" height="11" viewBox="0 0 13 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <line x1="1" y1="1.5"  x2="12" y2="1.5" />
                <line x1="1" y1="5.5"  x2="12" y2="5.5" />
                <line x1="1" y1="9.5"  x2="12" y2="9.5" />
              </svg>
            </button>
          </div>

          {viewMode === 'flat' && (
            <select className="todolist-sort" value={sortKey} onChange={e => setSortKey(e.target.value)}>
              {FLAT_SORTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}

          <button
            className={`todolist-filter-btn${showFilter || activeFilterCount > 0 ? ' active' : ''}`}
            onClick={() => setShowFilter(v => !v)}
          >
            {activeFilterCount > 0 ? `Filter · ${activeFilterCount}` : 'Filter'}
          </button>
          <button className="btn-ghost todolist-add-btn" onClick={handleNewTodo}>+ task</button>
        </div>
      </div>

      {/* ── Filter panel ── */}
      {showFilter && (
        <div className="todolist-filter-panel">
          <div className="filter-section">
            <span className="filter-section-label">Show</span>
            <div className="filter-chips">
              {[
                { value: '',        label: 'All'     },
                { value: 'overdue', label: 'Overdue' },
                { value: 'today',   label: 'Today'   },
                { value: 'nodate',  label: 'No date' },
              ].map(chip => (
                <button
                  key={chip.value}
                  className={`filter-chip${quickFilter === chip.value ? ' filter-chip--active' : ''}`}
                  onClick={() => setQuickFilter(chip.value)}
                >{chip.label}</button>
              ))}
            </div>
          </div>

          {availableTrees.length > 0 && (
            <div className="filter-section">
              <span className="filter-section-label">Project</span>
              <select className="filter-select" value={treeFilter} onChange={e => setTreeFilter(e.target.value)}>
                <option value="">All projects</option>
                {availableTrees.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="filter-section">
            <span className="filter-section-label">Duration (min)</span>
            <div className="filter-dur-row">
              <input type="number" min="0" value={minDur} onChange={e => setMinDur(e.target.value)} placeholder="Min" className="filter-dur-input" />
              <span className="filter-dur-sep">–</span>
              <input type="number" min="0" value={maxDur} onChange={e => setMaxDur(e.target.value)} placeholder="Max" className="filter-dur-input" />
            </div>
          </div>

          {activeFilterCount > 0 && (
            <button className="btn-ghost filter-clear-btn" onClick={clearFilters}>Clear all</button>
          )}
        </div>
      )}

      {/* ── Suggested next banner ── */}
      {hasAccess && nextTodo && !search && !quickFilter ? (
        <div className="todolist-next-banner">
          <button
            className="next-check"
            onClick={e => { e.stopPropagation(); handleComplete(nextTodo); }}
            title="Mark complete"
          />
          <div className="next-banner-body" onClick={() => NiceModal.show(TaskCreationMenu, { todoId: nextTodo.UUID })}>
            <span className="label-sm">suggested next</span>
            <span className="todolist-next-name">{nextTodo.name}</span>
          </div>
          <div className="next-banner-right">
            {nextTodo.estimatedDuration && <span className="todolist-next-dur">{nextTodo.estimatedDuration}m</span>}
            {nextTodo.dueDate           && <span className="todolist-next-date">{prettyPrintDate(nextTodo.dueDate)}</span>}
            <span className="todolist-next-arrow">&#8250;</span>
          </div>
        </div>
      ) : !hasAccess && allEligible.length > 0 && !search ? (
        <div className="todolist-next-banner todolist-next-banner--locked" onClick={() => NiceModal.show(UpgradePopup)}>
          <span className="next-banner-lock">+</span>
          <div className="next-banner-body">
            <span className="label-sm" style={{ color: '#b8922a' }}>suggested next</span>
            <span className="todolist-next-name">Unlock smart task suggestions</span>
          </div>
          <div className="next-banner-right"><span className="todolist-next-arrow">&#8250;</span></div>
        </div>
      ) : null}

      {/* ── Task list ── */}
      <div className="todolist-list">
        {filtered.length === 0 ? (
          <div className="todolist-empty">
            {search || activeFilterCount > 0 ? 'No tas    ks match your filters.' : 'No tasks yet.'}
          </div>
        ) : viewMode === 'grouped' ? (
          BUCKET_ORDER.map(bucket => {
            const items = groups[bucket];
            if (!items || items.length === 0) return null;
            return (
              <div key={bucket} className="todo-group">
                <DateGroupHeader bucket={bucket} count={items.length} />
                {renderItems(items)}
              </div>
            );
          })
        ) : (
          renderItems(flatList)
        )}
      </div>
    </div>
  );
}

export default TodoList;