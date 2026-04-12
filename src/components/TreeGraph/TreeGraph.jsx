import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState
} from 'reactflow';
import 'reactflow/dist/style.css';
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu';
import { STORES } from '../../utils/Constants';
import { collectDescendants } from '../../utils/Helpers/Tasks';
import { v4 as uuid } from 'uuid';
import './TreeGraph.css';

const EST_W = 220;
const XGAP = 60;
const YGAP = 100;
const HIDE_DONE_KEY = 'canopy-hide-done';
const POS_SAVE_DELAY = 600;
const EDGE_SUPPRESS_MS = 280;

function computeLayout(nodes, edges) {
  if (!nodes.length) return nodes;
  const root = nodes.find(n => n.data.isRoot);
  if (!root) return nodes.map((n, i) => ({ ...n, position: { x: i * (EST_W + XGAP), y: 0 } }));

  const children = {};
  nodes.forEach(n => {
    children[n.id] = [];
  });
  edges.forEach(e => {
    if (children[e.source]) children[e.source].push(e.target);
  });

  const depth = {};
  const q = [root.id];
  depth[root.id] = 0;

  while (q.length) {
    const id = q.shift();
    (children[id] || []).forEach(c => {
      if (depth[c] === undefined) {
        depth[c] = depth[id] + 1;
        q.push(c);
      }
    });
  }

  const connected = nodes.filter(n => depth[n.id] !== undefined);
  const disconnected = nodes.filter(n => depth[n.id] === undefined);

  const byDepth = {};
  connected.forEach(n => {
    const d = depth[n.id];
    (byDepth[d] || (byDepth[d] = [])).push(n.id);
  });

  const positions = {};
  Object.entries(byDepth).forEach(([d, ids]) => {
    const total = ids.length * EST_W + (ids.length - 1) * XGAP;
    ids.forEach((id, i) => {
      positions[id] = {
        x: i * (EST_W + XGAP) - total / 2 + EST_W / 2,
        y: Number(d) * (80 + YGAP),
      };
    });
  });

  const maxDepth = connected.length ? Math.max(...connected.map(n => depth[n.id])) : 0;
  const orphanY = (maxDepth + 2) * (80 + YGAP);
  const orphanSpan = disconnected.length * EST_W + (disconnected.length - 1) * XGAP;
  disconnected.forEach((n, i) => {
    positions[n.id] = {
      x: i * (EST_W + XGAP) - orphanSpan / 2 + EST_W / 2,
      y: orphanY,
    };
  });

  return nodes.map(n => ({ ...n, position: positions[n.id] ?? { x: 0, y: 0 } }));
}

