import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppContext } from '@app/hooks/useAppContext.js';
import { DOMAIN_INVALIDATION } from '@app/context/domainRevisions.js';
import {
  CONTRIBUTION_PASS_REWARDS,
  STORES,
} from '@domain/constants.js';
import { claimContributionPassReward } from '@domain/contribution/Contribution.js';
import {
  CONTRIBUTION_ROAD_NODES,
  OPENING_TRAIL_STEPS,
  ROAD_BRANCHES,
  ROAD_CHAPTERS,
} from '@domain/contribution-road/ContributionRoadCatalog.js';
import {
  claimAchievementPackNode,
  getContributionRoadProgress,
  reconcileOpeningTrail,
  rebuildRoadStats,
  verifyRoadEvidence,
} from '@domain/contribution-road/ContributionRoad.js';
import { describeRoadGate } from '@domain/contribution-road/RoadGatePresentation.js';
import { ACHIEVEMENT_DEFINITIONS_V2 } from '@domain/achievements-v2/AchievementCatalogV2.js';
import ContributionIcon from '@shared/icons/ContributionIcon.jsx';
import AchievementPacksBoard from './AchievementPacksBoard.jsx';
import '@features/contribution-pass/pages/ContributionPass/ContributionPass.css';

const BOARD_WIDTH = 3040;
const BOARD_HEIGHT = 1100;
const DEFAULT_BOARD_TRANSFORM = Object.freeze({ x: 28, y: 6, scale: 1 });
const BRANCH_Y = Object.freeze({ compass: 270, forge: 490, chronicle: 710, fellowship: 930 });
const CHAPTER_X = Object.freeze(Object.fromEntries(ROAD_CHAPTERS.map((chapter, index) => [chapter.id, 130 + index * 390])));

function nodePosition(node) {
  if (node.id === 'trailhead') return { x: 130, y: 600 };
  if (node.kind === 'interface-reveal') {
    const step = Math.max(1, Number(node.gate?.step) || 1);
    return { x: 150 + (step - 1) * 292, y: 58 };
  }
  if (node.kind === 'capability') return { x: CHAPTER_X[node.chapterId] || Number(node.x) || 160, y: 170 };
  if (node.kind === 'achievement') {
    const chapterX = CHAPTER_X[node.chapterId] || Number(node.x) || 160;
    const lane = BRANCH_Y[node.branchId] || 660;
    return { x: chapterX - 112, y: lane };
  }
  if (node.kind === 'secret') return { x: CHAPTER_X[node.chapterId] + 116, y: (BRANCH_Y[node.branchId] || 660) + 90 };
  const chapterX = CHAPTER_X[node.chapterId] || Number(node.x) || 160;
  const lane = BRANCH_Y[node.branchId] || 660;
  if (node.kind === 'capstone') return { x: chapterX, y: lane };
  const thresholdNodes = CONTRIBUTION_ROAD_NODES.filter((entry) => (
    entry.kind === 'stat' && entry.branchId === node.branchId && entry.chapterId === node.chapterId
  ));
  const offset = Math.max(0, thresholdNodes.findIndex((entry) => entry.id === node.id));
  return {
    x: chapterX + 142 + (offset % 2) * 100,
    y: lane + (offset < 2 ? -55 : 55),
  };
}

