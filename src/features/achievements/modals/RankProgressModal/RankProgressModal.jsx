import NiceModal, { useModal } from '@ebay/nice-modal-react';
import { getAllRankBenefits, getRankProgressDetails } from '@domain/rank/Rank.js';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import '@features/achievements/modals/RankProgressModal/RankProgressModal.css';

function getNextRewardBullets(details) {
  if (details.isMaxRank) {
    return details.currentBenefits.rewards;
  }

  if (details.unlocksNewGroup) {
    return details.nextBenefits.rewards;
  }

  const bullets = [
    `Badge advances to ${details.nextLabel}.`,
    `${details.currentBenefits.matchContract} stays fixed for every rank.`,
  ];

  if (details.nextGroupBenefits) {
    bullets.push(`Next major unlock: ${details.nextGroupBenefits.group} - ${details.nextGroupBenefits.rewards[0]}`);
  }

  return bullets;
}

function TierBenefitRow({ benefit, active }) {
  const rankClass = benefit.group.toLowerCase();

  return (
    <div className={`rpm-tier-row ${active ? 'active' : ''}`}>
      <div className={`rpm-tier-emblem rank-${rankClass}`}>
        <RankIcon group={benefit.group} size={18} />
      </div>
      <div className="rpm-tier-copy">
        <div className="rpm-tier-name-row">
          <span className={`rpm-tier-name rank-${rankClass}`}>{benefit.group}</span>
          {active && <span className="rpm-current-chip">Current</span>}
        </div>
        <div className="rpm-tier-flags">
          <span>{benefit.matchContract}</span>
          <span>{benefit.echoFillers ? 'Echo fillers' : 'Real profiles only'}</span>
        </div>
      </div>
    </div>
  );
}

export default NiceModal.create(({ elo = 0 }) => {
  const modal = useModal();
  const details = getRankProgressDetails(elo);
  const tierBenefits = getAllRankBenefits();
  const nextRewardBullets = getNextRewardBullets(details);
  const close = () => { modal.hide(); modal.remove(); };

  if (!modal.visible) return null;

  return (
    <div className="rank-progress-modal-overlay">
      <div className="blanker" onClick={close} />
      <div
        className={`rank-progress-modal rank-progress-${details.current.group.toLowerCase()}`}
        style={{
          '--rank-progress-accent': details.current.color,
          '--rank-progress-glow': details.current.glow,
        }}
      >
        <div className="rpm-header">
          <div>
            <div className="rpm-eyebrow">Rank Progress</div>
            <h2 className="rpm-title">Level Path</h2>
          </div>
          <button className="close-btn rpm-close" onClick={close} title="Close">X</button>
        </div>

        <div className="rpm-body">
          <div className="rpm-rank-strip">
            <div className="rpm-rank-pill">
              <span className={`rpm-rank-icon rank-${details.current.group.toLowerCase()}`}>
                <RankIcon group={details.current.group} sub={details.current.sub} size={28} showDots />
              </span>
              <span>
                <span className="rpm-rank-caption">Current</span>
                <strong className={`rank-${details.current.group.toLowerCase()}`}>{details.currentLabel}</strong>
              </span>
            </div>

            <div className="rpm-rank-arrow">to</div>

            <div className="rpm-rank-pill rpm-rank-pill--next">
              {details.next ? (
                <>
                  <span className={`rpm-rank-icon rank-${details.next.group.toLowerCase()}`}>
                    <RankIcon group={details.next.group} sub={details.next.sub} size={28} showDots />
                  </span>
                  <span>
                    <span className="rpm-rank-caption">Next</span>
                    <strong className={`rank-${details.next.group.toLowerCase()}`}>{details.nextLabel}</strong>
                  </span>
                </>
              ) : (
                <>
                  <span className={`rpm-rank-icon rank-${details.current.group.toLowerCase()}`}>
                    <RankIcon group={details.current.group} size={28} />
                  </span>
                  <span>
                    <span className="rpm-rank-caption">Next</span>
                    <strong className={`rank-${details.current.group.toLowerCase()}`}>Max Rank</strong>
                  </span>
                </>
              )}
            </div>
          </div>

          <section className="rpm-progress-section">
            <div className="rpm-progress-topline">
              <span>{details.progress}% complete</span>
              <strong>{details.isMaxRank ? 'Top tier reached' : `${details.eloToNext} ELO to ${details.nextLabel}`}</strong>
            </div>
            <div className="rpm-progress-track" aria-hidden="true">
              <div className="rpm-progress-fill" style={{ width: `${details.progress}%` }} />
            </div>
            <div className="rpm-progress-foot">
              <span>{details.isMaxRank ? `${details.elo.toLocaleString()} ELO` : `${details.levelElo}/${details.levelSpan} ELO in this level`}</span>
              <span>{details.isMaxRank ? 'No further rank target' : `Target: ${details.nextElo.toLocaleString()} ELO`}</span>
            </div>
          </section>

          <section className="rpm-section">
            <div className="rpm-section-title">Next Level Rewards</div>
            <ul className="rpm-reward-list">
              {nextRewardBullets.map((reward) => <li key={reward}>{reward}</li>)}
            </ul>
          </section>

          <section className="rpm-section rpm-tier-guide">
            <div className="rpm-section-title"><span className="rpm-help-mark">?</span> Tier Benefit Guide</div>
            <div className="rpm-tier-list">
              {tierBenefits.map((benefit) => (
                <TierBenefitRow
                  key={benefit.group}
                  benefit={benefit}
                  active={benefit.group === details.current.group}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
});
