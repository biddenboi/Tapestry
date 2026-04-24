import { useContext, useEffect, useState, useCallback } from 'react';
import { AppContext } from '../../App';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { STORES } from '../../utils/Constants';
import { getDirectChildren, collectDescendants } from '../../utils/Helpers/Tasks';
import { prettyPrintDate, parseNaturalDate } from '../../utils/Helpers/Time';
import UpgradePopup from '../UpgradePopup/UpgradePopup';
import { v4 as uuid } from 'uuid';
import './TaskCreationMenu.css';

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

function DateInput({ value, onChange }) {
  const [raw, setRaw] = useState(value || '');
  const [hint, setHint] = useState('');

  useEffect(() => { setRaw(value || ''); }, [value]);

  const handleChange = (e) => {
    const v = e.target.value;
    setRaw(v);
    const parsed = parseNaturalDate(v);
    if (parsed) {
      const isNatural = v.length !== 10 || isNaN(new Date(v));
      setHint(isNatural ? prettyPrintDate(parsed) : '');
      onChange(parsed);
    } else {
      setHint('');
      onChange(v);
    }
  };

  return (
    <div className="date-input-wrap">
      <input
        type="text"
        value={raw}
        onChange={handleChange}
        placeholder="e.g. tomorrow, next friday, in 3 days"
      />
      {hint && <span className="date-hint">{hint}</span>}
    </div>
  );
}

function LockedField({ label, onUnlock }) {
  return (
    <div className="tcm-locked-field" onClick={onUnlock}>
      <span className="label-sm">{label}</span>
      <div className="tcm-locked-inner">
        <span className="tcm-locked-text">Full access required</span>
        <span className="tcm-locked-cta">Unlock</span>
      </div>
    </div>
  );
}

