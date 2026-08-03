import { useMemo, useState } from 'react';
import { resolveAchievementPackExclusions } from '@domain/contribution-road/ContributionRoad.js';
import { describeRoadGate } from '@domain/contribution-road/RoadGatePresentation.js';
import ContributionIcon from '@shared/icons/ContributionIcon.jsx';
import './AchievementPacksBoard.css';

const BOARD_SIZE = Object.freeze({ width: 980, height: 580 });

function routeSignature(nodes) {
  const choices = nodes.filter((node) => node.claimed && !node.automatic).map((node) => node.label);
  return choices.length ? choices.slice(-4).join(' · ') : 'No route chosen yet';
}

function PackLibrary({ packs, balances, onOpen }) {
  return (
    <section className="achievement-pack-library" aria-label="Achievement Pack library">
      <header>
        <span>PERMANENT COLLECTION</span>
        <h2>Choose a board to inspect</h2>
        <p>Packs never expire. Every choice stays visible, and each board can be inspected before you commit.</p>
      </header>
      <div className="achievement-pack-library__grid">
        {packs.map((pack) => {
          const rewards = pack.nodes.filter((node) => !node.automatic);
          const claimed = rewards.filter((node) => node.claimed).length;
          const available = rewards.filter((node) => node.state === 'eligible').length;
          return (
            <button type="button" className="achievement-pack-card" key={pack.packId} onClick={() => onOpen(pack.packId)}>
              <span className="achievement-pack-card__art" style={{ background: pack.themeArt }} aria-hidden="true"><i>✦</i></span>
              <span className="achievement-pack-card__copy">
                <small>ACHIEVEMENT PACK</small>
                <strong>{pack.name}</strong>
                <p>{pack.subtitle}</p>
                <span className="achievement-pack-card__stats">
                  <b>{claimed}/{rewards.length} claimed</b>
                  <b>{available} available</b>
                  <b><ContributionIcon size={13} /> {balances.spendableContribution.toLocaleString()}</b>
                </span>
                <span className="achievement-pack-card__rewards">{pack.headlineRewards.join(' · ')}</span>
                <span className="achievement-pack-card__signature"><em>Your route</em>{routeSignature(pack.nodes)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PackConnections({ nodes, previewExcluded }) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return (
    <svg className="achievement-pack-board__paths" viewBox={`0 0 ${BOARD_SIZE.width} ${BOARD_SIZE.height}`} aria-hidden="true">
      {nodes.flatMap((node) => (node.parentIds || []).map((parentId) => {
        const parent = byId.get(parentId);
        if (!parent) return null;
        const affected = previewExcluded.has(node.id) || previewExcluded.has(parent.id);
        return (
          <line
            key={`${parentId}:${node.id}`}
            className={affected ? 'is-preview-closed' : ''}
            x1={parent.x + 58}
            y1={parent.y + 28}
            x2={node.x + 58}
            y2={node.y + 28}
          />
        );
      }))}
    </svg>
  );
}

function unlockModeLabel(mode) {
  return ({
    'earned-only': 'Earned only',
    'contribution-only': 'Contribution only',
    'earned-and-contribution': 'Earned and Contribution',
    'earned-or-contribution': 'Earned or Contribution',
    free: 'Free',
  })[mode] || mode;
}

function NodePopover({ node, previewExcluded, claiming, onClaim, onClose }) {
  if (!node) return (
    <aside className="achievement-pack-popover is-empty">
      <span>SELECT A REWARD</span>
      <p>Requirements and permanent route consequences appear here, keeping the board concise.</p>
    </aside>
  );
  const blockedCopy = node.excluded
    ? 'This route is permanently closed.'
    : !node.parentPassed
      ? 'Claim a connected parent reward first.'
      : node.state !== 'eligible'
        ? 'One or more claim requirements are still incomplete.'
        : null;
  const showsEarnedGate = ['earned-only', 'earned-and-contribution', 'earned-or-contribution'].includes(node.unlockMode);
  const contributionCopy = node.unlockMode === 'earned-or-contribution' && node.gateResult?.passed
    ? 'Not needed — earned gate met'
    : `${node.cost.toLocaleString()}${node.unlockMode === 'earned-or-contribution' ? ' bypass' : ''} ${node.affordable ? 'available' : 'needed'}`;
  return (
    <aside className="achievement-pack-popover">
      <button type="button" className="achievement-pack-popover__close" onClick={onClose} aria-label="Close reward details">×</button>
      <span>{unlockModeLabel(node.unlockMode).toUpperCase()}</span>
      <h3>{node.label}</h3>
      <p>{node.description}</p>
      <dl>
        <div><dt>Path</dt><dd>{node.parentPassed ? 'Connected' : 'Parent reward needed'}</dd></div>
        {showsEarnedGate && node.activityGate && <div><dt>Earned gate</dt><dd>{describeRoadGate(node.gateResult)}</dd></div>}
        {node.cost > 0 && <div><dt>Contribution</dt><dd>{contributionCopy}</dd></div>}
        <div><dt>Rewards</dt><dd>{node.rewards.map((reward) => reward.label).join(' · ')}</dd></div>
      </dl>
      {!!previewExcluded.length && !node.claimed && (
        <div className="achievement-pack-popover__consequence">
          <strong>Choosing this closes {previewExcluded.length} route{previewExcluded.length === 1 ? '' : 's'}.</strong>
          <p>The dim preview clears if you click away. It becomes permanent only after Claim.</p>
        </div>
      )}
      {node.claimed ? <strong className="achievement-pack-popover__claimed">Claimed permanently</strong> : (
        <button type="button" className="primary" disabled={node.state !== 'eligible' || claiming} onClick={() => onClaim(node)}>
          {claiming ? 'Claiming…' : blockedCopy || `Claim ${node.label}`}
        </button>
      )}
    </aside>
  );
}

function PackBoard({ pack, balances, claiming, onBack, onClaim }) {
  const [selectedId, setSelectedId] = useState(null);
  const [previewCycle, setPreviewCycle] = useState(0);
  const claimedIds = useMemo(() => new Set(pack.nodes.filter((node) => node.claimed).map((node) => node.id)), [pack.nodes]);
  const selected = pack.nodes.find((node) => node.id === selectedId) || null;
  const previewExcludedIds = selected && !selected.claimed
    ? resolveAchievementPackExclusions(pack.nodes, selected.id, claimedIds)
    : [];
  const previewExcluded = new Set(previewExcludedIds);
  const select = (node) => {
    if (selectedId === node.id) {
      setSelectedId(null);
      return;
    }
    setSelectedId(node.id);
    setPreviewCycle((value) => value + 1);
  };
  return (
    <section className="achievement-pack-detail">
      <header style={{ '--pack-art': pack.themeArt }}>
        <button type="button" onClick={onBack}>← All packs</button>
        <div><span>ACHIEVEMENT PACK</span><h2>{pack.name}</h2><p>{pack.subtitle}</p></div>
        <strong><ContributionIcon size={16} /> {balances.spendableContribution.toLocaleString()} available</strong>
      </header>
      <div className="achievement-pack-detail__layout">
        <div className="achievement-pack-board__viewport">
          <div
            className={`achievement-pack-board ${selected ? 'has-preview' : ''}`}
            key={`${pack.packId}:${previewCycle}`}
            style={{ width: BOARD_SIZE.width, height: BOARD_SIZE.height }}
            onClick={() => setSelectedId(null)}
          >
            <PackConnections nodes={pack.nodes} previewExcluded={previewExcluded} />
            {pack.nodes.map((node) => (
              <button
                type="button"
                key={node.id}
                className={`achievement-pack-node is-${node.state} ${selectedId === node.id ? 'is-selected' : ''} ${previewExcluded.has(node.id) ? 'is-preview-closed' : ''}`}
                style={{ left: node.x, top: node.y }}
                onClick={(event) => { event.stopPropagation(); select(node); }}
                aria-label={`${node.label}, ${node.state}`}
                aria-pressed={selectedId === node.id}
              >
                <i>{node.claimed ? '✓' : node.kind === 'pack-root' ? '✦' : '◆'}</i>
                <span>{node.label}</span>
              </button>
            ))}
          </div>
        </div>
        <NodePopover
          node={selected}
          previewExcluded={previewExcludedIds}
          claiming={claiming}
          onClaim={onClaim}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </section>
  );
}

export default function AchievementPacksBoard({ progress, claiming = false, onClaim }) {
  const [packId, setPackId] = useState(null);
  const pack = progress.packs.find((entry) => entry.packId === packId) || null;
  if (!pack) return <PackLibrary packs={progress.packs} balances={progress.balances} onOpen={setPackId} />;
  return <PackBoard pack={pack} balances={progress.balances} claiming={claiming} onBack={() => setPackId(null)} onClaim={onClaim} />;
}
