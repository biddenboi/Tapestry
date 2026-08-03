import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTRIBUTION_ROAD_NODES,
  ROAD_BRANCHES,
  ROAD_CHAPTERS,
} from '@domain/contribution-road/ContributionRoadCatalog.js';
import { describeRoadGate } from '@domain/contribution-road/RoadGatePresentation.js';
import ContributionIcon from '@shared/icons/ContributionIcon.jsx';
import './RecognitionBoardV2.css';

const CHAPTER_WIDTH = 620;
const BOARD_PAD_X = 300;
const BOARD_HEIGHT = 820;
const FOCUS_LABEL_GUTTER = 190;
const BRANCH_Y = Object.freeze({ compass: 340, forge: 470, chronicle: 600, fellowship: 730 });
const NODE_RADIUS = Object.freeze({ capstone: 56, stat: 31, achievement: 35, 'interface-reveal': 26, capability: 34, 'classic-reward': 30, 'chapter-seal': 54, secret: 30 });
const STAT_SYMBOLS = Object.freeze({
  'goal-reviews': '↻', 'milestones-completed': '⚑', 'goals-completed': '◎',
  'tasks-completed': '✓', 'focus-minutes': '◷', 'rhythm-completions': '≈', 'dojo-advances': '»',
  'substantive-entries': '¶', 'story-additions': '＋', 'retrospective-actions': '↶',
  'matches-completed': '⚔', 'pair-matches': 'Ⅱ', 'shared-work-responses': '↔',
});

function chapterX(chapterId) {
  return BOARD_PAD_X + Math.max(0, ROAD_CHAPTERS.findIndex((chapter) => chapter.id === chapterId)) * CHAPTER_WIDTH;
}

function positionNodes(nodes) {
  const positions = new Map();
  positions.set('trailhead', { x: chapterX('trailhead'), y: 535 });

  for (const chapter of ROAD_CHAPTERS) {
    const centerX = chapterX(chapter.id);
    const chapterNodes = nodes.filter((node) => node.chapterId === chapter.id && node.id !== 'trailhead');
    const rewards = chapterNodes.filter((node) => node.kind === 'classic-reward');
    const rewardColumns = Math.max(1, Math.ceil(rewards.length / 2));
    rewards.forEach((node, index) => {
      const column = Math.floor(index / 2);
      const row = index % 2;
      positions.set(node.id, {
        x: centerX + (column - (rewardColumns - 1) / 2) * 88,
        y: 126 + row * 76,
      });
    });
    const capabilities = chapterNodes.filter((node) => node.kind === 'capability');
    capabilities.forEach((node) => positions.set(node.id, { x: centerX, y: 54 }));
    const reveals = chapterNodes.filter((node) => node.kind === 'interface-reveal');
    reveals.forEach((node, index) => positions.set(node.id, {
      x: centerX - 155 + (index % 5) * 78,
      y: 274 + Math.floor(index / 5) * 48,
    }));

    for (const branch of ROAD_BRANCHES) {
      const laneY = BRANCH_Y[branch.id];
      const capstone = chapterNodes.find((node) => node.kind === 'capstone' && node.branchId === branch.id);
      if (capstone) positions.set(capstone.id, { x: centerX + 180, y: laneY });
      const achievements = chapterNodes.filter((node) => node.kind === 'achievement' && node.branchId === branch.id);
      achievements.forEach((node, index) => positions.set(node.id, { x: centerX - 250, y: laneY + (index - (achievements.length - 1) / 2) * 76 }));
      const stats = chapterNodes.filter((node) => node.kind === 'stat' && node.branchId === branch.id);
      stats.forEach((node, index) => positions.set(node.id, {
        x: centerX - 55 + (index - (stats.length - 1) / 2) * 72,
        y: laneY,
      }));
      const secrets = chapterNodes.filter((node) => node.kind === 'secret' && node.branchId === branch.id);
      secrets.forEach((node, index) => positions.set(node.id, { x: centerX + 270, y: laneY + index * 74 }));
    }
  }
  return positions;
}

