import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants';
import { getDirectChildren, collectDescendants } from '../../utils/Helpers/Tasks';
import { prettyPrintDate } from '../../utils/Helpers/Time';
import { v4 as uuid } from 'uuid';
import './TaskCreationMenu.css';

// ── NLP token parser ──────────────────────────────────────────────────────────

const DAYS = {
  sunday:0, sun:0, monday:1, mon:1, tuesday:2, tue:2, tues:2,
  wednesday:3, wed:3, thursday:4, thu:4, thur:4, thurs:4,
  friday:5, fri:5, saturday:6, sat:6,
};
const MONTHS = {
  january:1, jan:1, february:2, feb:2, march:3, mar:3,
  april:4, apr:4, may:5, june:6, jun:6,
  july:7, jul:7, august:8, aug:8, september:9, sep:9, sept:9,
  october:10, oct:10, november:11, nov:11, december:12, dec:12,
};

function toISO(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d; }
function nextWeekday(idx) {
  const d = new Date(); let diff = idx - d.getDay();
  if (diff <= 0) diff += 7;
  d.setDate(d.getDate() + diff); return d;
}

export function parseTokens(text) {
  const candidates = [];
  const add = (m, type, value, display) =>
    candidates.push({ start: m.index, end: m.index + m[0].length, type, value, display });

  // Duration: "1h30m" / "1h 30m"
  for (const m of [...text.matchAll(/\b(\d+)\s*h(?:r|our)?s?\s*(\d+)\s*m(?:in(?:ute)?s?)?\b/gi)])
    add(m, 'duration', parseInt(m[1])*60 + parseInt(m[2]), `${m[1]}h ${m[2]}m`);

  // Duration: "1.5h" / "2hr"
  for (const m of [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*h(?:r|our)?s?\b/gi)]) {
    const mins = Math.round(parseFloat(m[1]) * 60);
    add(m, 'duration', mins, `${mins}m`);
  }

  // Duration: "30m" / "30min" / "30 minutes"
  for (const m of [...text.matchAll(/\b(\d+)\s*m(?:in(?:ute)?s?)?\b/gi)])
    add(m, 'duration', parseInt(m[1]), `${m[1]}m`);

  // Date: ISO 2026-04-15
  for (const m of [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)])
    add(m, 'date', `${m[1]}-${m[2]}-${m[3]}`, `${m[1]}-${m[2]}-${m[3]}`);

  // Date: MM/DD/YYYY or MM/DD
  for (const m of [...text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g)]) {
    const mo = parseInt(m[1]), dy = parseInt(m[2]);
    const yr = m[3] ? (m[3].length === 2 ? 2000+parseInt(m[3]) : parseInt(m[3])) : new Date().getFullYear();
    if (mo >= 1 && mo <= 12 && dy >= 1 && dy <= 31)
      add(m, 'date', `${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`, m[0]);
  }

  // Date: tomorrow / today
  for (const m of [...text.matchAll(/\btomorrow\b/gi)]) add(m, 'date', toISO(addDays(1)), 'Tomorrow');
  for (const m of [...text.matchAll(/\btoday\b/gi)])    add(m, 'date', toISO(new Date()),  'Today');

  // Date: "in N days/weeks"
  for (const m of [...text.matchAll(/\bin\s+(\d+)\s+(day|days|week|weeks)\b/gi)]) {
    const n = parseInt(m[1]); const u = m[2].toLowerCase();
    add(m, 'date', toISO(u.startsWith('w') ? addDays(n*7) : addDays(n)), `In ${n} ${u}`);
  }

  // Date: "next <day>"
  const dayPat = Object.keys(DAYS).join('|');
  for (const m of [...text.matchAll(new RegExp(`\\bnext\\s+(${dayPat})\\b`, 'gi'))]) {
    const d = new Date(); let diff = DAYS[m[1].toLowerCase()] - d.getDay();
    if (diff <= 0) diff += 7;
    d.setDate(d.getDate() + diff);
    add(m, 'date', toISO(d), `Next ${m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()}`);
  }

  // Date: bare day name (not preceded by "next")
  for (const m of [...text.matchAll(new RegExp(`\\b(${dayPat})\\b`, 'gi'))]) {
    if (/\bnext\s*$/i.test(text.slice(0, m.index))) continue;
    const d = nextWeekday(DAYS[m[1].toLowerCase()]);
    add(m, 'date', toISO(d), m[1][0].toUpperCase()+m[1].slice(1).toLowerCase());
  }

  // Date: "Month Day [Year]"
  const monthPat = Object.keys(MONTHS).join('|');
  for (const m of [...text.matchAll(new RegExp(`\\b(${monthPat})\\.?\\s+(\\d{1,2})(?:\\s+(\\d{4}))?\\b`, 'gi'))]) {
    const mo = MONTHS[m[1].toLowerCase()], dy = parseInt(m[2]);
    const yr = m[3] ? parseInt(m[3]) : new Date().getFullYear();
    if (dy >= 1 && dy <= 31)
      add(m, 'date', `${yr}-${String(mo).padStart(2,'0')}-${String(dy).padStart(2,'0')}`,
          `${m[1][0].toUpperCase()+m[1].slice(1).toLowerCase()} ${m[2]}`);
  }

  // Resolve: sort by position (then longest first), keep first non-overlapping of each type
  candidates.sort((a, b) => a.start - b.start || (b.end-b.start) - (a.end-a.start));
  const out = []; let lastEnd = 0; const seen = new Set();
  for (const c of candidates) {
    if (c.start < lastEnd || seen.has(c.type)) continue;
    out.push(c); seen.add(c.type); lastEnd = c.end;
  }
  return out.sort((a, b) => a.start - b.start);
}

