import { useContext, useEffect, useState, useCallback } from 'react';
import { AppContext } from '../../App';
import { STORES } from '../../utils/Constants';
import TreeGraph from '../../Components/TreeGraph/TreeGraph';
import NiceModal from '@ebay/nice-modal-react';
import UpgradePopup from '../../Modals/UpgradePopup/UpgradePopup';
import { v4 as uuid } from 'uuid';
import './Trees.css';

const FREE_TREE_LIMIT = 3;

function Trees() {
  const { databaseConnection: db, timestamp, refresh, hasAccess } = useContext(AppContext);

  const [trees,        setTrees]        = useState([]);
  const [selectedTree, setSelectedTree] = useState(null);
  const [treeNodes,    setTreeNodes]    = useState([]);
  const [newTreeName,  setNewTreeName]  = useState('');
  const [creating,     setCreating]     = useState(false);

  const loadTrees = useCallback(async () => {
    const player = await db.getOrCreatePlayer();
    if (!player) return;
    const roots = await db.getPlayerTrees(player.UUID);
    roots.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    setTrees(roots);
  }, [db, timestamp]);

  useEffect(() => { loadTrees(); }, [loadTrees]);

  const loadTreeNodes = useCallback(async () => {
    if (!selectedTree) { setTreeNodes([]); return; }
    const treeId = selectedTree.treeId || selectedTree.UUID;
    const nodes  = await db.getTreeNodes(treeId);
    setTreeNodes(nodes);
  }, [db, selectedTree, timestamp]);

  useEffect(() => { loadTreeNodes(); }, [loadTreeNodes]);

  const atFreeLimit = !hasAccess && trees.length >= FREE_TREE_LIMIT;

  const handleCreateTree = async () => {
    if (!newTreeName.trim()) return;

    if (atFreeLimit) {
      NiceModal.show(UpgradePopup);
      return;
    }

    const player = await db.getOrCreatePlayer();
    if (!player) return;

    const rootId = uuid();
    const root   = {
      UUID:              rootId,
      name:              newTreeName,
      isRoot:            true,
      isLabel:           false,
      treeId:            rootId,
      parentNodeId:      null,
      dueDate:           null,
      estimatedDuration: '',
      efficiency:        '',
      reasonToSelect:    '',
      completed:         false,
      createdAt:         new Date().toISOString(),
    };

    await db.add(STORES.todo, root);
    setNewTreeName('');
    setCreating(false);
    refresh();
    setSelectedTree(root);
  };

  const handleDeleteTree = async (tree) => {
    if (!window.confirm(`Delete tree "${tree.name}" and all its nodes?`)) return;
    const treeId = tree.treeId || tree.UUID;
    const nodes  = await db.getTreeNodes(treeId);
    for (const node of nodes) await db.remove(STORES.todo, node.UUID);
    if (selectedTree?.UUID === tree.UUID) setSelectedTree(null);
    refresh();
  };

  return (
    <div className="page trees-page">

      {/* Sidebar */}
      <div className="trees-sidebar">
        <div className="trees-sidebar-header">
          <span className="trees-sidebar-title">Trees</span>
          <button className="btn-ghost trees-new-btn" onClick={() => setCreating(v => !v)}>+</button>
        </div>

        {/* Free tier counter */}
        {!hasAccess && (
          <div className="trees-tier-bar">
            <span>{trees.length} / {FREE_TREE_LIMIT} trees used</span>
            {atFreeLimit && (
              <button
                className="trees-upgrade-link"
                onClick={() => NiceModal.show(UpgradePopup)}
              >
                Upgrade →
              </button>
            )}
          </div>
        )}

        {creating && (
          <div className="trees-create-form">
            {atFreeLimit ? (
              <p className="trees-limit-msg">
                Free plan limit reached.{' '}
              </p>
            ) : (
              <>
                <input
                  type="text"
                  placeholder="Tree name"
                  value={newTreeName}
                  onChange={e => setNewTreeName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleCreateTree()}
                  autoFocus
                />
                <div className="trees-create-actions">
                  <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
                  <button className="btn-primary" onClick={handleCreateTree}>Create</button>
                </div>
              </>
            )}
          </div>
        )}

        <div className="trees-list">
          {trees.length === 0 && !creating && (
            <p className="trees-empty-hint">No trees yet.<br/>Create one above.</p>
          )}
          {trees.map(tree => (
            <div
              key={tree.UUID}
              className={`trees-list-item ${selectedTree?.UUID === tree.UUID ? 'trees-list-item--active' : ''}`}
              onClick={() => setSelectedTree(tree)}
            >
              <span className="trees-list-name">{tree.name || 'Untitled'}</span>
              <button
                className="trees-list-delete btn-ghost"
                onClick={e => { e.stopPropagation(); handleDeleteTree(tree); }}
              >✕</button>
            </div>
          ))}
        </div>
      </div>

      {/* Graph */}
      <div className="trees-main">
        {!selectedTree ? (
          <div className="trees-no-selection">
            <p>Select a tree to view its graph.</p>
          </div>
        ) : (
          <>
            <div className="trees-graph-header">
              <span className="trees-graph-title">{selectedTree.name}</span>
              <span className="trees-graph-hint">click to select · double-click to edit · drag edge to reparent</span>
            </div>
            <TreeGraph
              key={selectedTree.UUID}
              tree={selectedTree}
              todos={treeNodes}
              db={db}
              onUpdate={() => { loadTreeNodes(); loadTrees(); refresh(); }}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default Trees;