function buildConnectivitySet(todos) {
  const connected = new Set();
  const root = todos.find(t => t.isRoot);
  if (!root) return connected;

  function visit(id) {
    if (connected.has(id)) return;
    connected.add(id);
    todos.filter(t => t.parentNodeId === id).forEach(t => visit(t.UUID));
  }

  visit(root.UUID);
  return connected;
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(`${d}T00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function CanopyNode({ data, selected }) {
  const cls = [
    'cnode',
    data.isRoot ? 'cnode--root' : '',
    data.isLabel ? 'cnode--label' : '',
    data.completed ? 'cnode--completed' : '',
    data.disconnected ? 'cnode--disconnected' : '',
    selected ? 'cnode--selected' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cls}>
      {!data.isRoot && <Handle type="target" position={Position.Top} id="top" />}
      <div className="cnode-name">{data.label || 'Untitled'}</div>
      {!data.isLabel && (data.dueDate || data.estimatedDuration) && (
        <div className="cnode-meta">
          {data.dueDate && <span className="cnode-date">{fmtDate(data.dueDate)}</span>}
          {data.estimatedDuration && <span className="cnode-dur">{data.estimatedDuration}m</span>}
        </div>
      )}
      {data.isLabel && <div className="cnode-badge cnode-badge--label">label</div>}
      {data.completed && <div className="cnode-badge cnode-badge--done">done</div>}
      {data.disconnected && <div className="cnode-badge cnode-badge--disc">disconnected</div>}
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

function NoteNode({ data, selected }) {
  return (
    <div className={`cnode-note${selected ? ' cnode-note--selected' : ''}`}>
      {data.label ? <div className="cnode-note-title">{data.label}</div> : null}
      {data.body ? (
        <div className="cnode-note-body">{data.body}</div>
      ) : (
        !data.label && <div className="cnode-note-placeholder">Double-click to edit</div>
      )}
    </div>
  );
}

const NODE_TYPES = { canopyNode: CanopyNode, noteNode: NoteNode };

function ContextMenu({ x, y, onAddTask, onAddLabel, onAddNote, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    const h = e => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);

  const style = {
    position: 'fixed',
    top: Math.min(y, window.innerHeight - 140),
    left: Math.min(x, window.innerWidth - 180),
  };

  return (
    <div className="tg-context-menu" style={style} ref={ref}>
      <button className="tg-context-item" onClick={onAddTask}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="1" width="10" height="10" rx="2" />
        </svg>
        Add task
      </button>
      <button className="tg-context-item" onClick={onAddLabel}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <polygon points="6,1 11,3.5 11,8.5 6,11 1,8.5 1,3.5" />
        </svg>
        Add label
      </button>
      <div className="tg-context-divider" />
      <button className="tg-context-item" onClick={onAddNote}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="1" y="1" width="10" height="10" rx="1" />
          <line x1="3" y1="4" x2="9" y2="4" />
          <line x1="3" y1="6" x2="9" y2="6" />
          <line x1="3" y1="8" x2="6" y2="8" />
        </svg>
        Add sticky note
      </button>
    </div>
  );
}

function TreeGraph({ tree, todos, db, onUpdate }) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [selId, setSelId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const [hideDone, setHideDone] = useState(() => {
    try {
      return localStorage.getItem(HIDE_DONE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(HIDE_DONE_KEY, String(hideDone));
    } catch {}
  }, [hideDone]);

  const [shiftHeld, setShiftHeld] = useState(false);
  useEffect(() => {
    const dn = e => {
      if (e.key === 'Shift') setShiftHeld(true);
    };
    const up = e => {
      if (e.key === 'Shift') setShiftHeld(false);
    };
    window.addEventListener('keydown', dn);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', dn);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const savedPositions = useRef({});
  const posSaveTimers = useRef({});
  const connectingNodeId = useRef(null);
  const settingsRef = useRef(null);
  const rfInstance = useRef(null);

  const selected = selId ? todos.find(t => t.UUID === selId) ?? null : null;

  const visibleTodos = useMemo(() => {
    return hideDone ? todos.filter(t => !t.completed || t.isRoot) : todos;
  }, [hideDone, todos]);

  const buildGraph = useCallback(() => {
    if (!visibleTodos.length) {
      setRfNodes([]);
      setRfEdges([]);
      return;
    }

    visibleTodos.forEach(t => {
      if (t.posX != null && t.posY != null && savedPositions.current[t.UUID] == null) {
        savedPositions.current[t.UUID] = { x: t.posX, y: t.posY };
      }
    });

    const connSet = buildConnectivitySet(visibleTodos);

    const nodes = visibleTodos.map(t => ({
      id: t.UUID,
      type: t.isNote ? 'noteNode' : 'canopyNode',
      data: {
        label: t.name || '',
        body: t.isNote ? t.efficiency || '' : undefined,
        isRoot: !!t.isRoot,
        isLabel: !!t.isLabel,
        isNote: !!t.isNote,
        completed: !!t.completed,
        disconnected: !t.isNote && !connSet.has(t.UUID),
        dueDate: t.dueDate,
        estimatedDuration: t.estimatedDuration,
      },
      position: { x: 0, y: 0 },
      connectable: !t.isNote,
    }));

    const edges = visibleTodos
      .filter(
        t => !t.isNote && t.parentNodeId && visibleTodos.find(p => p.UUID === t.parentNodeId && !p.isNote),
      )
      .map(t => ({
        id: `e-${t.parentNodeId}-${t.UUID}`,
        source: t.parentNodeId,
        target: t.UUID,
        type: 'default',
        style: {
          stroke: connSet.has(t.UUID) ? 'var(--border2)' : 'rgba(150,150,150,0.25)',
          strokeWidth: 1.5,
        },
      }));

    const laidOut = computeLayout(nodes, edges);

    setRfNodes(
      laidOut.map(n => {
        if (savedPositions.current[n.id] == null) {
          savedPositions.current[n.id] = n.position;
        }
        return { ...n, position: savedPositions.current[n.id] };
      }),
    );
    setRfEdges(edges);
  }, [visibleTodos, setRfNodes, setRfEdges]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  const handleNodesChange = useCallback(
    changes => {
      onNodesChange(changes);
      for (const c of changes) {
        if (c.type === 'position' && c.position) {
          savedPositions.current[c.id] = c.position;

          if (posSaveTimers.current[c.id]) clearTimeout(posSaveTimers.current[c.id]);
          posSaveTimers.current[c.id] = setTimeout(async () => {
            const todo = todos.find(t => t.UUID === c.id);
            if (!todo) return;
            const pos = savedPositions.current[c.id];
            if (!pos) return;
            await db.add(STORES.todo, { ...todo, posX: pos.x, posY: pos.y });
          }, POS_SAVE_DELAY);
        }
      }
    },
    [onNodesChange, todos, db],
  );

  useEffect(() => {
    const timers = posSaveTimers.current;
    return () => Object.values(timers).forEach(clearTimeout);
  }, []);

  useEffect(() => {
    if (!showSettings) return;
    const h = e => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) setShowSettings(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showSettings]);


  const onNodeClick = useCallback((_, node) => {
    setSelId(node.id);
    setContextMenu(null);
  }, []);

  const onNodeDoubleClick = useCallback(
    (_, node) => {
      const todo = todos.find(t => t.UUID === node.id);
      NiceModal.show(TaskCreationMenu, {
        todoId: node.id,
        parentNodeId: todo?.parentNodeId,
        treeId: todo?.treeId,
      });
    },
    [todos],
  );

  const onPaneClick = useCallback(() => {
    setSelId(null);
    setShowSettings(false);
    setContextMenu(null);
  }, []);

  const onPaneContextMenu = useCallback(event => {
    event.preventDefault();
    if (!rfInstance.current) return;
    const project = rfInstance.current.screenToFlowPosition ?? rfInstance.current.project;
    const flowPos = project({ x: event.clientX, y: event.clientY });
    setContextMenu({
      screenX: event.clientX,
      screenY: event.clientY,
      flowX: flowPos.x,
      flowY: flowPos.y,
    });
  }, []);

  const onNodeContextMenu = useCallback(event => {
    event.preventDefault();
  }, []);

  const createNodeAt = useCallback(
    async (flowX, flowY, opts = {}) => {
      setContextMenu(null);
      const newId = uuid();
      const newTodo = {
        UUID: newId,
        name: '',
        efficiency: '',
        estimatedDuration: '',
        dueDate: null,
        isLabel: opts.isLabel ?? false,
        isNote: opts.isNote ?? false,
        isRoot: false,
        completed: false,
        completedAt: null,
        parentNodeId: null,
        treeId: tree.treeId || tree.UUID,
        createdAt: new Date().toISOString(),
        posX: flowX,
        posY: flowY,
      };

      savedPositions.current[newId] = { x: flowX, y: flowY };
      await db.add(STORES.todo, newTodo);
      if (onUpdate) onUpdate();
      NiceModal.show(TaskCreationMenu, { todoId: newId, treeId: newTodo.treeId });
    },
    [tree, db, onUpdate],
  );





  const onConnect = useCallback(
    async connection => {
      const { source, target } = connection;
      if (!source || !target || source === target) return;

      const targetTodo = todos.find(t => t.UUID === target);
      if (!targetTodo || targetTodo.isRoot) return;

      const connSet = buildConnectivitySet(todos);
      if (connSet.has(target)) return;

      const sourceDescendants = collectDescendants(todos, source);
      if (sourceDescendants.includes(target)) return;

      await db.add(STORES.todo, { ...targetTodo, parentNodeId: source });
    },
    [todos, db],
  );

  const onConnectStart = useCallback((_, params = {}) => {
    if (params?.handleType && params.handleType !== 'source') return;
    connectingNodeId.current = params.nodeId ?? null;
  }, []);

  const onConnectEnd = useCallback(
    async event => {
      const sourceId = connectingNodeId.current;
      connectingNodeId.current = null;
      if (!sourceId) return;

      const t = event.target;
      const onPane =
        t.classList.contains('react-flow__pane') ||
        t.classList.contains('react-flow__background') ||
        !!t.closest?.('.react-flow__pane');

      if (onPane && rfInstance.current) {
        const project = rfInstance.current.screenToFlowPosition ?? rfInstance.current.project;
        const flowPos = project({ x: event.clientX, y: event.clientY });
        const newId = uuid();
        const parentTodo = todos.find(x => x.UUID === sourceId);
        const treeId = parentTodo?.treeId || tree.treeId || tree.UUID;

        savedPositions.current[newId] = { x: flowPos.x, y: flowPos.y };

        await db.add(STORES.todo, {
          UUID: newId,
          name: '',
          efficiency: '',
          estimatedDuration: '',
          dueDate: null,
          isLabel: false,
          isNote: false,
          isRoot: false,
          completed: false,
          completedAt: null,
          parentNodeId: sourceId,
          treeId,
          createdAt: new Date().toISOString(),
          posX: flowPos.x,
          posY: flowPos.y,
        });
        if (onUpdate) onUpdate();
        NiceModal.show(TaskCreationMenu, { todoId: newId, treeId });
      }
    },
    [todos, tree, db, onUpdate],
  );

  const handleDelete = async todo => {
    if (todo.isRoot) return;
    const idsToDelete = collectDescendants(todos, todo.UUID);
    for (const id of idsToDelete) {
      await db.remove(STORES.todo, id);
      delete savedPositions.current[id];
    }
    setSelId(null);
    if (onUpdate) onUpdate();
  };

  const handleAddChildFull = parentId => {
    const parentTodo = todos.find(t => t.UUID === parentId);
    NiceModal.show(TaskCreationMenu, {
      parentNodeId: parentId,
      treeId: parentTodo?.treeId || tree.treeId || tree.UUID,
    });
  };

  return (
    <div className="tree-graph-wrap">
      <div className="tg-settings-anchor" ref={settingsRef}>
        <button
          className={`btn-ghost tg-settings-btn${showSettings ? ' tg-settings-btn--active' : ''}`}
          onClick={e => {
            e.stopPropagation();
            setShowSettings(v => !v);
          }}
          title="Graph settings"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
        {showSettings && (
          <div className="tg-settings-popup">
            <p className="tg-settings-heading">Graph settings</p>
            <label className="tg-settings-row">
              <input type="checkbox" checked={hideDone} onChange={e => setHideDone(e.target.checked)} />
              <span>Hide completed tasks</span>
            </label>
          </div>
        )}
      </div>

      <ReactFlow
        nodes={rfNodes}
        edges={rfEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onPaneContextMenu={onPaneContextMenu}
        onNodeContextMenu={onNodeContextMenu}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onConnect={onConnect}
        onInit={inst => {
          rfInstance.current = inst;
        }}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.55 }}
        minZoom={0.2}
        selectionOnDrag={shiftHeld}
        panOnDrag={!shiftHeld}
        selectionMode="partial"
        multiSelectionKeyCode="Shift"
      >
        <Background variant={BackgroundVariant.Dots} color="var(--border2)" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.screenX}
          y={contextMenu.screenY}
          onAddTask={() => createNodeAt(contextMenu.flowX, contextMenu.flowY, {})}
          onAddLabel={() => createNodeAt(contextMenu.flowX, contextMenu.flowY, { isLabel: true })}
          onAddNote={() => createNodeAt(contextMenu.flowX, contextMenu.flowY, { isNote: true })}
          onClose={() => setContextMenu(null)}
        />
      )}

      {selected && (
        <div className="tg-panel">
          <div className="tg-panel-header">
            <span className="tg-panel-title">{selected.name || (selected.isNote ? 'Note' : 'Untitled')}</span>
            <button className="btn-ghost tg-panel-close" onClick={() => setSelId(null)}>
              ✕
            </button>
          </div>
          <NodePanel
            todo={selected}
            onDelete={handleDelete}
            onAddChild={handleAddChildFull}
            onOpenEdit={() =>
              NiceModal.show(TaskCreationMenu, {
                todoId: selected.UUID,
                parentNodeId: selected.parentNodeId,
                treeId: selected.treeId,
              })
            }
          />
        </div>
      )}
    </div>
  );
}

function NodePanel({ todo, onDelete, onAddChild, onOpenEdit }) {
  return (
    <div className="tg-view">
      {todo.isNote && todo.efficiency && (
        <div className="tg-info-row">
          <span className="label-sm">content</span>
          <span className="tg-info-val tg-info-desc">{todo.efficiency}</span>
        </div>
      )}
      {!todo.isNote && !todo.isLabel && todo.dueDate && (
        <div className="tg-info-row">
          <span className="label-sm">due</span>
          <span className="tg-info-val">{todo.dueDate}</span>
        </div>
      )}
      {!todo.isNote && !todo.isLabel && todo.estimatedDuration && (
        <div className="tg-info-row">
          <span className="label-sm">duration</span>
          <span className="tg-info-val">{todo.estimatedDuration}m</span>
        </div>
      )}
      {!todo.isNote && todo.efficiency && (
        <div className="tg-info-row">
          <span className="label-sm">description</span>
          <span className="tg-info-val tg-info-desc">{todo.efficiency}</span>
        </div>
      )}
      <p className="tg-dblclick-hint">
        {todo.isNote
          ? 'Double-click to edit · drag to reposition'
          : 'Double-click to edit · drag ● to create child'}
      </p>
      <div className="tg-view-actions">
        <button className="btn-ghost" onClick={onOpenEdit}>
          Edit
        </button>
        {!todo.isNote && (
          <button className="btn-ghost" onClick={() => onAddChild(todo.UUID)}>
            + child
          </button>
        )}
        {!todo.isRoot && (
          <button className="btn-danger" onClick={() => onDelete(todo)}>
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

export default TreeGraph;
