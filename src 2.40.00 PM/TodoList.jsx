import { useContext, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { AppContext } from '../../App';
import NiceModal from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants';
import { getEligibleTodos, getWeights, getNextTodo, collectDescendants } from '../../utils/Helpers/Tasks';
import { prettyPrintDate } from '../../utils/Helpers/Time';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { v4 as uuid } from 'uuid';
import './TodoList.css';

const SORT_OPTIONS = [
  { value: 'due-asc',  label: 'Due (soonest)'  },
  { value: 'due-desc', label: 'Due (latest)'   },
  { value: 'dur-asc',  label: 'Duration (up)'  },
  { value: 'dur-desc', label: 'Duration (down)'},
  { value: 'name-asc', label: 'Name (A-Z)'     },
];

function applyFiltersAndSort(todos, { search, sort, minDur, maxDur }) {
  let list = [...todos];
  if (search.trim()) {
    const q = search.toLowerCase();
    list = list.filter(t => (t.name || '').toLowerCase().includes(q));
  }
  if (minDur !== '') list = list.filter(t => parseFloat(t.estimatedDuration || 0) >= +minDur);
  if (maxDur !== '') list = list.filter(t => parseFloat(t.estimatedDuration || 0) <= +maxDur);
  list.sort((a, b) => {
    switch (sort) {
      case 'due-asc':  return (a.dueDate ? new Date(a.dueDate) : Infinity) - (b.dueDate ? new Date(b.dueDate) : Infinity);
      case 'due-desc': return (b.dueDate ? new Date(b.dueDate) : 0) - (a.dueDate ? new Date(a.dueDate) : 0);
      case 'dur-asc':  return (parseFloat(a.estimatedDuration) || 0) - (parseFloat(b.estimatedDuration) || 0);
      case 'dur-desc': return (parseFloat(b.estimatedDuration) || 0) - (parseFloat(a.estimatedDuration) || 0);
      case 'name-asc': return (a.name || '').localeCompare(b.name || '');
      default:         return 0;
    }
  });
  return list;
}

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

function TodoList() {
  const { databaseConnection: db, timestamp, refresh, hasAccess } = useContext(AppContext);

  // ── Local cache: fetch from DB once, keep local for rendering ──────────────
  const cacheRef        = useRef([]);           // raw todos from last fetch
  const lastTimestamp   = useRef(null);

  const [allEligible, setAllEligible] = useState([]);
  const [nextTodo,    setNextTodo]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [searchOpen,  setSearchOpen]  = useState(false);
  const [sort,        setSort]        = useState('due-asc');
  const [minDur,      setMinDur]      = useState('');
  const [maxDur,      setMaxDur]      = useState('');
  const [showFilter,  setShowFilter]  = useState(false);
  const searchRef = useRef(null);

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 30); };
  const closeSearch = () => { if (!search) setSearchOpen(false); };

  const processAndSetTodos = useCallback((allTodos, hasAcc) => {
    const rootMap = {};
    allTodos.filter(t => t.isRoot).forEach(t => { rootMap[t.treeId] = t.name; });
    const enriched = allTodos.map(t => ({ ...t, treeName: t.treeId ? rootMap[t.treeId] : null }));
    const eligible = getEligibleTodos(enriched);
    const weights  = getWeights(eligible);
    const next     = hasAcc ? getNextTodo(eligible, weights) : null;
    setAllEligible(eligible);
    setNextTodo(next);
  }, []);

  const load = useCallback(async () => {
    // Only re-fetch from DB when timestamp changes (i.e. after a write)
    if (lastTimestamp.current === timestamp && cacheRef.current.length > 0) {
      processAndSetTodos(cacheRef.current, hasAccess);
      setLoading(false);
      return;
    }
    const player = await db.getOrCreatePlayer();
    if (!player) { setLoading(false); return; }
    const allTodos = await db.getPlayerStore(STORES.todo, player.UUID);
    cacheRef.current  = allTodos;
    lastTimestamp.current = timestamp;
    processAndSetTodos(allTodos, hasAccess);
    setLoading(false);
  }, [db, timestamp, hasAccess, processAndSetTodos]);

  useEffect(() => { load(); }, [load]);

  const displayList = useMemo(() =>
    applyFiltersAndSort(allEligible, { search, sort, minDur, maxDur }),
    [allEligible, search, sort, minDur, maxDur]
  );

  const handleComplete = async (todo) => {
    // Optimistic update: mark done locally immediately
    cacheRef.current = cacheRef.current.map(t =>
      t.UUID === todo.UUID ? { ...t, completed: true, completedAt: new Date().toISOString() } : t
    );
    processAndSetTodos(cacheRef.current, hasAccess);

    // Then write to DB
    const player   = await db.getOrCreatePlayer();
    const allTodos = await db.getPlayerStore(STORES.todo, player.UUID);
    const ids      = collectDescendants(allTodos, todo.UUID);
    const now      = new Date().toISOString();
    for (const id of ids) {
      const node = allTodos.find(t => t.UUID === id);
      if (!node || node.completed) continue;
      if (id === todo.UUID) {
        await db.add(STORES.task, { ...node, UUID: uuid(), nodeId: node.UUID, createdAt: now, completedAt: now });
      }
      await db.add(STORES.todo, { ...node, completed: true, completedAt: now });
    }
    refresh();
  };

  const handleOpen    = (todo) => NiceModal.show(TaskCreationMenu, { todoId: todo.UUID });
  const handleNewTodo = ()     => NiceModal.show(TaskCreationMenu, {});

  if (loading) return <div className="todolist-empty">Loading...</div>;

  return (
    <div className="todolist">
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
          <select className="todolist-sort" value={sort} onChange={e => setSort(e.target.value)}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            className={`todolist-filter-btn${showFilter ? ' active' : ''}`}
            onClick={() => setShowFilter(v => !v)}
          >Filter</button>
          <button className="btn-ghost todolist-add-btn" onClick={handleNewTodo}>+ task</button>
        </div>
      </div>

      {showFilter && (
        <div className="todolist-filter-panel">
          <label className="filter-field">
            <span>Min duration (min)</span>
            <input type="number" min="0" value={minDur} onChange={e => setMinDur(e.target.value)} placeholder="e.g. 15" />
          </label>
          <label className="filter-field">
            <span>Max duration (min)</span>
            <input type="number" min="0" value={maxDur} onChange={e => setMaxDur(e.target.value)} placeholder="e.g. 60" />
          </label>
          <button className="btn-ghost" onClick={() => { setMinDur(''); setMaxDur(''); }}>Clear</button>
        </div>
      )}

      {hasAccess && nextTodo && !search ? (
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
            <span className="todolist-next-name" style={{ color: '#b8922a' }}>Unlock smart task suggestions</span>
          </div>
          <span className="todolist-next-arrow" style={{ color: '#b8922a' }}>&#8250;</span>
        </div>
      ) : null}

      {displayList.length === 0 ? (
        <div className="todolist-empty">
          <p>{search ? 'No matching tasks.' : 'No tasks yet.'}</p>
          {!search && <p className="todolist-empty-sub">Press "+ task" to add one, or build a tree with deadlines.</p>}
        </div>
      ) : (
        <div className="todolist-items">
          {displayList.map(todo => (
            <TodoItem
              key={todo.UUID}
              todo={todo}
              onComplete={handleComplete}
              onOpen={handleOpen}
              isNext={todo.UUID === nextTodo?.UUID}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export default TodoList;