function nodeSymbol(node) {
  if (node.kind === 'stat') return STAT_SYMBOLS[node.gate?.stat] || '◉';
  return { achievement: '◆', 'interface-reveal': '✦', capability: '⬢', 'classic-reward': '▣', 'chapter-seal': '✦', secret: '?', capstone: '◇' }[node.kind] || '•';
}

function nearestNode(currentId, direction, nodes, positions) {
  const origin = positions.get(currentId);
  if (!origin) return null;
  const vector = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[direction];
  if (!vector) return null;
  return nodes
    .map((node) => ({ node, point: positions.get(node.id) }))
    .filter(({ node, point }) => node.id !== currentId && point)
    .map((candidate) => {
      const dx = candidate.point.x - origin.x;
      const dy = candidate.point.y - origin.y;
      const forward = dx * vector[0] + dy * vector[1];
      const sideways = Math.abs(dx * vector[1] - dy * vector[0]);
      return { ...candidate, forward, score: forward + sideways * 1.75 };
    })
    .filter((candidate) => candidate.forward > 8)
    .sort((a, b) => a.score - b.score)[0]?.node || null;
}

function BoardConnections({ nodes, positions }) {
  const capstones = nodes.filter((node) => node.kind === 'capstone');
  const details = nodes.filter((node) => ['stat', 'achievement'].includes(node.kind));
  const evidenceChains = ROAD_CHAPTERS.flatMap((chapter) => ROAD_BRANCHES.flatMap((branch) => {
    const capstone = capstones.find((node) => node.chapterId === chapter.id && node.branchId === branch.id);
    if (!capstone) return [];
    const supporting = details
      .filter((node) => node.chapterId === chapter.id && node.branchId === branch.id)
      .sort((left, right) => {
        const leftPoint = positions.get(left.id);
        const rightPoint = positions.get(right.id);
        return (leftPoint?.x || 0) - (rightPoint?.x || 0) || (leftPoint?.y || 0) - (rightPoint?.y || 0);
      });
    return supporting.map((node, index) => ({
      node,
      next: supporting[index + 1] || capstone,
      branch,
    }));
  }));
  return (
    <svg className="recognition-v2__connections" viewBox={`0 0 ${BOARD_PAD_X * 2 + (ROAD_CHAPTERS.length - 1) * CHAPTER_WIDTH} ${BOARD_HEIGHT}`} aria-hidden="true">
      {ROAD_BRANCHES.flatMap((branch) => {
        const laneNodes = capstones.filter((node) => node.branchId === branch.id).sort((a, b) => chapterX(a.chapterId) - chapterX(b.chapterId));
        const origin = positions.get('trailhead');
        return laneNodes.map((node, index) => {
          const start = index === 0 ? origin : positions.get(laneNodes[index - 1].id);
          const end = positions.get(node.id);
          const sr = NODE_RADIUS[index === 0 ? 'chapter-seal' : 'capstone'];
          const er = NODE_RADIUS.capstone;
          return <path key={`${branch.id}:${node.id}`} className={['claimed', 'eligible'].includes(node.state) ? 'is-active' : ''} style={{ '--branch-color': branch.color }} d={`M ${start.x + sr} ${start.y} C ${start.x + 175} ${start.y}, ${end.x - 175} ${end.y}, ${end.x - er} ${end.y}`} />;
        });
      })}
      {evidenceChains.map(({ node, next, branch }) => {
        const point = positions.get(node.id);
        const target = positions.get(next.id);
        if (!point || !target) return null;
        const startX = point.x + (NODE_RADIUS[node.kind] || 30);
        const endX = target.x - (NODE_RADIUS[next.kind] || 30);
        const curve = Math.max(24, Math.min(70, (endX - startX) / 2));
        return <path key={`detail:${node.id}`} className="is-evidence" style={{ '--branch-color': branch.color }} d={`M ${startX} ${point.y} C ${startX + curve} ${point.y}, ${endX - curve} ${target.y}, ${endX} ${target.y}`} />;
      })}
    </svg>
  );
}