export default NiceModal.create(({ todoId, parentNodeId, treeId }) => {
  const { databaseConnection: db, refresh, hasAccess } = useContext(AppContext);
  const modal = useModal();
  const isNew = !todoId;

  const [form, setForm] = useState({
    name: '', efficiency: '', estimatedDuration: '', dueDate: '', isLabel: false,
  });
  const [completed,    setCompleted]    = useState(false);
  const [children,     setChildren]     = useState([]);
  const [allTodos,     setAllTodos]     = useState([]);
  const [showAddChild, setShowAddChild] = useState(false);
  const [newChild,     setNewChild]     = useState({ name: '', isLabel: false });
  const [saving,       setSaving]       = useState(false);
  const [currentId,    setCurrentId]    = useState(todoId || null);
  const [navStack,     setNavStack]     = useState([]);

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

  const load = useCallback(async () => {
    const player = await db.getOrCreatePlayer();
    if (!player) return;
    const todos = await db.getPlayerStore(STORES.todo, player.UUID);
    setAllTodos(todos);
    if (currentId) {
      const todo = todos.find(t => t.UUID === currentId);
      if (!todo) return;
      setForm({
        name:              todo.name              || '',
        efficiency:        todo.efficiency        || '',
        estimatedDuration: todo.estimatedDuration || '',
        dueDate:           todo.dueDate           || '',
        isLabel:           todo.isLabel           || false,
      });
      setCompleted(todo.completed || false);
      setChildren(getDirectChildren(todos, currentId));
    }
  }, [db, currentId]);

  useEffect(() => { load(); }, [load]);

  const set = key => e =>
    setForm(p => ({ ...p, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    const player = await db.getOrCreatePlayer();
    if (!player) { setSaving(false); return; }
    const existing = allTodos.find(t => t.UUID === currentId);
    await db.add(STORES.todo, {
      UUID:              currentId || uuid(),
      name:              form.name,
      efficiency:        form.efficiency,
      estimatedDuration: hasAccess ? form.estimatedDuration : '',
      dueDate:           hasAccess ? (form.dueDate || null) : null,
      isLabel:           form.isLabel,
      treeId:            existing?.treeId       ?? treeId       ?? null,
      parentNodeId:      existing?.parentNodeId ?? parentNodeId ?? null,
      isRoot:            existing?.isRoot       ?? false,
      completed:         existing?.completed    ?? false,
    });
    setSaving(false);
    refresh();
    modal.hide();
    modal.remove();
  };

  const handleDelete = async () => {
    if (currentId) await db.remove(STORES.todo, currentId);
    refresh();
    modal.hide();
    modal.remove();
  };

  const handleToggleComplete = async () => {
    if (!currentId) return;
    const existing = allTodos.find(t => t.UUID === currentId);
    if (!existing) return;
    const now        = new Date().toISOString();
    const nowDone    = !existing.completed;

    if (nowDone) {
      const ids = collectDescendants(allTodos, currentId);
      for (const id of ids) {
        const node = allTodos.find(t => t.UUID === id);
        if (!node || node.completed) continue;
        if (id === currentId) {
          await db.add(STORES.task, { ...node, UUID: uuid(), nodeId: node.UUID, createdAt: now, completedAt: now });
        }
        await db.add(STORES.todo, { ...node, completed: true, completedAt: now });
      }
    } else {
      await db.add(STORES.todo, { ...existing, completed: false, completedAt: null });
    }

    setCompleted(nowDone);
    refresh();
    load();
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
    refresh();
    load();
  };

  const handleOpenChild = (child) => {
    setNavStack(s => [...s, currentId]);
    setCurrentId(child.UUID);
    setShowAddChild(false);
  };

  const handleNavBack = () => {
    const stack = [...navStack];
    const prev  = stack.pop();
    setNavStack(stack);
    setCurrentId(prev || null);
    setShowAddChild(false);
  };

  const handleAddChild = async () => {
    if (!newChild.name.trim() || !currentId) return;
    const player  = await db.getOrCreatePlayer();
    const current = allTodos.find(t => t.UUID === currentId);
    await db.add(STORES.todo, {
      UUID:              uuid(),
      name:              newChild.name,
      isLabel:           newChild.isLabel,
      isRoot:            false,
      dueDate:           null,
      estimatedDuration: '',
      efficiency:        '',
      completed:         false,
      treeId:            current?.treeId || treeId || null,
      parentNodeId:      currentId,
    });
    setNewChild({ name: '', isLabel: false });
    setShowAddChild(false);
    refresh();
    load();
  };

  const handleAddChildFull = () => {
    const current = allTodos.find(t => t.UUID === currentId);
    NiceModal.show(TaskCreationMenu, {
      parentNodeId: currentId,
      treeId:       current?.treeId || treeId || null,
    });
  };

  return modal.visible ? (
    <div className="modal-blanker tcm-blanker">
      <div className="modal-card tcm-card">

        <div className="tcm-header">
          {navStack.length > 0 && (
            <button className="btn-ghost tcm-back" onClick={handleNavBack}>&#8592;</button>
          )}
          <span className="modal-title">{isNew ? 'New task' : (form.name || 'Edit task')}</span>
          <button className="btn-ghost tcm-close" onClick={() => { modal.hide(); modal.remove(); }}>&#10005;</button>
        </div>

        <div className="tcm-body">
          {/* Left: form */}
          <div className="tcm-left">

            <label className="tcm-field">
              <span className="label-sm">name</span>
              <div className="tcm-name-row">
                {/* Only show complete checkbox when editing an existing non-label task */}
                {currentId && !form.isLabel && (
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
                <input
                  type="text"
                  value={form.name}
                  onChange={set('name')}
                  placeholder="Task name"
                  autoFocus={isNew}
                />
              </div>
            </label>

            <label className="tcm-field-row">
              <input
                type="checkbox"
                checked={form.isLabel}
                onChange={set('isLabel')}
                style={{ width: 'auto' }}
              />
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>Label only (no deadline required)</span>
            </label>

            {/* Only show deadline/duration fields for non-label tasks */}
            {!form.isLabel && (
              <div className="tcm-row">
                {hasAccess ? (
                  <label className="tcm-field">
                    <span className="label-sm">due date</span>
                    <DateInput value={form.dueDate} onChange={v => setForm(p => ({ ...p, dueDate: v }))} />
                  </label>
                ) : (
                  <LockedField label="due date" onUnlock={() => NiceModal.show(UpgradePopup)} />
                )}
                {hasAccess ? (
                  <label className="tcm-field">
                    <span className="label-sm">duration (min)</span>
                    <input
                      type="number"
                      min="1"
                      value={form.estimatedDuration}
                      onChange={set('estimatedDuration')}
                      placeholder="e.g. 30"
                    />
                  </label>
                ) : (
                  <LockedField label="duration (min)" onUnlock={() => NiceModal.show(UpgradePopup)} />
                )}
              </div>
            )}

            <label className="tcm-field">
              <span className="label-sm">description / plan</span>
              <textarea
                rows={4}
                value={form.efficiency}
                onChange={set('efficiency')}
                placeholder="How will you approach this?"
              />
            </label>

            <div className="tcm-actions">
              {!isNew && <button className="btn-danger" onClick={handleDelete}>Delete</button>}
              <div style={{ flex: 1 }} />
              <button className="btn-ghost" onClick={() => { modal.hide(); modal.remove(); }}>Cancel</button>
              <button className="btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>

          {/* Right: subtasks — only when editing */}
          {currentId && (
            <div className="tcm-right">
              <div className="tcm-subtasks-header">
                <span className="label-sm">subtasks</span>
                <div className="tcm-subtask-btns">
                  <button className="btn-ghost tcm-add-child-btn" onClick={() => setShowAddChild(v => !v)} title="Quick add">+</button>
                  <button className="btn-ghost tcm-add-child-btn" onClick={handleAddChildFull} title="Full form">&#10532;</button>
                </div>
              </div>

              {showAddChild && (
                <div className="tcm-add-child-form">
                  <input
                    type="text"
                    value={newChild.name}
                    onChange={e => setNewChild(p => ({ ...p, name: e.target.value }))}
                    placeholder="Subtask name"
                    onKeyDown={e => e.key === 'Enter' && handleAddChild()}
                  />
                  <label className="tcm-field-row" style={{ marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={newChild.isLabel}
                      onChange={e => setNewChild(p => ({ ...p, isLabel: e.target.checked }))}
                      style={{ width: 'auto' }}
                    />
                    <span style={{ fontSize: 11, color: 'var(--text2)' }}>Label only</span>
                  </label>
                  <div className="tg-add-actions">
                    <button className="btn-ghost" onClick={() => setShowAddChild(false)}>Cancel</button>
                    <button className="btn-primary" onClick={handleAddChild}>Add</button>
                  </div>
                </div>
              )}

              {children.length === 0 && !showAddChild && (
                <p className="tcm-subtasks-empty">No subtasks yet.</p>
              )}

              <div className="tcm-subtask-list">
                {children.map(child => (
                  <SubtaskRow
                    key={child.UUID}
                    todo={child}
                    onOpen={handleOpenChild}
                    onComplete={handleCompleteChild}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;
});