function RoadNode({ node, selected, onInspect, onToggle, frontier = false, distant = false }) {
  if (node.state === 'hidden') return null;
  const position = nodePosition(node);
  const statProgress = node.kind === 'stat'
    ? Math.min(100, (Number(node.gateResult?.current || 0) / Math.max(1, Number(node.gateResult?.target || 1))) * 100)
    : 0;
  const branch = node.kind === 'interface-reveal'
    ? { color: '#29b6f6', glyph: '＋' }
    : ROAD_BRANCHES.find((entry) => entry.id === node.branchId);
  return (
    <button
      type="button"
      className={`road-node road-node--${node.kind} is-${node.state} ${selected ? 'is-selected' : ''} ${frontier ? 'is-frontier' : ''} ${distant ? 'is-distant' : ''}`}
      style={{
        left: position.x,
        top: position.y,
        '--road-branch': branch?.color || '#b692ff',
        '--road-progress': `${statProgress * 3.6}deg`,
      }}
      onClick={(event) => {
        event.stopPropagation();
        onInspect(node);
        if (node.kind === 'capstone' && !['claimed', 'excluded'].includes(node.state)) onToggle(node);
      }}
      aria-pressed={selected || undefined}
      aria-label={`${node.label}. ${describeRoadGate(node.gateResult)}`}
    >
      <i aria-hidden="true">{{ achievement: '◆', 'interface-reveal': '＋', capability: '⬢', secret: '?' }[node.kind] || (node.kind === 'stat' ? '' : branch?.glyph || '✦')}</i>
      <span>{node.label}</span>
      {node.kind === 'capstone' && <small>{node.cost} each</small>}
    </button>
  );
}