function BoardNode({ node, point, selected, focused, currentChapter, onFocus, onInspect, onToggle, onClaim, onKeyDown, buttonRef }) {
  if (!point || node.state === 'hidden') return null;
  const progress = node.kind === 'stat' ? Math.min(1, Number(node.gateResult?.current || 0) / Math.max(1, Number(node.gateResult?.target || 1))) : 0;
  const branch = ROAD_BRANCHES.find((entry) => entry.id === node.branchId);
  const compactCount = node.kind === 'stat' ? Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(node.gateResult?.current || 0)) : '';
  const fullLabel = `${node.label}. ${describeRoadGate(node.gateResult)}. ${node.state}.`;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`recognition-node recognition-node--${node.kind} is-${node.state} ${currentChapter ? 'is-current-chapter' : ''} ${selected ? 'is-selected' : ''}`}
      style={{ left: point.x, top: point.y, '--branch-color': branch?.color || '#e4bd55', '--dial': `${progress * 360}deg` }}
      tabIndex={focused ? 0 : -1}
      aria-label={fullLabel}
      aria-pressed={node.kind === 'capstone' ? selected : undefined}
      data-tooltip={node.label}
      onFocus={() => onFocus(node.id)}
      onKeyDown={(event) => onKeyDown(event, node)}
      onClick={(event) => {
        event.stopPropagation();
        onInspect(node);
        if (node.kind === 'capstone' && !['claimed', 'excluded'].includes(node.state)) onToggle(node);
        if (node.kind === 'classic-reward' && node.state === 'eligible') onClaim(node);
      }}
    >
      <i aria-hidden="true">{nodeSymbol(node)}</i>
      {node.kind === 'stat' && <small aria-hidden="true">{compactCount}</small>}
      {node.kind === 'capstone' && <span>{node.label}<small>{node.cost} each</small></span>}
      {node.kind === 'chapter-seal' && <span>{node.label}</span>}
    </button>
  );
}

function BoardInspector({ node, onClose, onClaim, claiming }) {
  if (!node) return null;
  return (
    <aside className="recognition-v2__inspector" aria-label="Road node details">
      <header><div><span>{node.kind.replaceAll('-', ' ')}</span><h2>{node.label}</h2></div><button type="button" onClick={onClose} aria-label="Close node details">×</button></header>
      <div className="recognition-v2__inspector-scroll">
        <p>{node.description || 'A permanent record on your Contribution Road.'}</p>
        <section><span>REQUIREMENT</span><strong>{describeRoadGate(node.gateResult)}</strong><div className="recognition-v2__meter"><i style={{ width: `${Math.min(100, Number(node.gateResult?.current || 0) / Math.max(1, Number(node.gateResult?.target || 1)) * 100)}%` }} /></div></section>
        {node.gateResult?.alternatives?.length > 0 && <section><span>REQUIRED ROUTES</span>{node.gateResult.alternatives.map((gate, index) => <div className={gate.passed ? 'is-complete' : ''} key={`${gate.kind}:${index}`}><i>{gate.passed ? '✓' : '○'}</i><b>{describeRoadGate(gate)}</b></div>)}</section>}
        {node.cost > 0 && <section><span>CHAPTER COST</span><strong><ContributionIcon size={16} /> {node.cost} Contribution</strong><p>Charged only when two paths commit together.</p></section>}
        {(node.rewards || []).length > 0 && <section><span>REWARDS</span>{node.rewards.map((reward) => <div key={reward.id}><b>{reward.label}</b><small>{reward.type.replaceAll('_', ' ')}</small></div>)}</section>}
        {node.kind === 'classic-reward' && node.state === 'eligible' && <button className="recognition-v2__claim" type="button" onClick={() => onClaim(node)} disabled={claiming}>{claiming ? 'Claiming…' : 'Claim free classic reward'}</button>}
        {node.kind === 'classic-reward' && node.state === 'claimed' && <p className="recognition-v2__owned">✓ Classic reward owned</p>}
        {node.excluded && <p className="recognition-v2__warning">This signature path was excluded by the permanent chapter choice.</p>}
      </div>
    </aside>
  );
}

