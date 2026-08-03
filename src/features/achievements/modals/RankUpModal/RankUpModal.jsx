import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { getRankBenefitsForGroup } from '@domain/rank/Rank.js';
import '@features/achievements/modals/RankUpModal/RankUpModal.css';

/**
 * Welcome modal shown after a match conclude promotes the player to a new
 * rank group (Iron → Bronze → Silver → … → Radiant). Fired from
 * MatchArena.concludeMatch when getRankGroupIndex(newElo) > getRankGroupIndex(oldElo).
 * Demotions don't fire a modal.
 *
 * Repeat-fire semantics: this is a celebratory beat, not a once-ever
 * achievement. If a player rank-ups, loses ELO, and re-promotes later,
 * the modal fires again. (To make it once-only, store seenRankGroups on
 * the player record and skip if newGroup is already in the set.)
 */

export default NiceModal.create(({ newGroup = 'Bronze', newRankLabel = '' }) => {
  const modal = useModal();
  const data = getRankBenefitsForGroup(newGroup);
  const close = () => { modal.hide(); modal.remove(); };

  return (
    <div className="task-modal-overlay">
      {/* Backdrop is non-dismissive (no onClick) — the user must explicitly
          click CONTINUE so they actually read the new tier's privilege copy. */}
      <div className="blanker" />
      <div className={`task-modal rankup-modal rankup-${data.group.toLowerCase()}`}>
        <div className="rankup-eyebrow">RANK UP</div>
        <h1 className="rankup-headline">{data.rankUpHeadline}</h1>
        {newRankLabel && <p className="rankup-sublabel">{newRankLabel}</p>}
        <div className="rankup-duration">{data.matchContract}</div>
        <ul className="rankup-bullets">
          {data.promotionBullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        <button className="primary rankup-cta" onClick={close}>CONTINUE →</button>
      </div>
    </div>
  );
});