function removeTokenFromText(text, token) {
  return (text.slice(0, token.start) + text.slice(token.end)).replace(/\s{2,}/g, ' ').trim();
}

function getCleanName(text, tokens) {
  let result = ''; let pos = 0;
  for (const t of tokens) { result += text.slice(pos, t.start); pos = t.end; }
  return (result + text.slice(pos)).replace(/\s{2,}/g, ' ').trim();
}

// ── Smart name input ──────────────────────────────────────────────────────────
// Plain input — no backdrop overlay (browsers render input/div text differently,
// causing cursor drift). Token feedback is handled by the chips row below.
function SmartNameInput({ value, onChange, tokens, autoFocus, placeholder }) {
  const inputRef = useRef(null);

  // One backspace at the END of a token removes the whole token at once
  const handleKeyDown = (e) => {
    if (e.key !== 'Backspace') return;
    if (e.target.selectionStart !== e.target.selectionEnd) return;
    const pos   = e.target.selectionStart;
    const token = tokens.find(t => t.end === pos);
    if (!token) return;
    e.preventDefault();
    const newVal = value.slice(0, token.start) + value.slice(token.end);
    onChange(newVal.replace(/\s{2,}/g, ' '));
    requestAnimationFrame(() => {
      if (inputRef.current) inputRef.current.setSelectionRange(token.start, token.start);
    });
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder || 'Task name  —  try "report fri 45m"'}
      autoFocus={autoFocus}
    />
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SubtaskRow({ todo, onOpen, onComplete }) {
  return (
    <div className="subtask-row">
      <button
        className={`subtask-check${todo.completed ? ' subtask-check--done' : ''}`}
        onClick={e => { e.stopPropagation(); onComplete(todo); }}
      >
        {todo.completed && (
          <svg width="9" height="9" viewBox="0 0 10 10">
            <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
          </svg>
        )}
      </button>
      <div className={`subtask-body${todo.completed ? ' subtask-body--done' : ''}`} onClick={() => onOpen(todo)}>
        <span className="subtask-name">{todo.name || 'Untitled'}</span>
        <div className="subtask-meta">
          {todo.isLabel           && <span className="subtask-tag subtask-tag--label">label</span>}
          {todo.dueDate           && <span className="subtask-date">{prettyPrintDate(todo.dueDate)}</span>}
          {todo.estimatedDuration && <span className="subtask-dur">{todo.estimatedDuration}m</span>}
        </div>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default NiceModal.create(({ todoId, parentNodeId, treeId }) => {
  const { databaseConnection: db, todos: allTodos = [], refresh } = useContext(AppContext);
  const modal  = useModal();
  const isNew  = !todoId;

  // Core form state
  const [efficiency,   setEfficiency]   = useState('');
  const [isLabel,      setIsLabel]      = useState(false);
  const [completed,    setCompleted]    = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [currentId,    setCurrentId]    = useState(todoId || null);
  const [navStack,     setNavStack]     = useState([]);

  // Smart name field
  const [rawName,          setRawName]          = useState('');
  const [explicitDate,     setExplicitDate]     = useState(null); // loaded from DB
  const [explicitDuration, setExplicitDuration] = useState(null); // loaded from DB

  // Parse rawName for tokens
  const tokens        = useMemo(() => parseTokens(rawName), [rawName]);
  const parsedDate    = tokens.find(t => t.type === 'date');
  const parsedDur     = tokens.find(t => t.type === 'duration');

  // Effective values: parsed (from rawName) wins over explicit (from DB)
  const effectiveDate     = parsedDate?.value   ?? explicitDate     ?? null;
  const effectiveDuration = parsedDur?.value != null
    ? String(parsedDur.value)
    : (explicitDuration ?? null);

  const dateDisplay = parsedDate?.display
    ?? (explicitDate     ? prettyPrintDate(explicitDate)     : null);
  const durDisplay  = parsedDur?.display
    ?? (explicitDuration ? `${explicitDuration}m`            : null);

  const removeDate = () => {
    if (parsedDate) setRawName(removeTokenFromText(rawName, parsedDate));
    setExplicitDate(null);
  };
  const removeDur = () => {
    if (parsedDur) setRawName(removeTokenFromText(rawName, parsedDur));
    setExplicitDuration(null);
  };

  // ── Derived ────────────────────────────────────────────────────────────
  const currentTodo = useMemo(
    () => (currentId ? allTodos.find(t => t.UUID === currentId) : null),
    [allTodos, currentId]
  );
  const children = useMemo(
    () => (currentId ? getDirectChildren(allTodos, currentId) : []),
    [allTodos, currentId]
  );

  // ── Escape key ──────────────────────────────────────────────────────────
  useEffect(() => {
    const k = (e) => {
      if (e.key === 'Escape') {
        if (navStack.length > 0) handleNavBack();
        else { modal.hide(); modal.remove(); }
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [navStack]);

  // ── Load task into form ─────────────────────────────────────────────────
  useEffect(() => {
    if (!currentId) {
      setRawName(''); setEfficiency(''); setIsLabel(false);
      setCompleted(false); setExplicitDate(null); setExplicitDuration(null);
      return;
    }
    if (!currentTodo) return;
    setRawName(currentTodo.name || '');
    setEfficiency(currentTodo.efficiency || '');
    setIsLabel(currentTodo.isLabel || false);
    setCompleted(currentTodo.completed || false);
    setExplicitDate(currentTodo.dueDate || null);
    setExplicitDuration(currentTodo.estimatedDuration || null);
  }, [currentId, currentTodo]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaving(true);
    const cleanName = tokens.length > 0 ? getCleanName(rawName, tokens) : rawName;
    await db.add(STORES.todo, {
      UUID:              currentId || uuid(),
      name:              cleanName || rawName,
      efficiency,
      estimatedDuration: effectiveDuration || '',
      dueDate:           effectiveDate || null,
      isLabel,
      treeId:            currentTodo?.treeId       ?? treeId       ?? null,
      parentNodeId:      currentTodo?.parentNodeId ?? parentNodeId ?? null,
      isRoot:            currentTodo?.isRoot       ?? false,
      completed:         currentTodo?.completed    ?? false,
      completedAt:       currentTodo?.completedAt  ?? null,
      createdAt:         currentTodo?.createdAt    ?? new Date().toISOString(),
    });
    setSaving(false);
    if (refresh) refresh({ syncRemote: false });
    modal.hide(); modal.remove();
  };

  const handleDelete = async () => {
    if (currentId) await db.remove(STORES.todo, currentId);
    if (refresh) refresh({ syncRemote: false });
    modal.hide(); modal.remove();
  };

  const handleToggleComplete = async () => {
    if (!currentId) return;
    const existing = allTodos.find(t => t.UUID === currentId);
    if (!existing) return;
    const now     = new Date().toISOString();
    const nowDone = !existing.completed;
    if (nowDone) {
      const ids = collectDescendants(allTodos, currentId);
      for (const id of ids) {
        const node = allTodos.find(t => t.UUID === id);
        if (!node || node.completed) continue;
        if (id === currentId)
          await db.add(STORES.task, { ...node, UUID: uuid(), nodeId: node.UUID, createdAt: now, completedAt: now });
        await db.add(STORES.todo, { ...node, completed: true, completedAt: now });
      }
    } else {
      await db.add(STORES.todo, { ...existing, completed: false, completedAt: null });
    }
    setCompleted(nowDone);
    if (refresh) refresh({ syncRemote: false });
  };

  const handleCompleteChild = async (child) => {
    const now = new Date().toISOString();
    if (child.completed) {
      await db.add(STORES.todo, { ...child, completed: false, completedAt: null });
    } else {
      const ids = collectDescendants(allTodos, child.UUID);
      for (const id of ids) {
        const node = allTodos.find(t => t.UUID === id);
        if (!node || node.completed) continue;
        await db.add(STORES.todo, { ...node, completed: true, completedAt: now });
      }
    }
  };

  const handleOpenChild = (child) => {
    setNavStack(s => [...s, currentId]);
    setCurrentId(child.UUID);
  };

  const handleNavBack = () => {
    const stack = [...navStack]; const prev = stack.pop();
    setNavStack(stack); setCurrentId(prev || null);
  };

  const [showAddChild, setShowAddChild] = useState(false);
  const [newChild,     setNewChild]     = useState({ name: '' });

  const handleAddChild = async () => {
    if (!newChild.name.trim() || !currentId) return;
    await db.add(STORES.todo, {
      UUID: uuid(), name: newChild.name, isLabel: false, isRoot: false,
      dueDate: null, estimatedDuration: '', efficiency: '',
      completed: false, completedAt: null,
      treeId: currentTodo?.treeId || treeId || null, parentNodeId: currentId,
      createdAt: new Date().toISOString(),
    });
    setNewChild({ name: '' }); setShowAddChild(false);
    if (refresh) refresh({ syncRemote: false });
  };

  const handleAddChildFull = () => {
    NiceModal.show(TaskCreationMenu, {
      parentNodeId: currentId, treeId: currentTodo?.treeId || treeId || null,
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────
  return modal.visible ? (
    <div className="modal-blanker tcm-blanker">
      <div className="modal-card tcm-card">
        <div className="tcm-header">
          {navStack.length > 0 && (
            <button className="btn-ghost tcm-back" onClick={handleNavBack}>&#8592;</button>
          )}
          <span className="modal-title">{isNew ? 'New task' : (rawName || 'Edit task')}</span>
          <button className="btn-ghost tcm-close" onClick={() => { modal.hide(); modal.remove(); }}>&#10005;</button>
        </div>

        <div className="tcm-body">
          {/* ── Left: form ── */}
          <div className="tcm-left">

            {/* Name with smart input */}
            <label className="tcm-field">
              <span className="label-sm">name</span>
              <div className="tcm-name-row">
                {currentId && !isLabel && (
                  <button
                    className={`tcm-complete-check${completed ? ' tcm-complete-check--done' : ''}`}
                    onClick={handleToggleComplete}
                    title={completed ? 'Mark incomplete' : 'Mark complete'}
                  >
                    {completed && (
                      <svg width="10" height="10" viewBox="0 0 10 10">
                        <polyline points="2,5 4,7 8,3" stroke="currentColor" strokeWidth="1.5" fill="none" />
                      </svg>
                    )}
                  </button>
                )}
                <SmartNameInput
                  value={rawName}
                  onChange={setRawName}
                  tokens={tokens}
                  autoFocus={isNew}
                />
              </div>
            </label>

            {/* Parsed/explicit date+duration chips */}
            {!isLabel && (effectiveDate || effectiveDuration) && (
              <div className="tcm-chips">
                {effectiveDate && (
                  <span className="tcm-chip tcm-chip--date">
                    <span>📅 {dateDisplay}</span>
                    <button className="tcm-chip-x" onClick={removeDate} title="Remove date">×</button>
                  </span>
                )}
                {effectiveDuration && (
                  <span className="tcm-chip tcm-chip--dur">
                    <span>⏱ {durDisplay}</span>
                    <button className="tcm-chip-x" onClick={removeDur} title="Remove duration">×</button>
                  </span>
                )}
              </div>
            )}

            {/* Label toggle */}
            <label className="tcm-field-row">
              <input type="checkbox" checked={isLabel} onChange={e => setIsLabel(e.target.checked)} style={{ width: 'auto' }} />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Label only (no deadline required)</span>
            </label>

            {/* Description */}
            <label className="tcm-field">
              <span className="label-sm">description / plan</span>
              <textarea
                rows={4}
                value={efficiency}
                onChange={e => setEfficiency(e.target.value)}
                placeholder="How will you approach this?"
              />
            </label>

            <div className="tcm-actions">
              {!isNew && <button className="btn-danger" onClick={handleDelete}>Delete</button>}
              <div style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => { modal.hide(); modal.remove(); }}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {/* ── Right: subtasks (available to all users) ── */}
          {currentId && currentTodo?.treeId && (
            <div className="tcm-right">
              <div className="tcm-subtasks-header">
                <span className="label-sm">subtasks</span>
                <div className="tcm-subtask-btns">
                  <button className="btn-ghost tcm-add-child-btn" onClick={() => setShowAddChild(v => !v)} title="Quick add">+</button>
                  <button className="btn-ghost tcm-add-child-btn" onClick={handleAddChildFull} title="Full form">&#10532;</button>
                </div>
              </div>

              {showAddChild && (
                <div className="tcm-quick-add">
                  <input
                    type="text" placeholder="Subtask name" value={newChild.name}
                    onChange={e => setNewChild(v => ({ ...v, name: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddChild()}
                    autoFocus
                  />
                  <div className="tcm-quick-actions">
                    <button className="btn-ghost" onClick={() => setShowAddChild(false)}>Cancel</button>
                    <button className="btn-primary" onClick={handleAddChild}>Add</button>
                  </div>
                </div>
              )}

              <div className="tcm-subtasks-list">
                {children.length === 0
                  ? <p className="tcm-empty-subtasks">No subtasks yet.</p>
                  : children.map(child => (
                      <SubtaskRow key={child.UUID} todo={child} onOpen={handleOpenChild} onComplete={handleCompleteChild} />
                    ))
                }
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;
});