function RoadConnections({ nodes }) {
  const lines = [];
  for (const branch of ROAD_BRANCHES) {
    let previous = { x: 130, y: 600 };
    for (const chapter of ROAD_CHAPTERS.slice(1)) {
      const node = nodes.find((entry) => entry.id === `${chapter.id}:${branch.id}`);
      if (!node) continue;
      const position = nodePosition(node);
      const current = { x: position.x, y: position.y };
      lines.push({ id: `${branch.id}:${chapter.id}`, branch, previous, current, active: ['claimed', 'eligible'].includes(node.state) });
      previous = current;
    }
  }
  const spokes = nodes.filter((node) => node.kind === 'stat').map((node) => {
    const branch = ROAD_BRANCHES.find((entry) => entry.id === node.branchId);
    const position = nodePosition(node);
    return { id: `spoke:${node.id}`, branch, position, lane: BRANCH_Y[node.branchId] || position.y };
  });
  return (
    <svg className="road-connections" viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`} aria-hidden="true">
      {lines.map((line) => (
        <path
          key={line.id}
          className={line.active ? 'is-active' : ''}
          style={{ '--road-branch': line.branch.color }}
          d={`M ${line.previous.x} ${line.previous.y} C ${line.previous.x + 110} ${line.previous.y}, ${line.current.x - 110} ${line.current.y}, ${line.current.x} ${line.current.y}`}
        />
      ))}
      {spokes.map((spoke) => <path key={spoke.id} className="road-detail-spoke" style={{ '--road-branch': spoke.branch?.color }} d={`M ${spoke.position.x} ${spoke.lane} L ${spoke.position.x} ${spoke.position.y}`} />)}
    </svg>
  );
}

function NodeInspector({ node, onClose }) {
  if (!node) return null;
  const rewards = node.rewards || [];
  return (
    <aside className="road-inspector" aria-label="Road node details">
      <header>
        <div>
          <span>{node.kind.replaceAll('-', ' ')}</span>
          <h2>{node.label}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close node details">×</button>
      </header>
      <div className="road-inspector__scroll">
        <p>{node.description || 'A permanent record on your Contribution Road.'}</p>
        <section>
          <span>PROGRESS</span>
          <strong>{describeRoadGate(node.gateResult)}</strong>
          <div className="road-inspector__meter"><i style={{ width: `${Math.min(100, (node.gateResult?.current / Math.max(1, node.gateResult?.target)) * 100) || 0}%` }} /></div>
        </section>
        {node.gateResult?.alternatives?.length > 0 && (
          <section>
            <span>ROUTES</span>
            {node.gateResult.alternatives.map((gate, index) => (
              <div className={`road-gate-row ${gate.passed ? 'is-complete' : ''}`} key={`${gate.kind}:${index}`}>
                <i>{gate.passed ? '✓' : '○'}</i><b>{describeRoadGate(gate)}</b>
              </div>
            ))}
          </section>
        )}
        {node.cost > 0 && (
          <section className="road-inspector__cost">
            <span>COMMITMENT COST</span>
            <strong><ContributionIcon size={16} /> {node.cost} Contribution</strong>
            <p>Charged only when this chapter’s two paths commit together.</p>
          </section>
        )}
        {rewards.length > 0 && (
          <section>
            <span>REWARDS</span>
            <div className="road-reward-list">
              {rewards.map((reward) => <b key={reward.id}>{reward.label}<small>{reward.type.replaceAll('_', ' ')}</small></b>)}
            </div>
          </section>
        )}
        {node.excluded && <p className="road-inspector__warning">This path was permanently excluded by the chapter choice.</p>}
      </div>
    </aside>
  );
}

function RecognitionBoard({ progress, selections, setSelections, onCommit, committing }) {
  const viewportRef = useRef(null);
  const dragRef = useRef(null);
  const [transform, setTransform] = useState(() => ({ ...DEFAULT_BOARD_TRANSFORM }));
  const [inspected, setInspected] = useState(null);
  const frontierChapter = useMemo(() => ROAD_CHAPTERS.slice(1).find((chapter, index) => {
    if (progress.chapterChoices.has(chapter.id)) return false;
    return index === 0 || progress.chapterChoices.has(ROAD_CHAPTERS[index].id);
  }) || ROAD_CHAPTERS.at(-1), [progress.chapterChoices]);
  const frontierIndex = ROAD_CHAPTERS.findIndex((chapter) => chapter.id === frontierChapter.id);
  const visibleNodes = useMemo(() => progress.nodes.filter((node) => {
    if (['chapter-seal', 'interface-reveal', 'capability', 'capstone'].includes(node.kind)) return true;
    if (node.kind === 'secret') return node.state !== 'hidden';
    return node.chapterId === frontierChapter.id;
  }), [frontierChapter.id, progress.nodes]);
  const toggle = useCallback((node) => {
    setSelections((current) => {
      const chapter = current[node.chapterId] || [];
      const next = chapter.includes(node.id) ? chapter.filter((id) => id !== node.id) : [...chapter, node.id].slice(-2);
      return next.length ? { [node.chapterId]: next } : {};
    });
  }, [setSelections]);
  const zoom = useCallback((delta) => setTransform((current) => ({ ...current, scale: Math.max(0.55, Math.min(1.6, current.scale + delta)) })), []);
  const keyboardPan = useCallback((event) => {
    const distance = event.shiftKey ? 180 : 84;
    const movement = {
      ArrowLeft: { x: distance, y: 0 },
      ArrowRight: { x: -distance, y: 0 },
      ArrowUp: { x: 0, y: distance },
      ArrowDown: { x: 0, y: -distance },
    }[event.key];
    if (movement) {
      event.preventDefault();
      setTransform((current) => ({ ...current, x: current.x + movement.x, y: current.y + movement.y }));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setTransform({ ...DEFAULT_BOARD_TRANSFORM });
    }
  }, []);
  const panStart = useCallback((event) => {
    if (event.button !== 0 || event.target.closest?.('button')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: transform.x, y: transform.y };
  }, [transform]);
  const panMove = useCallback((event) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setTransform((current) => ({ ...current, x: drag.x + event.clientX - drag.clientX, y: drag.y + event.clientY - drag.clientY }));
  }, []);
  const panEnd = useCallback((event) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  }, []);
  const activeSelection = Object.entries(selections).find(([, ids]) => ids.length > 0);
  const activeChapter = activeSelection ? ROAD_CHAPTERS.find((chapter) => chapter.id === activeSelection[0]) : null;
  return (
    <div className="recognition-board-shell">
      <div className="road-board-toolbar">
        <div>
          <span>BRANCHING RECOGNITION BOARD</span>
          <p>Drag or use arrow keys to move. Tab through nodes, inspect one, then choose two signature paths.</p>
        </div>
        <div className="road-zoom-controls" aria-label="Board zoom controls">
          <button type="button" onClick={() => zoom(-0.12)} aria-label="Zoom out">−</button>
          <b>{Math.round(transform.scale * 100)}%</b>
          <button type="button" onClick={() => zoom(0.12)} aria-label="Zoom in">+</button>
          <button type="button" onClick={() => setTransform({ ...DEFAULT_BOARD_TRANSFORM })}>Center</button>
        </div>
      </div>
      <div className="road-board-layout">
        <div
          className="road-board-viewport"
          ref={viewportRef}
          tabIndex={0}
          role="region"
          aria-label="Contribution Road board. Use arrow keys to pan, Shift plus arrow keys for larger moves, and Home to center."
          onKeyDown={keyboardPan}
          onPointerDown={panStart}
          onPointerMove={panMove}
          onPointerUp={panEnd}
          onPointerCancel={panEnd}
        >
          <div className="road-board-canvas" style={{ width: BOARD_WIDTH, height: BOARD_HEIGHT, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
            <RoadConnections nodes={visibleNodes} />
            <div className="road-system-label road-system-label--trail"><b>OPENING TRAIL</b><span>Ten quick interface reveals</span></div>
            {ROAD_CHAPTERS.map((chapter) => (
              <div className={`road-chapter-column ${progress.visibleChapterIds.has(chapter.id) ? 'is-visible' : 'is-future'} ${chapter.id === frontierChapter.id ? 'is-frontier' : ''}`} key={chapter.id} style={{ left: CHAPTER_X[chapter.id] - 28 }}>
                <span>{chapter.label}</span><small>{chapter.min.toLocaleString()}+</small>
              </div>
            ))}
            {ROAD_BRANCHES.map((branch) => (
              <div className="road-branch-label" key={branch.id} style={{ top: BRANCH_Y[branch.id] + 8, '--road-branch': branch.color }}>
                <i>{branch.glyph}</i><b>{branch.label}</b><span>{branch.subtitle}</span>
              </div>
            ))}
            {visibleNodes.map((node) => {
              const chapterIndex = ROAD_CHAPTERS.findIndex((chapter) => chapter.id === node.chapterId);
              return (
              <RoadNode
                key={node.id}
                node={node}
                selected={(selections[node.chapterId] || []).includes(node.id)}
                onInspect={setInspected}
                onToggle={toggle}
                frontier={node.chapterId === frontierChapter.id}
                distant={chapterIndex > frontierIndex}
              />
              );
            })}
          </div>
        </div>
        <NodeInspector node={inspected} onClose={() => setInspected(null)} />
      </div>
      {activeChapter && (
        <div className="road-commit-tray">
          <div>
            <span>{activeChapter.label.toUpperCase()} CHAPTER</span>
            <strong>{activeSelection[1].length}/2 signature paths selected</strong>
            <p>Commit is permanent. The other two capstones become excluded; their achievements remain earnable.</p>
          </div>
          <button type="button" disabled={activeSelection[1].length !== 2 || committing} onClick={() => onCommit(activeChapter.id, activeSelection[1])}>
            {committing ? 'Committing…' : `Commit both · ${activeChapter.cost * 2}`}
          </button>
        </div>
      )}
    </div>
  );
}

function OpeningTrailPanel({ trail, onRevealAll, busy }) {
  return (
    <section className="opening-trail-panel">
      <header>
        <div><span>OPENING TRAIL</span><h2>Interface depth, revealed gently</h2><p>These are presentation milestones, never permission gates. Existing records and deep links remain available.</p></div>
        <button type="button" onClick={onRevealAll} disabled={busy || trail?.complete}>{trail?.complete ? 'Complete interface revealed' : 'Reveal complete interface now'}</button>
      </header>
      <div className="opening-trail-grid">
        {OPENING_TRAIL_STEPS.map((step) => {
          const state = trail?.steps?.find((entry) => entry.step === step.step);
          return <article key={step.id} className={state?.revealed ? 'is-revealed' : state?.milestoneSatisfied ? 'is-waiting' : 'is-silhouette'}>
            <i>{state?.revealed ? '✓' : step.step}</i><div><span>STEP {step.step}</span><h3>{step.label}</h3><p>{step.milestone}</p><small>{step.reveals.join(' · ')}</small></div>
          </article>;
        })}
      </div>
    </section>
  );
}

function RecordsPanel({ progress, evidenceHealth, onVerify, verifying, onRepair, repairing, repairProgress }) {
  return (
    <section className="road-records-panel">
      <header><div><span>EVIDENCE BADGES & STAT DIALS</span><h2>Recognition without competing currencies</h2><p>Achievements award badges. Statistics open routes. Neither spends Contribution.</p></div><button type="button" onClick={onVerify} disabled={verifying}>{verifying ? 'Verifying…' : 'Verify evidence'}</button></header>
      <div className={`road-evidence-health is-${evidenceHealth?.status || 'unknown'}`}>
        <div><span>PROJECTION HEALTH</span><strong>{evidenceHealth?.healthy ? 'Healthy' : evidenceHealth?.status === 'missing' ? 'Not built yet' : 'Needs attention'}</strong></div>
        <div><span>VERSION</span><strong>{evidenceHealth?.projectionVersion || 0} / {evidenceHealth?.expectedProjectionVersion || 2}</strong></div>
        <div><span>LAST VERIFIED</span><strong>{evidenceHealth?.lastVerification ? new Date(evidenceHealth.lastVerification).toLocaleString() : 'Never'}</strong></div>
        {!evidenceHealth?.healthy && <button type="button" onClick={onRepair} disabled={repairing}>{repairing ? `Repairing ${repairProgress?.completed || 0}/${repairProgress?.total || 11}…` : 'Repair Road evidence'}</button>}
      </div>
      <div className="road-records-layout">
        <div className="road-badges-grid">
          {ACHIEVEMENT_DEFINITIONS_V2.map((achievement) => {
            const earned = progress.achievements.has(achievement.id);
            const stage = progress.achievementStages?.[achievement.id] || 0;
            return <article key={achievement.id} className={earned ? 'is-earned' : ''}><i>{earned ? '◆' : '?'}</i><div><span>{achievement.category}</span><h3>{achievement.secret && !earned ? 'Undiscovered' : achievement.title}</h3><p>{achievement.secret && !earned ? 'Keep exploring the Road.' : achievement.description}</p>{stage > 0 && <small>EVOLUTION {stage}</small>}</div></article>;
          })}
        </div>
        <div className="road-stats-list">
          {Object.entries(progress.stats).map(([id, value]) => <div key={id}><span>{id.replaceAll('-', ' ')}</span><strong>{Number(value).toLocaleString()}</strong></div>)}
        </div>
      </div>
    </section>
  );
}

function ShowcasePanel({ progress, currentPlayer, onSave, saving }) {
  const initial = currentPlayer?.selectedRecognitions?.length
    ? currentPlayer.selectedRecognitions
    : (currentPlayer?.selectedAchievementsV2 || []).map((id) => ({ kind: 'achievement', id, label: id }));
  const [selected, setSelected] = useState(initial.slice(0, 3));
  useEffect(() => {
    const next = currentPlayer?.selectedRecognitions?.length
      ? currentPlayer.selectedRecognitions
      : (currentPlayer?.selectedAchievementsV2 || []).map((id) => ({ kind: 'achievement', id, label: id }));
    setSelected(next.slice(0, 3));
  }, [currentPlayer?.selectedRecognitions, currentPlayer?.selectedAchievementsV2]);
  const options = useMemo(() => {
    const earnedAchievements = ACHIEVEMENT_DEFINITIONS_V2
      .filter((achievement) => progress.achievements.has(achievement.id))
      .map((achievement) => ({ kind: 'achievement', id: achievement.id, label: achievement.title, type: 'Evidence badge' }));
    const roadCollectibles = (progress.inventory || [])
      .filter((item) => ['cosmetic_road_emblem', 'cosmetic_chapter_seal', 'cosmetic_legacy_crest'].includes(item.type))
      .map((item) => ({ kind: 'road', id: item.itemId || item.UUID, label: item.name || item.itemId, type: item.type.replaceAll('_', ' ') }));
    if (progress.balances.lifetimeContribution >= 10000) {
      roadCollectibles.push({ kind: 'legacy', id: 'legacy-crest', label: 'Legacy Crest', type: 'Evolving crest' });
    }
    return [...earnedAchievements, ...roadCollectibles];
  }, [progress]);
  const toggle = (option) => setSelected((current) => {
    const key = `${option.kind}:${option.id}`;
    if (current.some((entry) => `${entry.kind}:${entry.id}` === key)) {
      return current.filter((entry) => `${entry.kind}:${entry.id}` !== key);
    }
    return [...current, option].slice(-3);
  });
  return (
    <section className="road-showcase-panel">
      <header><span>PROFILE SHOWCASE</span><h2>Three recognitions, one story</h2><p>Mix evidence badges, Road emblems, chapter seals, and the evolving Legacy Crest. The three-item limit stays intact.</p></header>
      <div className="road-showcase-selection"><span>{selected.length}/3 SELECTED</span>{selected.map((item) => <b key={`${item.kind}:${item.id}`}>{item.label}</b>)}{selected.length === 0 && <em>Choose earned recognitions below.</em>}<button type="button" disabled={saving} onClick={() => onSave(selected)}>{saving ? 'Saving…' : 'Save showcase'}</button></div>
      <div className="road-showcase-grid">
        {options.map((option) => {
          const active = selected.some((entry) => entry.kind === option.kind && entry.id === option.id);
          return <button type="button" key={`${option.kind}:${option.id}`} className={active ? 'is-selected' : ''} aria-pressed={active} onClick={() => toggle(option)}><i>{option.kind === 'achievement' ? '◆' : option.kind === 'legacy' ? '✦' : '⬡'}</i><span>{option.type}</span><strong>{option.label}</strong></button>;
        })}
      </div>
    </section>
  );
}

export default function ContributionPass() {
  const { databaseConnection, currentPlayer, commitCurrentProfile, domainRevisions, invalidateDomains, notify } = useAppContext();
  const [progress, setProgress] = useState(null);
  const [trail, setTrail] = useState(null);
  const [tab, setTab] = useState('board');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [evidenceHealth, setEvidenceHealth] = useState(null);
  const [repairProgress, setRepairProgress] = useState(null);
  const loadGenerationRef = useRef(0);
  const openingTrailPromiseRef = useRef(null);

  const load = useCallback(async ({ rebuildStats = false } = {}) => {
    if (!currentPlayer?.UUID) return;
    const generation = ++loadGenerationRef.current;
    const road = await getContributionRoadProgress(databaseConnection, currentPlayer.UUID, { rebuildStats });
    if (generation !== loadGenerationRef.current) return;
    // The Road itself is the interaction-critical result. Opening Trail
    // reconciliation and diagnostics may touch more stores, so publish the
    // board before either background task can delay first paint.
    setProgress(road);
    setError('');

    if (!openingTrailPromiseRef.current) {
      openingTrailPromiseRef.current = reconcileOpeningTrail(databaseConnection, currentPlayer.UUID)
        .finally(() => { openingTrailPromiseRef.current = null; });
    }
    const [openingResult, healthResult] = await Promise.allSettled([
      openingTrailPromiseRef.current,
      verifyRoadEvidence(databaseConnection, currentPlayer.UUID),
    ]);
    if (generation !== loadGenerationRef.current) return;
    if (openingResult.status === 'fulfilled') setTrail(openingResult.value);
    if (healthResult.status === 'fulfilled') setEvidenceHealth(healthResult.value);
    const backgroundFailure = [openingResult, healthResult].find((result) => result.status === 'rejected');
    if (backgroundFailure) setError(backgroundFailure.reason?.message || 'Road support data could not be refreshed.');
  }, [currentPlayer?.UUID, databaseConnection]);

  useEffect(() => { load().catch((cause) => setError(cause.message)); }, [
    load,
    domainRevisions.contributionRoad,
    domainRevisions.inventory,
    domainRevisions.achievements,
  ]);

  const ownedIds = useMemo(() => new Set((progress?.inventory || []).flatMap((item) => [item.itemId, item.name].filter(Boolean))), [progress?.inventory]);

  const claimPackNode = useCallback(async (node) => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy(`pack:${node.id}`); setError('');
    try {
      await claimAchievementPackNode(databaseConnection, currentPlayer.UUID, node.id);
      invalidateDomains([...DOMAIN_INVALIDATION.inventoryWrite, 'contributionRoad']);
      await load();
      notify?.({ title: `${node.label} claimed`, message: 'Your reward and permanent route choice were saved together.', kind: 'success', persist: false });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }, [busy, currentPlayer?.UUID, databaseConnection, invalidateDomains, load, notify]);

  const claimLegacy = useCallback(async (reward) => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy(reward.id); setError('');
    try {
      await claimContributionPassReward(databaseConnection, currentPlayer.UUID, reward.id);
      invalidateDomains(DOMAIN_INVALIDATION.inventoryWrite);
      await load();
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }, [busy, currentPlayer?.UUID, databaseConnection, invalidateDomains, load]);

  const claimClassicNode = useCallback(async (node) => {
    const reward = CONTRIBUTION_PASS_REWARDS.find((entry) => entry.id === node?.legacyRewardId);
    if (reward) await claimLegacy(reward);
  }, [claimLegacy]);

  const revealAll = useCallback(async () => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy('reveal-all');
    try {
      const next = await reconcileOpeningTrail(databaseConnection, currentPlayer.UUID, { revealAll: true });
      setTrail(next);
      invalidateDomains(['contributionRoad']);
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }, [busy, currentPlayer?.UUID, databaseConnection, invalidateDomains]);

  const verifyEvidence = useCallback(async () => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy('verify-evidence'); setError('');
    try {
      const health = await verifyRoadEvidence(databaseConnection, currentPlayer.UUID);
      setEvidenceHealth(health);
      notify?.({ title: health.healthy ? 'Road evidence is healthy' : 'Road evidence needs repair', message: health.healthy ? `Projection ${health.projectionVersion} is current.` : 'Open Records and run Repair Road evidence.', kind: health.healthy ? 'success' : 'warning', persist: false });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }, [busy, currentPlayer?.UUID, databaseConnection, notify]);

  const repairEvidence = useCallback(async () => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy('repair-evidence'); setError(''); setRepairProgress(null);
    try {
      const receipt = await rebuildRoadStats(databaseConnection, currentPlayer.UUID, { onProgress: setRepairProgress });
      await load();
      invalidateDomains(['contributionRoad']);
      notify?.({ title: 'Road evidence repaired', message: `${Number(receipt.scannedRecords || 0).toLocaleString()} records verified in ${receipt.elapsedMs} ms.`, kind: 'success', persist: false });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); setRepairProgress(null); }
  }, [busy, currentPlayer?.UUID, databaseConnection, invalidateDomains, load, notify]);

  const saveShowcase = useCallback(async (selectedRecognitions) => {
    if (!currentPlayer?.UUID || busy) return;
    setBusy('showcase'); setError('');
    try {
      const refreshed = await databaseConnection.get(STORES.player, currentPlayer.UUID);
      const updated = { ...(refreshed || currentPlayer), selectedRecognitions: selectedRecognitions.slice(0, 3) };
      await commitCurrentProfile(updated);
      notify?.({ title: 'Showcase saved', message: 'Your three recognition collectibles are now visible on your Profile.', kind: 'success', persist: false });
    } catch (cause) { setError(cause.message); }
    finally { setBusy(''); }
  }, [busy, commitCurrentProfile, currentPlayer, databaseConnection, notify]);

  if (!progress) return <div className="pass-page pass-page--loading"><ContributionIcon size={34} /><span>Opening Achievement Packs…</span></div>;
  return (
    <div className="pass-page">
      <header className="pass-hero">
        <div><span className="pass-kicker">PERMANENT PACKS · AUTHORED ROUTES · CONTRIBUTION</span><h1>Achievement Packs</h1><p>Inspect compact authored boards, see what each reward needs, and shape a permanent route signature.</p>{error && <p className="pass-claim-error" role="alert">{error}</p>}</div>
        <div className="pass-balances">
          <div><span>LIFETIME</span><strong>{progress.balances.lifetimeContribution.toLocaleString()}</strong></div>
          <div><span>SPENDABLE</span><strong>{progress.balances.spendableContribution.toLocaleString()}</strong></div>
          <div><span>PACK SPEND</span><strong>{progress.balances.roadSpending.toLocaleString()}</strong></div>
        </div>
      </header>
      <nav className="road-panel-tabs" aria-label="Achievement Pack panels">
        {[
          ['board', 'Packs'], ['opening', 'Opening Trail'], ['records', 'Records'], ['legacy', 'Legacy Cabinet'], ['showcase', 'Showcase'],
        ].map(([id, label]) => <button key={id} type="button" className={tab === id ? 'is-active' : ''} onClick={() => setTab(id)}>{label}<span role="tooltip">{id === 'board' ? 'Two permanent authored reward boards with explicit choices.' : id === 'opening' ? 'Quick first-use milestones that reveal interface depth.' : id === 'records' ? 'Evidence badges and cumulative stat dials.' : id === 'legacy' ? 'Chapter seals, emblems, and the evolving crest.' : 'Choose up to three recognition collectibles for your profile.'}</span></button>)}
      </nav>
      <main className="road-panel-content">
        {tab === 'board' && <AchievementPacksBoard progress={progress} onClaim={claimPackNode} claiming={busy.startsWith('pack:')} />}
        {tab === 'opening' && <OpeningTrailPanel trail={trail} onRevealAll={revealAll} busy={busy === 'reveal-all'} />}
        {tab === 'records' && <RecordsPanel progress={progress} evidenceHealth={evidenceHealth} onVerify={verifyEvidence} verifying={busy === 'verify-evidence'} onRepair={repairEvidence} repairing={busy === 'repair-evidence'} repairProgress={repairProgress} />}
        {tab === 'legacy' && <section className="road-empty-panel"><span>LEGACY CABINET</span><h2>Seals, emblems, and crest evolution</h2><p>Committed chapter seals and Road emblems collect here. After 10,000 lifetime Contribution, the Legacy Crest evolves every additional 2,500.</p><div className="legacy-crest-preview"><i>✦</i><strong>{Math.max(0, Math.floor((progress.balances.lifetimeContribution - 10000) / 2500) + (progress.balances.lifetimeContribution >= 10000 ? 1 : 0))}</strong><span>CREST EVOLUTION</span></div></section>}
        {tab === 'showcase' && <ShowcasePanel progress={progress} currentPlayer={currentPlayer} onSave={saveShowcase} saving={busy === 'showcase'} />}
      </main>
    </div>
  );
}