export default function RecognitionBoardV2({ progress, selections, setSelections, onCommit, committing, onClaimClassic, claimingClassic }) {
  const viewportRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const dragRef = useRef(null);
  const positions = useMemo(() => positionNodes(CONTRIBUTION_ROAD_NODES), []);
  const frontier = useMemo(() => ROAD_CHAPTERS.slice(1).find((chapter, index) => !progress.chapterChoices.has(chapter.id) && (index === 0 || progress.chapterChoices.has(ROAD_CHAPTERS[index].id))) || ROAD_CHAPTERS.at(-1), [progress.chapterChoices]);
  const [chapterId, setChapterId] = useState(frontier.id);
  const [overview, setOverview] = useState(false);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: -8 });
  const [inspected, setInspected] = useState(null);
  const [focusedId, setFocusedId] = useState('trailhead');
  const currentChapterIndex = ROAD_CHAPTERS.findIndex((chapter) => chapter.id === chapterId);
  const boardWidth = BOARD_PAD_X * 2 + (ROAD_CHAPTERS.length - 1) * CHAPTER_WIDTH;
  const visibleNodes = useMemo(() => progress.nodes.filter((node) => node.state !== 'hidden'), [progress.nodes]);

  const centerChapter = useCallback((targetId, nextScale = 1) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const x = chapterX(targetId);
    const usableCenter = FOCUS_LABEL_GUTTER + (viewport.clientWidth - FOCUS_LABEL_GUTTER) / 2;
    setOffset({ x: usableCenter - x * nextScale, y: -8 });
  }, []);

  const showOverview = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const nextScale = Math.max(0.22, Math.min(0.72, (viewport.clientWidth - 48) / boardWidth));
    setOverview(true);
    setScale(nextScale);
    setOffset({
      x: (viewport.clientWidth - boardWidth * nextScale) / 2,
      y: Math.max(12, (viewport.clientHeight - BOARD_HEIGHT * nextScale) / 2),
    });
  }, [boardWidth]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => centerChapter(frontier.id, 1));
    return () => cancelAnimationFrame(frame);
  }, [centerChapter, frontier.id]);

  const selectChapter = useCallback((nextId) => {
    setChapterId(nextId);
    setOverview(false);
    setScale(1);
    requestAnimationFrame(() => centerChapter(nextId, 1));
  }, [centerChapter]);
  const zoom = useCallback((delta) => setScale((current) => {
    const next = Math.max(0.22, Math.min(1.45, Number((current + delta).toFixed(2))));
    const viewport = viewportRef.current;
    if (viewport) setOffset((position) => {
      const worldX = (viewport.clientWidth / 2 - position.x) / current;
      const worldY = (viewport.clientHeight / 2 - position.y) / current;
      return { x: viewport.clientWidth / 2 - worldX * next, y: viewport.clientHeight / 2 - worldY * next };
    });
    return next;
  }), []);
  const toggle = useCallback((node) => setSelections((current) => {
    const chapter = current[node.chapterId] || [];
    const next = chapter.includes(node.id) ? chapter.filter((id) => id !== node.id) : [...chapter, node.id].slice(-2);
    return next.length ? { [node.chapterId]: next } : {};
  }), [setSelections]);

  const focusNode = useCallback((id) => {
    setFocusedId(id);
    nodeRefs.current.get(id)?.focus({ preventScroll: true });
    const point = positions.get(id);
    const viewport = viewportRef.current;
    if (!point || !viewport) return;
    const screenX = point.x * scale + offset.x;
    const screenY = point.y * scale + offset.y;
    const margin = 110;
    setOffset((current) => ({
      x: screenX < margin ? current.x + margin - screenX : screenX > viewport.clientWidth - margin ? current.x - (screenX - viewport.clientWidth + margin) : current.x,
      y: screenY < margin ? current.y + margin - screenY : screenY > viewport.clientHeight - margin ? current.y - (screenY - viewport.clientHeight + margin) : current.y,
    }));
  }, [offset.x, offset.y, positions, scale]);

  const nodeKeyDown = useCallback((event, node) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const next = nearestNode(node.id, event.key, visibleNodes, positions);
      if (next) focusNode(next.id);
    } else if (event.key === 'Enter') {
      event.preventDefault(); setInspected(node);
    } else if (event.key === ' ') {
      event.preventDefault();
      if (node.kind === 'capstone' && !['claimed', 'excluded'].includes(node.state)) toggle(node);
      if (node.kind === 'classic-reward' && node.state === 'eligible') onClaimClassic(node);
    } else if (event.key === 'Home') {
      event.preventDefault(); selectChapter(frontier.id);
    } else if (event.key === 'End') {
      event.preventDefault(); selectChapter(ROAD_CHAPTERS.at(-1).id);
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.12); }
    else if (event.key === '-') { event.preventDefault(); zoom(-0.12); }
    else if (event.key === '0') { event.preventDefault(); setScale(1); centerChapter(chapterId, 1); }
  }, [centerChapter, chapterId, focusNode, frontier.id, onClaimClassic, positions, selectChapter, toggle, visibleNodes, zoom]);

  const backgroundKeyDown = useCallback((event) => {
    if (event.target !== event.currentTarget) return;
    const amount = event.shiftKey ? 180 : 88;
    const move = { ArrowLeft: [amount, 0], ArrowRight: [-amount, 0], ArrowUp: [0, amount], ArrowDown: [0, -amount] }[event.key];
    if (move) { event.preventDefault(); setOffset((current) => ({ x: current.x + move[0], y: current.y + move[1] })); }
    if (event.key === 'Home') { event.preventDefault(); selectChapter(frontier.id); }
    if (event.key === 'End') { event.preventDefault(); selectChapter(ROAD_CHAPTERS.at(-1).id); }
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(0.12); }
    if (event.key === '-') { event.preventDefault(); zoom(-0.12); }
    if (event.key === '0') { event.preventDefault(); setScale(1); centerChapter(chapterId, 1); }
  }, [centerChapter, chapterId, frontier.id, selectChapter, zoom]);

  const panStart = useCallback((event) => {
    if (event.button !== 0 || event.target.closest?.('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, ...offset };
  }, [offset]);
  const panMove = useCallback((event) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    const drag = dragRef.current;
    setOffset({ x: drag.x + event.clientX - drag.clientX, y: drag.y + event.clientY - drag.clientY });
  }, []);
  const panEnd = useCallback((event) => { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }, []);
  const activeSelection = Object.entries(selections).find(([, ids]) => ids.length > 0);
  const activeChapter = activeSelection ? ROAD_CHAPTERS.find((chapter) => chapter.id === activeSelection[0]) : null;

  return (
    <section className="recognition-v2">
      <header className="recognition-v2__toolbar">
        <div><span>RECOGNITION BOARD</span><h2>{overview ? 'Road Overview' : `Frontier · ${ROAD_CHAPTERS[currentChapterIndex]?.label}`}</h2><p>Every chapter remains on one continuous Road. Pan freely, or return to the current frontier.</p></div>
        <div className="recognition-v2__controls"><button type="button" aria-pressed={overview} onClick={() => { if (overview) selectChapter(frontier.id); else showOverview(); }}>{overview ? 'Return to frontier' : 'See full Road'}</button><button type="button" onClick={() => zoom(-0.12)} aria-label="Zoom out">−</button><b>{Math.round(scale * 100)}%</b><button type="button" onClick={() => zoom(0.12)} aria-label="Zoom in">＋</button><button type="button" onClick={() => selectChapter(frontier.id)}>Frontier</button></div>
      </header>
      <div className={`recognition-v2__workspace ${inspected ? 'has-inspector' : ''}`}>
        <div
          ref={viewportRef}
          className={`recognition-v2__viewport ${overview ? 'is-overview' : 'is-chapter-focus'}`}
          role="application"
          tabIndex={focusedId && visibleNodes.some((node) => node.id === focusedId) ? -1 : 0}
          aria-label="Recognition Board. Arrow keys move between nodes after one is focused, or pan when the background is focused."
          onKeyDown={backgroundKeyDown}
          onPointerDown={panStart}
          onPointerMove={panMove}
          onPointerUp={panEnd}
          onPointerCancel={panEnd}
        >
          <div className="recognition-v2__canvas" style={{ width: boardWidth, height: BOARD_HEIGHT, transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}>
            <BoardConnections nodes={visibleNodes} positions={positions} />
            {ROAD_CHAPTERS.map((chapter) => <div key={chapter.id} className={`recognition-v2__chapter-column ${chapter.id === chapterId ? 'is-current' : ''}`} style={{ left: chapterX(chapter.id) }}><span>{chapter.label}</span><small>{chapter.min.toLocaleString()} lifetime</small></div>)}
            {visibleNodes.map((node) => <BoardNode key={node.id} node={node} point={positions.get(node.id)} selected={(selections[node.chapterId] || []).includes(node.id)} focused={node.id === focusedId} currentChapter={node.chapterId === chapterId} onFocus={setFocusedId} onInspect={setInspected} onToggle={toggle} onClaim={onClaimClassic} onKeyDown={nodeKeyDown} buttonRef={(element) => { if (element) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id); }} />)}
          </div>
          {!overview && <div className="recognition-v2__lane-index" aria-hidden="true">{ROAD_BRANCHES.map((branch) => <div key={branch.id} className="recognition-v2__lane-label" style={{ top: BRANCH_Y[branch.id] * scale + offset.y, '--branch-color': branch.color }}><i>{branch.glyph}</i><span><b>{branch.label}</b><small>{branch.subtitle}</small></span></div>)}</div>}
          {!overview && <div className="recognition-v2__map-key" aria-label="Road symbol key"><b>SYMBOLS</b><span><i>◉</i> stat</span><span><i>◆</i> achievement</span><span><i>▣</i> classic</span><span><i>✦</i> reveal</span><span><i>◇</i> path</span></div>}
        </div>
        <BoardInspector node={inspected} onClose={() => setInspected(null)} onClaim={onClaimClassic} claiming={claimingClassic === inspected?.legacyRewardId} />
      </div>
      <div className="recognition-v2__footer">
        <div className="recognition-v2__legend" aria-label="Board legend"><b>Legend</b><span><i>◉</i> Stat gate</span><span><i>◆</i> Achievement</span><span><i>✦</i> Interface reveal</span><span><i>▣</i> Classic reward</span><span><i>⬢</i> Capability</span><span><i>◇</i> Signature path</span><span className="is-solid">━━</span><small>branch path</small><span className="is-dotted">┄┄</span><small>supporting evidence</small></div>
        <p>Keyboard: arrows move · Enter inspects · Space selects/claims · Home frontier · End final chapter · +/− zoom · 0 reset</p>
      </div>
      {activeChapter && <div className="recognition-v2__commit"><div><span>{activeChapter.label.toUpperCase()} CHAPTER</span><strong>{activeSelection[1].length}/2 signature paths selected</strong><p>The other paths become excluded; their achievements remain earnable.</p></div><button type="button" disabled={activeSelection[1].length !== 2 || committing} onClick={() => onCommit(activeChapter.id, activeSelection[1])}>{committing ? 'Committing…' : `Commit both · ${activeChapter.cost * 2}`}</button></div>}
    </section>
  );
}
