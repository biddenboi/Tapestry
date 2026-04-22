import './ProjectsModal.css';
import { useState, useEffect, useCallback, useContext } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { AppContext } from '../../App.jsx';
import { STORES } from '../../utils/Constants.js';

export default NiceModal.create(({ onChanged }) => {
  const { databaseConnection, refreshApp } = useContext(AppContext);
  const modal = useModal();

  const [projects, setProjects]       = useState([]);
  const [newName, setNewName]         = useState('');
  const [editingId, setEditingId]     = useState(null);
  const [editingName, setEditingName] = useState('');

  const load = useCallback(async () => {
    const rows = await databaseConnection.getAll(STORES.project);
    setProjects(rows.sort((a, b) => String(a.name).localeCompare(String(b.name))));
  }, [databaseConnection]);

  useEffect(() => { load(); }, [load]);

  const close = () => { modal.hide(); modal.remove(); };

  // ── Create ────────────────────────────────────────────────────────────
  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const now = new Date().toISOString();
    await databaseConnection.add(STORES.project, {
      UUID: uuid(),
      name,
      parent: null,
      createdAt: now,
    });
    setNewName('');
    await load();
    refreshApp();
    onChanged?.();
  };

  const handleCreateKeyDown = (e) => {
    if (e.key === 'Enter') handleCreate();
  };

  // ── Rename ────────────────────────────────────────────────────────────
  const startEdit = (project) => {
    setEditingId(project.UUID);
    setEditingName(project.name);
  };

  const commitEdit = async (project) => {
    const name = editingName.trim();
    setEditingId(null);
    if (!name || name === project.name) return;
    await databaseConnection.add(STORES.project, { ...project, name });
    await load();
    refreshApp();
    onChanged?.();
  };

  const handleEditKeyDown = (e, project) => {
    if (e.key === 'Enter')  commitEdit(project);
    if (e.key === 'Escape') setEditingId(null);
  };

  // ── Delete ────────────────────────────────────────────────────────────
  const handleDelete = async (project) => {
    await databaseConnection.remove(STORES.project, project.UUID);
    // Unlink any todos that referenced this project.
    const todos = await databaseConnection.getAll(STORES.todo);
    for (const todo of todos) {
      if (todo.projectId === project.UUID) {
        // eslint-disable-next-line no-await-in-loop
        await databaseConnection.add(STORES.todo, { ...todo, projectId: null });
      }
    }
    await load();
    refreshApp();
    onChanged?.();
  };

  if (!modal.visible) return null;

  return (
    <div className="task-modal-overlay">
      <div className="blanker" onClick={close} />
      <div className="task-modal projects-modal">

        <div className="task-modal-header">
          <span>PROJECTS</span>
          <button
            className="tcm-delete-btn"
            onClick={close}
            style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          >
            CLOSE
          </button>
        </div>

        <div className="task-form-body projects-body">

          {/* ── Create new ─────────────────────────────────── */}
          <div className="projects-create-row">
            <input
              type="text"
              className="projects-name-input"
              placeholder="New project name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleCreateKeyDown}
              autoFocus
            />
            <button
              className="primary projects-add-btn"
              onClick={handleCreate}
              disabled={!newName.trim()}
            >
              + ADD
            </button>
          </div>

          {/* ── Project list ───────────────────────────────── */}
          {projects.length === 0 ? (
            <p className="projects-empty">No projects yet. Create one above.</p>
          ) : (
            <ul className="projects-list">
              {projects.map((p) => (
                <li key={p.UUID} className="projects-item">
                  {editingId === p.UUID ? (
                    <input
                      className="projects-edit-input"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onBlur={() => commitEdit(p)}
                      onKeyDown={(e) => handleEditKeyDown(e, p)}
                      autoFocus
                    />
                  ) : (
                    <span
                      className="projects-item-name"
                      onClick={() => startEdit(p)}
                      title="Click to rename"
                    >
                      {p.name}
                    </span>
                  )}
                  <button
                    className="projects-delete-btn"
                    onClick={() => handleDelete(p)}
                    title="Delete project"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

        </div>

      </div>
    </div>
  );
});
