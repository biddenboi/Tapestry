import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppContext } from '../../App';
import { STORES } from '../../utils/Constants';
import TreeGraph from '../../Components/TreeGraph/TreeGraph';
import NiceModal from '@ebay/nice-modal-react';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { v4 as uuid } from 'uuid';
import './Trees.css';

const FREE_TREE_LIMIT = 5;
const DEFAULT_SIDEBAR = 220;
const MIN_SIDEBAR     = 160;
const MAX_SIDEBAR     = 420;

function loadFolders()     { try { return JSON.parse(localStorage.getItem('canopy-folders')       || '[]');  } catch { return []; } }
function loadTreeFolders() { try { return JSON.parse(localStorage.getItem('canopy-tree-folders')  || '{}');  } catch { return {}; } }

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 4C1.5 3.17 2.17 2.5 3 2.5h2.25L6.75 4H10C10.83 4 11.5 4.67 11.5 5.5v4.5c0 .83-.67 1.5-1.5 1.5H3C2.17 11.5 1.5 10.83 1.5 10V4z"/>
    </svg>
  );
}

function Trees() {
  const { databaseConnection: db, hasAccess, trees, getTreeNodes, cacheReady } = useContext(AppContext);

  const [selectedTree, setSelectedTree] = useState(null);
  const [newTreeName,  setNewTreeName]  = useState('');
  const [creating,     setCreating]     = useState(false);

  // ── Resizable sidebar — use refs for drag so React never re-renders during mousemove ──
  const [sidebarOpen,  setSidebarOpen]  = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR);
  const sidebarRef = useRef(null);
  const widthRef   = useRef(DEFAULT_SIDEBAR);

  // Keep widthRef in sync when state changes from non-drag sources
  useEffect(() => { widthRef.current = sidebarWidth; }, [sidebarWidth]);

  const handleResizeStart = useCallback((e) => {
    e.preventDefault();
    const startX     = e.clientX;
    const startWidth = widthRef.current;

    const onMove = (ev) => {
      const w = Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startWidth + ev.clientX - startX));
      widthRef.current = w;
      // Directly mutate the DOM — zero React re-renders during drag
      if (sidebarRef.current) sidebarRef.current.style.width = `${w}px`;
    };

    const onUp = () => {
      // Single state update + re-render only on release
      setSidebarWidth(widthRef.current);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  }, []); // stable — uses only refs

  // ── Folder state ────────────────────────────────────────────────────────
  const [folders,         setFolders]         = useState(loadFolders);
  const [treeFolders,     setTreeFolders]     = useState(loadTreeFolders);
  const [expandedFolders, setExpandedFolders] = useState(() => new Set());
  const [creatingFolder,  setCreatingFolder]  = useState(false);
  const [newFolderName,   setNewFolderName]   = useState('');

  // ── Drag-to-folder ──────────────────────────────────────────────────────
  const [draggingTreeId, setDraggingTreeId] = useState(null);
  const [dragOverTarget, setDragOverTarget] = useState(null);

  useEffect(() => { localStorage.setItem('canopy-folders',      JSON.stringify(folders));      }, [folders]);
  useEffect(() => { localStorage.setItem('canopy-tree-folders', JSON.stringify(treeFolders)); }, [treeFolders]);

  const treeNodes = useMemo(() => {
    if (!selectedTree) return [];
    return getTreeNodes(selectedTree.treeId || selectedTree.UUID);
  }, [selectedTree, getTreeNodes]);

  useEffect(() => {
    if (!selectedTree && trees.length > 0) { setSelectedTree(trees[0]); return; }
    if (!selectedTree) return;
    const updated = trees.find(t => t.UUID === selectedTree.UUID);
    if (!updated) setSelectedTree(null);
    else if (updated !== selectedTree) setSelectedTree(updated);
  }, [trees, selectedTree]);

  const treesByFolder = useMemo(() => {
    const map = {};
    folders.forEach(f => { map[f.UUID] = []; });
    const uncategorized = [];
    trees.forEach(t => {
      const fid = treeFolders[t.UUID];
      if (fid && map[fid]) map[fid].push(t);
      else uncategorized.push(t);
    });
    return { map, uncategorized };
  }, [trees, folders, treeFolders]);

  const atFreeLimit = !hasAccess && trees.length >= FREE_TREE_LIMIT;

  const handleCreateTree = async () => {
    if (!newTreeName.trim()) return;
    if (atFreeLimit) { NiceModal.show(UpgradePopup); return; }
    const rootId = uuid();
    const root   = {
      UUID: rootId, name: newTreeName, isRoot: true, isLabel: false,
      treeId: rootId, parentNodeId: null, dueDate: null,
      estimatedDuration: '', efficiency: '', reasonToSelect: '',
      completed: false, createdAt: new Date().toISOString(),
    };
    await db.add(STORES.todo, root);
    setNewTreeName(''); setCreating(false); setSelectedTree(root);
  };

  const handleDeleteTree = async (tree) => {
    if (!window.confirm(`Delete tree "${tree.name}" and all its nodes?`)) return;
    const nodes = getTreeNodes(tree.treeId || tree.UUID);
    for (const node of nodes) await db.remove(STORES.todo, node.UUID);
    setTreeFolders(prev => { const next = { ...prev }; delete next[tree.UUID]; return next; });
    if (selectedTree?.UUID === tree.UUID) setSelectedTree(null);
  };

  const handleCreateFolder = () => {
    if (!newFolderName.trim()) return;
    const folder = { UUID: uuid(), name: newFolderName.trim() };
    setFolders(prev => [...prev, folder]);
    setExpandedFolders(prev => new Set([...prev, folder.UUID]));
    setNewFolderName(''); setCreatingFolder(false);
  };

  const handleDeleteFolder = (folderId) => {
    if (!window.confirm('Delete this folder? Trees inside will move to Uncategorized.')) return;
    setFolders(prev => prev.filter(f => f.UUID !== folderId));
    setTreeFolders(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(id => { if (next[id] === folderId) delete next[id]; });
      return next;
    });
  };

  const toggleFolder = (folderId) => {
    setExpandedFolders(prev => {
      const next = new Set(prev);
      next.has(folderId) ? next.delete(folderId) : next.add(folderId);
      return next;
    });
  };

  const onDragStart = (e, treeId) => { setDraggingTreeId(treeId); e.dataTransfer.effectAllowed = 'move'; };
  const onDragEnd   = ()           => { setDraggingTreeId(null);   setDragOverTarget(null); };
  const onDragOver  = (e, target)  => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverTarget(target); };
  const onDragLeave = ()           => setDragOverTarget(null);
  const onDrop      = (e, targetFolderId) => {
    e.preventDefault();
    if (!draggingTreeId) return;
    setTreeFolders(prev => {
      const next = { ...prev };
      if (targetFolderId === '__uncategorized__') delete next[draggingTreeId];
      else next[draggingTreeId] = targetFolderId;
      return next;
    });
    if (targetFolderId !== '__uncategorized__') {
      setExpandedFolders(prev => new Set([...prev, targetFolderId]));
    }
    setDraggingTreeId(null); setDragOverTarget(null);
  };

  const TreeItem = ({ tree }) => (
    <div
      className={[
        'trees-list-item',
        selectedTree?.UUID === tree.UUID ? 'trees-list-item--active'   : '',
        draggingTreeId === tree.UUID     ? 'trees-list-item--dragging' : '',
      ].filter(Boolean).join(' ')}
      onClick={() => setSelectedTree(tree)}
      draggable
      onDragStart={e => onDragStart(e, tree.UUID)}
      onDragEnd={onDragEnd}
    >
      <span className={`trees-list-name${tree.completed ? ' trees-list-name--done' : ''}`}>
        {tree.name || 'Untitled'}
      </span>
      <button
        className="trees-list-delete btn-ghost"
        onClick={e => { e.stopPropagation(); handleDeleteTree(tree); }}
      >✕</button>
    </div>
  );

  if (!cacheReady) {
    return <div className="page trees-page"><div className="trees-no-selection"><p>Loading trees…</p></div></div>;
  }


  return (
    <div className="page trees-page">

      {/* ── Sidebar ── */}
      <div
        ref={sidebarRef}
        className={`trees-sidebar${sidebarOpen ? '' : ' trees-sidebar--collapsed'}`}
        style={sidebarOpen ? { width: sidebarWidth } : undefined}
      >
        {sidebarOpen && (
          <>
            <div className="trees-sidebar-header">
              <span className="trees-sidebar-title">Trees</span>
              <div className="trees-sidebar-actions">
                <button
                  className={`btn-ghost trees-folder-btn${creatingFolder ? ' trees-folder-btn--active' : ''}`}
                  onClick={() => { setCreatingFolder(v => !v); setCreating(false); }}
                  title="New folder"
                ><FolderIcon /></button>
                <button
                  className="btn-ghost trees-new-btn"
                  onClick={() => { setCreating(v => !v); setCreatingFolder(false); }}
                  title="New tree"
                >+</button>
              </div>
            </div>

            {!hasAccess && (
              <div className="trees-tier-bar">
                <span>{trees.length} / {FREE_TREE_LIMIT} trees used</span>
                {atFreeLimit && (
                  <button className="trees-upgrade-link" onClick={() => NiceModal.show(UpgradePopup)}>Upgrade →</button>
                )}
              </div>
            )}

            {creating && (
              <div className="trees-create-form">
                {atFreeLimit ? (
                  <p className="trees-limit-msg">Free plan limit reached.{' '}
                    <span className="trees-upgrade-link" onClick={() => NiceModal.show(UpgradePopup)}>Unlock more →</span>
                  </p>
                ) : (
                  <>
                    <input type="text" placeholder="Tree name" value={newTreeName}
                      onChange={e => setNewTreeName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleCreateTree(); if (e.key === 'Escape') setCreating(false); }}
                      autoFocus />
                    <div className="trees-create-actions">
                      <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                      <button className="btn-primary" onClick={handleCreateTree}>Create</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {creatingFolder && (
              <div className="trees-create-form">
                <input type="text" placeholder="Folder name" value={newFolderName}
                  onChange={e => setNewFolderName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateFolder(); if (e.key === 'Escape') setCreatingFolder(false); }}
                  autoFocus />
                <div className="trees-create-actions">
                  <button className="btn-ghost" onClick={() => setCreatingFolder(false)}>Cancel</button>
                  <button className="btn-primary" onClick={handleCreateFolder}>Create</button>
                </div>
              </div>
            )}

            <div className="trees-list">
              {trees.length === 0 && !creating && (
                <p className="trees-empty-hint">No trees yet.<br/>Click + to create one.</p>
              )}

              {folders.map(folder => {
                const folderTrees = treesByFolder.map[folder.UUID] || [];
                const isExpanded  = expandedFolders.has(folder.UUID);
                const isDragOver  = dragOverTarget === folder.UUID;
                return (
                  <div key={folder.UUID} className="trees-folder">
                    <div
                      className={`trees-folder-header${isDragOver ? ' trees-folder-header--dragover' : ''}`}
                      onClick={() => toggleFolder(folder.UUID)}
                      onDragOver={e => onDragOver(e, folder.UUID)}
                      onDragLeave={onDragLeave}
                      onDrop={e => onDrop(e, folder.UUID)}
                    >
                      <span className="trees-folder-arrow">{isExpanded ? '▾' : '›'}</span>
                      <span className="trees-folder-name">{folder.name}</span>
                      <span className="trees-folder-count">{folderTrees.length}</span>
                      <button className="trees-folder-delete btn-ghost"
                        onClick={e => { e.stopPropagation(); handleDeleteFolder(folder.UUID); }}
                        title="Delete folder">✕</button>
                    </div>
                    {isExpanded && (
                      <div className="trees-folder-children">
                        {folderTrees.length === 0
                          ? <p className="trees-folder-empty">Drop trees here</p>
                          : folderTrees.map(tree => <div key={tree.UUID} className="trees-folder-item"><TreeItem tree={tree} /></div>)
                        }
                      </div>
                    )}
                  </div>
                );
              })}

              {treesByFolder.uncategorized.length > 0 && (
                <div
                  className={`trees-uncategorized${dragOverTarget === '__uncategorized__' ? ' trees-uncategorized--dragover' : ''}`}
                  onDragOver={e => onDragOver(e, '__uncategorized__')}
                  onDragLeave={onDragLeave}
                  onDrop={e => onDrop(e, '__uncategorized__')}
                >
                  {folders.length > 0 && <p className="trees-section-label">Uncategorized</p>}
                  {treesByFolder.uncategorized.map(tree => <TreeItem key={tree.UUID} tree={tree} />)}
                </div>
              )}
            </div>
          </>
        )}
        {sidebarOpen && <div className="trees-resize-handle" onMouseDown={handleResizeStart} />}
      </div>

      {/* ── Toggle tab — zero-width flex child so it sits exactly on the border ── */}
      <div className="trees-toggle-col">
        <button
          className="trees-toggle-tab"
          onClick={() => setSidebarOpen(v => !v)}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? '‹' : '›'}
        </button>
      </div>

      {/* ── Main graph area ── */}
      <div className="trees-main">
        {!selectedTree ? (
          <div className="trees-no-selection"><p>Select a tree to view its graph.</p></div>
        ) : (
          <>
            <div className="trees-graph-header">
              <span className="trees-graph-title">{selectedTree.name}</span>
              <span className="trees-graph-hint">click · double-click to edit · drag ● to create child · shift-drag to lasso-select</span>
            </div>
            <TreeGraph key={selectedTree.UUID} tree={selectedTree} todos={treeNodes} db={db} onUpdate={() => {}} />
          </>
        )}
      </div>
    </div>
  );
}

export default Trees;