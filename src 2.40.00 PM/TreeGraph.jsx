import { useCallback, useEffect, useState } from 'react';
import ReactFlow, {
  Background, Controls, Handle, Position,
  useNodesState, useEdgesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import NiceModal from '@ebay/nice-modal-react';
import TaskCreationMenu from '../../Modals/TaskCreationMenu/TaskCreationMenu';
import { STORES } from '../../utils/Constants';
import './TreeGraph.css';

// ── Layout ────────────────────────────────────────────────────────────────
// Node width = measured from DOM after render; we estimate for layout.
const EST_W = 220;
const XGAP  = 60;   // horizontal gap between siblings
const YGAP  = 100;  // vertical gap between levels

function computeLayout(nodes, edges) {
  if (!nodes.length) return nodes;
  const root = nodes.find(n => n.data.isRoot);
  if (!root) return nodes.map((n, i) => ({ ...n, position: { x: i * (EST_W + XGAP), y: 0 } }));

  const children = {};
  nodes.forEach(n => { children[n.id] = []; });
  edges.forEach(e => { if (children[e.source]) children[e.source].push(e.target); });

  const depth = {}; const q = [root.id]; depth[root.id] = 0;
  while (q.length) {
    const id = q.shift();
    (children[id] || []).forEach(c => {
      if (depth[c] === undefined) { depth[c] = depth[id] + 1; q.push(c); }
    });
  }

  const byDepth = {};
  nodes.forEach(n => { const d = depth[n.id] ?? 99; (byDepth[d] || (byDepth[d] = [])).push(n.id); });

  const positions = {};
  Object.entries(byDepth).forEach(([d, ids]) => {
    const total = ids.length * EST_W + (ids.length - 1) * XGAP;
    ids.forEach((id, i) => {
      positions[id] = { x: i * (EST_W + XGAP) - total / 2 + EST_W / 2, y: +d * (80 + YGAP) };
    });
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
  return new Date(d + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ── Custom node ───────────────────────────────────────────────────────────
function CanopyNode({ data, selected }) {
  const cls = ['cnode',
    data.isRoot        ? 'cnode--root'        : '',
    data.isLabel       ? 'cnode--label'       : '',
    data.completed     ? 'cnode--completed'   : '',
    data.disconnected  ? 'cnode--disconnected': '',
    selected           ? 'cnode--selected'    : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cls}>
      {!data.isRoot && <Handle type="target" position={Position.Top} id="top" />}
      <div className="cnode-name">{data.label || 'Untitled'}</div>
      {!data.isLabel && (data.dueDate || data.estimatedDuration) && (
        <div className="cnode-meta">
          {data.dueDate           && <span className="cnode-date">{fmtDate(data.dueDate)}</span>}
          {data.estimatedDuration && <span className="cnode-dur">{data.estimatedDuration}m</span>}
        </div>
      )}
      {data.isLabel      && <div className="cnode-badge cnode-badge--label">label</div>}
      {data.completed    && <div className="cnode-badge cnode-badge--done">done</div>}
      {data.disconnected && <div className="cnode-badge cnode-badge--disc">disconnected</div>}
      <Handle type="source" position={Position.Bottom} id="bottom" />
    </div>
  );
}

const NODE_TYPES = { canopyNode: CanopyNode };

// ── TreeGraph ─────────────────────────────────────────────────────────────
function TreeGraph({ tree, todos, db, onUpdate }) {
  const [rfNodes, setRfNodes, onNodesChange] = useNodesState([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState([]);
  const [selId,   setSelId]   = useState(null);
  const [panel,   setPanel]   = useState(null);

  const buildGraph = useCallback(() => {
    if (!todos.length) return;
    const connected = buildConnectivitySet(todos);
    const nodes = todos.map(t => ({
      id:   t.UUID,
      type: 'canopyNode',
      data: {
        label:             t.name || 'Untitled',
        isRoot:            !!t.isRoot,
        isLabel:           !!t.isLabel,
        completed:         !!t.completed,
        disconnected:      !connected.has(t.UUID),
        dueDate:           t.dueDate,
        estimatedDuration: t.estimatedDuration,
        raw:               t,
      },
      position: { x: 0, y: 0 },
    }));
    const edges = todos
      .filter(t => t.parentNodeId && todos.find(p => p.UUID === t.parentNodeId))
      .map(t => ({
        id:     `e-${t.parentNodeId}-${t.UUID}`,
        source: t.parentNodeId, target: t.UUID, type: 'default',
        style:  { stroke: connected.has(t.UUID) ? 'var(--border2)' : 'rgba(150,150,150,0.25)', strokeWidth: 1.5 },
      }));
    setRfNodes(computeLayout(nodes, edges));
    setRfEdges(edges);
  }, [todos]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

  // Single click → select + show panel
  const onNodeClick = useCallback((_, node) => {
    setSelId(node.id);
    setPanel({ data: node.data.raw });
  }, []);

  // Double-click → open full TaskCreationMenu
  const onNodeDoubleClick = useCallback((_, node) => {
    NiceModal.show(TaskCreationMenu, {
      todoId:      node.id,
      parentNodeId: node.data.raw.parentNodeId,
      treeId:      node.data.raw.treeId,
    });
  }, []);

  const onPaneClick = useCallback(() => { setSelId(null); setPanel(null); }, []);

  const onEdgeUpdate = useCallback(async (oldEdge, newConn) => {
    const childId     = oldEdge.target;
    const newParentId = newConn.source;
    if (newParentId === childId) return;
    const todo = todos.find(t => t.UUID === childId);
    if (!todo || todo.isRoot) return;
    await db.add(STORES.todo, { ...todo, parentNodeId: newParentId });
    onUpdate();
  }, [todos, db, onUpdate]);

  const handleDelete = async (todo) => {
    if (todo.isRoot) return;
    await db.add(STORES.todo, { ...todo, parentNodeId: null });
    setPanel(null); setSelId(null); onUpdate();
  };

  const handleAddChildFull = (parentId) => {
    const parentTodo = todos.find(t => t.UUID === parentId);
    NiceModal.show(TaskCreationMenu, {
      parentNodeId: parentId,
      treeId: parentTodo?.treeId || tree.treeId || tree.UUID,
    });
  };

  const selected = panel?.data;

  return (
    <div className="tree-graph-wrap">
      <ReactFlow
        nodes={rfNodes} edges={rfEdges}
        onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onPaneClick={onPaneClick}
        onEdgeUpdate={onEdgeUpdate}
        edgeUpdaterRadius={12}
        nodeTypes={NODE_TYPES}
        fitView fitViewOptions={{ padding: 0.55 }} minZoom={0.2}
      >
        <Background color="var(--border)" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>

      {panel && selected && (
        <div className="tg-panel">
          <div className="tg-panel-header">
            <span className="tg-panel-title">{selected.name || 'Untitled'}</span>
            <button className="btn-ghost tg-panel-close" onClick={() => { setPanel(null); setSelId(null); }}>✕</button>
          </div>
          <NodePanel
            todo={selected}
            onDelete={handleDelete}
            onAddChild={handleAddChildFull}
            onOpenEdit={() => {
              NiceModal.show(TaskCreationMenu, {
                todoId:      selected.UUID,
                parentNodeId: selected.parentNodeId,
                treeId:      selected.treeId,
              });
            }}
            onSave={async updates => {
              const existing = todos.find(t => t.UUID === updates.UUID);
              if (!existing) return;
              await db.add(STORES.todo, { ...existing, ...updates });
              setPanel({ data: { ...existing, ...updates } });
              onUpdate();
            }}
          />
        </div>
      )}
    </div>
  );
}

// ── Node panel — no edit form, just info + actions ───────────────────────
function NodePanel({ todo, onDelete, onAddChild, onOpenEdit }) {
  return (
    <div className="tg-view">
      {!todo.isLabel && todo.dueDate && (
        <div className="tg-info-row">
          <span className="label-sm">due</span>
          <span className="tg-info-val">{todo.dueDate}</span>
        </div>
      )}
      {!todo.isLabel && todo.estimatedDuration && (
        <div className="tg-info-row">
          <span className="label-sm">duration</span>
          <span className="tg-info-val">{todo.estimatedDuration}m</span>
        </div>
      )}
      {todo.efficiency && (
        <div className="tg-info-row">
          <span className="label-sm">description</span>
          <span className="tg-info-val tg-info-desc">{todo.efficiency}</span>
        </div>
      )}
      <p className="tg-dblclick-hint">double-click node to edit</p>
      <div className="tg-view-actions">
        <button className="btn-ghost" onClick={onOpenEdit}>Edit</button>
        <button className="btn-ghost" onClick={() => onAddChild(todo.UUID)}>+ child</button>
        {!todo.isRoot && (
          <button className="btn-danger" onClick={() => onDelete(todo)}>Remove</button>
        )}
      </div>
    </div>
  );
}

export default TreeGraph;
