import { useMemo, useState } from 'react';
import { v4 as uuid } from 'uuid';
import NiceModal from '@ebay/nice-modal-react';
import { BANNER_GRADIENTS, STORES } from '@domain/constants.js';
import ProfilePicture from '@shared/profile-picture/ProfilePicture.jsx';
import MarkdownEditor from '@shared/markdown-editor/MarkdownEditor.jsx';
import {
  UTCStringToLocalDate,
  UTCStringToLocalTime,
  formatDuration,
  formatInGameTime,
} from '@domain/time/Time.js';
import { formatDaybookEntryTime } from '@domain/profile/ProfileDaybook.js';
import { getCanonicalTaskPoints, getTaskDuration } from '@domain/tasks/Tasks.js';
import { getPlayerRankPresentation } from '@domain/rank/Rank.js';
import { RankIcon } from '@shared/icons/RankIcon.jsx';
import AchievementBadge from '@features/achievements/components/AchievementBadge/AchievementBadge.jsx';
import { computeRarity, getAchievementByKey, getRarityLabel } from '@domain/achievements/Achievements.js';
import EloChart from '@shared/elo-chart/EloChart.jsx';
import { PROFILE_TIMELINE_FILTERS, getProfileMatchOutcome } from '@domain/profile/Profile.js';
import { PROFILE_BLOCK_DEFINITIONS, PROFILE_THEME_SKINS, buildProfileStyleVars, getProfileBlockDefinition, getProfileSkin, isProfileBlockUnlocked, isProfileSkinUnlocked } from '@domain/profile/ProfilePersonalization.js';
import { buildContributionByGoal } from '@domain/contribution/Contribution.js';
import ContributionIcon from '@shared/icons/ContributionIcon.jsx';
import Icon from '@shared/icons/Icon.jsx';
import { findOrCreateResource } from '@shared/resources/Resources.js';
import { useResourceUrl } from '@shared/resource-image/ResourceImage.jsx';
import ActionRow from '@shared/ui/ActionRow.jsx';
import DrawerFrame from '@shared/ui/DrawerFrame.jsx';
import ModalFrame from '@shared/ui/ModalFrame.jsx';
import useProgressiveList from '@shared/ui/useProgressiveList.js';
import LocalSectionNav from '@shared/navigation/LocalSectionNav/LocalSectionNav.jsx';
import { PROFILE_LOCAL_PAGES } from '@features/profile/pages/subpages/ProfilePages.js';

const PROFILE_ELO_SPANS = [
  ['week', '7D'],
  ['month', '30D'],
  ['all', 'ALL'],
];

function HistoryItem({ item, onOpen, canPin, onTogglePin }) {
  const iconMap = { task: 'TSK', journal: 'JNL', match: 'MAT', rank: 'ELO', event: 'EVT', contribution: 'GOAL', item_use: 'USE', money_log: '$', transaction: 'TXN' };
  const timestamp = item.completedAt || item.result?.concludedAt || item.sortAt || item.createdAt;

  const subtitle = item.type === 'task'
    ? `${formatDuration(item.durationMs ?? getTaskDuration(item)) || '—'} · ${getCanonicalTaskPoints(item).toLocaleString()} pts`
    : item.type === 'journal'
      ? `${(item.entry || '').slice(0, 56)}${(item.entry || '').length > 56 ? '…' : ''}`
      : item.type === 'match'
        ? item.description || `${item.duration || 0}h match`
        : item.type === 'rank'
          ? item.description || `${item.rankDelta > 0 ? '+' : ''}${item.rankDelta || 0} ELO`
        : item.type === 'contribution'
          ? `${Number(item.value || item.contribution || 0).toLocaleString()} contribution${item.goalName ? ` · ${item.goalName}` : ''}`
        : item.type === 'item_use'
          ? `Used ${item.name || 'an item'}${item.category ? ` · ${item.category}` : ''}`
          : item.type === 'money_log'
            ? `+$${Number(item.amount || item.cost || 0).toFixed(2)}${item.description ? ` — ${item.description}` : ''}`
            : item.type === 'transaction'
              ? `${item.cost != null ? `$${Number(item.cost).toFixed(2)}` : ''}${item.description ? ` · ${item.description}` : ''}`.trim() || 'Transaction'
              : item.description || item.type;

  const title = item.type === 'item_use'
    ? (item.name || 'Item used')
    : (item.name || item.title || item.description || 'Untitled');

  const handlePinClick = (e) => {
    e.stopPropagation();
    onTogglePin?.(item);
  };

  return (
    <button className={`profile-history-item ${item.pinned ? 'profile-history-item--pinned' : ''}`} onClick={() => onOpen(item)}>
      {canPin && (
        <span
          role="button"
          tabIndex={0}
          className={`profile-history-pin ${item.pinned ? 'profile-history-pin--active' : ''}`}
          onClick={handlePinClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePinClick(e); } }}
          title={item.pinned ? 'Unpin in Daybook' : 'Pin in Daybook'}
          aria-label={item.pinned ? 'Unpin entry' : 'Pin entry'}
        >
          ⚲
        </span>
      )}
      <div className={`profile-history-icon phi-${item.type}`}>{iconMap[item.type] || '—'}</div>
      <div className="profile-history-copy">
        <span className="profile-history-title">{title}</span>
        <span className="profile-history-sub">{subtitle}</span>
      </div>
      <div className="profile-history-time">
        <div>{formatDaybookEntryTime(item.inGameTimestamp)}</div>
        <div>{UTCStringToLocalDate(timestamp)}{timestamp ? ` · ${UTCStringToLocalTime(timestamp)}` : ''}</div>
      </div>
    </button>
  );
}

function PlayerRow({ entry, active, onClick }) {
  const rankPresentation = getPlayerRankPresentation(entry);
  return (
    <button className={`profile-search-row ${active ? 'active' : ''}`} onClick={onClick}>
      <ProfilePicture src={entry.profilePicture} username={entry.username} size={38} />
      <div className="profile-search-copy">
        <div className="profile-search-name">{entry.username || 'Unknown'}</div>
        <div className={`profile-search-rank rank-${rankPresentation.rankClass}`}>
          {rankPresentation.rankLabel}
        </div>
      </div>
      <div className="profile-search-elo">
        {rankPresentation.hasVisibleRating ? rankPresentation.elo : 'UNRATED'}
      </div>
    </button>
  );
}

function scorePlayerSearch(player, rawQuery) {
  const query = rawQuery.trim().toLowerCase();
  const username = String(player?.username || '').trim().toLowerCase();
  if (!query || !username) return -1;
  if (username === query) return 1000;
  if (username.startsWith(query)) return 800 - (username.length - query.length);

  const words = username.split(/\s+/);
  const wordPrefix = words.findIndex((word) => word.startsWith(query));
  if (wordPrefix >= 0) return 650 - wordPrefix * 10;

  const substringIndex = username.indexOf(query);
  if (substringIndex >= 0) return 500 - substringIndex * 4;

  let queryIndex = 0;
  let gapPenalty = 0;
  for (let index = 0; index < username.length && queryIndex < query.length; index += 1) {
    if (username[index] === query[queryIndex]) queryIndex += 1;
    else if (queryIndex > 0) gapPenalty += 1;
  }
  return queryIndex === query.length ? 250 - gapPenalty : -1;
}

function ProfilePlayerSearch({ value, onChange, results, onSelect }) {
  const active = value.trim().length > 0;
  return (
    <div className="profile-global-search">
      <div className="profile-global-search-box">
        <span className="profile-global-search-icon" aria-hidden="true">⌕</span>
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search players"
          aria-label="Search players"
          autoComplete="off"
        />
        {active && (
          <button type="button" onClick={() => onChange('')} aria-label="Clear player search">X</button>
        )}
      </div>
      {active && (
        <div className="profile-global-search-results">
          {results.length === 0 ? (
            <div className="profile-global-search-empty">No matching players.</div>
          ) : results.map((entry) => (
            <PlayerRow
              key={entry.UUID}
              entry={entry}
              active={false}
              onClick={() => onSelect(entry.UUID)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProfileTabs({ activeTab, onChange, access }) {
  const allowed = new Set(access?.allowedTabs || ['overview']);
  const tabs = PROFILE_LOCAL_PAGES.filter((page) => allowed.has(page.id));
  return (
    <LocalSectionNav
      items={tabs}
      value={activeTab}
      onChange={onChange}
      label="Profile sections"
      compact
      className="profile-tabs"
    />
  );
}

function SummaryBand({ stats }) {
  return (
    <div className="profile-summary-band">
      {stats.map((stat) => (
        <div key={stat.id} className={`profile-summary-stat profile-summary-stat--${stat.id}`}>
          <span className="pss-value">{stat.value}</span>
          <span className="pss-label">{stat.label}</span>
        </div>
      ))}
    </div>
  );
}

function buildProfileBackgroundStyle(profileBanner) {
  if (!profileBanner) return {};
  const overlay = 'linear-gradient(rgba(3, 7, 14, 0.46), rgba(3, 7, 14, 0.46))';
  if (profileBanner.type === 'image' && profileBanner.value) {
    return {
      backgroundImage: `${overlay}, url(${profileBanner.value})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  }
  if (profileBanner.type === 'gradient' && profileBanner.value) {
    return {
      backgroundImage: `${overlay}, ${profileBanner.value}`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  }
  if (profileBanner.type === 'color' && profileBanner.value) {
    return {
      backgroundColor: profileBanner.value,
      backgroundImage: overlay,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundAttachment: 'fixed',
    };
  }
  return {};
}

function HighlightGrid({ cards, onOpen }) {
  return (
    <div className="profile-highlight-grid">
      {cards.map((card) => {
        const interactive = !!card.action;
        const className = `profile-highlight-card profile-highlight-card--${card.tone || 'neutral'} ${interactive ? 'profile-highlight-card--interactive' : ''}`;
        if (interactive) {
          return (
            <button key={card.id} type="button" className={className} onClick={() => onOpen(card)}>
              <span className="phc-label">{card.label}</span>
              <strong className="phc-value">{card.value}</strong>
              <span className="phc-detail">{card.detail}</span>
            </button>
          );
        }
        return (
          <div key={card.id} className={className}>
            <span className="phc-label">{card.label}</span>
            <strong className="phc-value">{card.value}</strong>
            <span className="phc-detail">{card.detail}</span>
          </div>
        );
      })}
    </div>
  );
}

function TimelineControls({
  type,
  search,
  sort,
  pinnedOnly,
  onTypeChange,
  onSearchChange,
  onSortChange,
  onPinnedOnlyChange,
}) {
  return (
    <div className="profile-timeline-controls">
      <div className="profile-filter-row">
        {PROFILE_TIMELINE_FILTERS.map((filter) => (
          <button
            key={filter.id}
            type="button"
            className={`profile-filter-chip ${type === filter.id ? 'active' : ''}`}
            onClick={() => onTypeChange(filter.id)}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="profile-timeline-tools">
        <input
          className="profile-search-input profile-timeline-search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search Daybook..."
          aria-label="Search Daybook"
        />
        <button
          type="button"
          className={`profile-toggle-btn ${pinnedOnly ? 'active' : ''}`}
          onClick={() => onPinnedOnlyChange(!pinnedOnly)}
        >
          PINNED
        </button>
        <select className="profile-sort-select" value={sort} onChange={(e) => onSortChange(e.target.value)}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
        </select>
      </div>
    </div>
  );
}

function TimelineGroupList({ groups, currentPlayerUUID, profileUUID, onOpen, onTogglePin }) {
  const { visibleItems, sentinelRef, hasMore } = useProgressiveList(groups, 20);
  if (groups.length === 0) {
    return <div className="profile-empty-row">No timeline entries match these filters.</div>;
  }
  return (
    <div className="profile-timeline-groups">
      {visibleItems.map((group) => (
        <div key={group.key} className="profile-timeline-group">
          <div className="profile-timeline-group-label">{group.label}</div>
          <div className="profile-timeline-list">
            {group.entries.map((item) => {
              const ownsEntry = item.parent && currentPlayerUUID && item.parent === currentPlayerUUID;
              const onOwnProfile = profileUUID === currentPlayerUUID;
              const canPin = item.type === 'journal' && ownsEntry && onOwnProfile;
              return (
                <HistoryItem
                  key={`${item.type}-${item.UUID}`}
                  item={item}
                  onOpen={onOpen}
                  canPin={canPin}
                  onTogglePin={onTogglePin}
                />
              );
            })}
          </div>
        </div>
      ))}
      {hasMore && <div ref={sentinelRef} className="profile-list-sentinel">Loading more activity.</div>}
    </div>
  );
}

function DaybookChapterList({
  chapters,
  currentPlayerUUID,
  profileUUID,
  onOpen,
  onTogglePin,
  hasMore = false,
  loading = false,
  sort = 'newest',
  onLoadMore,
}) {
  if (!chapters.length) {
    return (
      <div className="profile-empty-row">
        {loading ? 'Loading Daybook activity…' : 'No Daybook activity matches these filters at the viewer IGT.'}
      </div>
    );
  }
  return (
    <div className="profile-daybook" aria-label="Profile Daybook">
      {chapters.map((chapter) => {
        const wallStart = UTCStringToLocalDate(chapter.wallStartedAt);
        const wallEnd = UTCStringToLocalDate(chapter.wallEndedAt);
        const wallProvenance = wallStart && wallEnd && wallStart !== wallEnd
          ? `${wallStart} – ${wallEnd}`
          : wallStart;
        const totalFacts = [
          `${Math.round(chapter.totals.points).toLocaleString()} pts`,
          `${formatDuration(chapter.totals.activeMs) || '0m'} focused`,
          `${chapter.totals.tasks} task${chapter.totals.tasks === 1 ? '' : 's'}`,
          chapter.totals.matches
            ? `${chapter.totals.matches} Match${chapter.totals.matches === 1 ? '' : 'es'}`
            : null,
          chapter.totals.dojoSessions
            ? `${chapter.totals.dojoSessions} Dojo session${chapter.totals.dojoSessions === 1 ? '' : 's'}`
            : null,
          chapter.totals.contribution
            ? `${Math.round(chapter.totals.contribution).toLocaleString()} contribution`
            : null,
        ].filter(Boolean);
        const deltaFacts = [
          chapter.deltas?.tasks ? `${chapter.deltas.tasks > 0 ? '+' : ''}${chapter.deltas.tasks} tasks vs prior day` : null,
          chapter.deltas?.points ? `${chapter.deltas.points > 0 ? '+' : ''}${Math.round(chapter.deltas.points)} pts vs prior day` : null,
          chapter.deltas?.rank ? `${chapter.deltas.rank > 0 ? '+' : ''}${Math.round(chapter.deltas.rank)} ELO` : null,
        ].filter(Boolean);
        return (
          <section
            key={chapter.key}
            className={`profile-daybook-chapter profile-daybook-chapter--${chapter.status}`}
          >
            <header className="profile-daybook-chapter-header">
              <div className="profile-daybook-chapter-heading">
                <span>DAY {chapter.dayNumber}</span>
                <strong>{chapter.label}</strong>
                <small>{chapter.status === 'active' ? 'In progress at viewer IGT' : 'Completed day'}</small>
                {wallProvenance && <time>{wallProvenance}</time>}
              </div>
              <div className="profile-daybook-totals" aria-label={`Day ${chapter.dayNumber} totals`}>
                {totalFacts.map((fact) => <span key={fact}>{fact}</span>)}
              </div>
              {(chapter.threadReferences?.length > 0 || deltaFacts.length > 0) && (
                <div className="profile-daybook-trajectory" aria-label={`Day ${chapter.dayNumber} trajectory`}>
                  {chapter.threadReferences?.map((thread) => (
                    <span key={thread.projectId} data-state={thread.state}>
                      <strong>{thread.label}</strong><small>{thread.state} · {thread.evidenceCount} fact{thread.evidenceCount === 1 ? '' : 's'}</small>
                    </span>
                  ))}
                  {deltaFacts.map((fact) => <em key={fact}>{fact}</em>)}
                </div>
              )}
            </header>
            <div className="profile-timeline-list profile-daybook-entry-list">
              {chapter.entries.map((item) => {
                const ownsEntry = item.parent && currentPlayerUUID && item.parent === currentPlayerUUID;
                const onOwnProfile = profileUUID === currentPlayerUUID;
                const canPin = item.type === 'journal' && ownsEntry && onOwnProfile;
                return (
                  <HistoryItem
                    key={`${item.type}-${item.UUID}`}
                    item={item}
                    onOpen={onOpen}
                    canPin={canPin}
                    onTogglePin={onTogglePin}
                  />
                );
              })}
            </div>
          </section>
        );
      })}
      {hasMore && (
        <button
          type="button"
          className="profile-daybook-load-more"
          onClick={onLoadMore}
          disabled={loading}
        >
          {loading ? 'Loading Daybook…' : sort === 'oldest' ? 'Load later days' : 'Load earlier days'}
        </button>
      )}
    </div>
  );
}

function ProfilePresenceSummary({ presence }) {
  if (!presence?.presentation) return null;
  const view = presence.presentation;
  return (
    <section className={`profile-presence-summary profile-presence-summary--${view.state}`} aria-label="Semantic presence">
      <div className="profile-presence-summary__state">
        <span>{view.statusLabel}</span>
        {presence.paused && <strong>PAUSED</strong>}
      </div>
      <div className="profile-presence-summary__copy">
        <strong>{view.primary}</strong>
        {view.secondary && <span>{view.secondary}</span>}
      </div>
    </section>
  );
}

const TIMELINE_MODES = [
  ['activity', 'Daybook'],
  ['milestones', 'Milestones'],
  ['replay', 'Replay'],
];

function TimelineModeTabs({ value, onChange }) {
  return (
    <div className="profile-timeline-mode-tabs" role="tablist" aria-label="Daybook view">
      {TIMELINE_MODES.map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={value === id}
          className={value === id ? 'active' : ''}
          onClick={() => onChange(id)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function MilestoneList({ milestones, arc }) {
  return (
    <div className="profile-biography">
      <section className={`profile-arc-card profile-arc-card--${arc.type}`}>
        <span>Recent pattern</span>
        <strong>{arc.title}</strong>
        <p>{arc.description}</p>
      </section>
      {milestones.length === 0 ? (
        <div className="profile-empty-row">More history is needed before milestones appear.</div>
      ) : (
        <div className="profile-milestone-list">
          {[...milestones].reverse().map((entry) => (
            <article key={entry.id} className={`profile-milestone profile-milestone--${entry.tone || 'neutral'}`}>
              <div className="profile-milestone-marker" aria-hidden="true" />
              <div className="profile-milestone-copy">
                <span>{entry.type.replace(/([a-z])([A-Z])/g, '$1 $2')}</span>
                <strong>{entry.title}</strong>
                <p>{entry.description}</p>
              </div>
              <time>{UTCStringToLocalDate(entry.at)}</time>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ReplayPanel({ snapshot, replayIGT, maxIGT, loading, milestones, onChange }) {
  const summary = snapshot?.summary;
  const replayMilestones = snapshot?.milestones || milestones.filter((entry) => (
    !Number.isFinite(Number(entry.inGameTimestamp)) || Number(entry.inGameTimestamp) <= replayIGT
  ));
  const rangeMax = Math.max(1, Number(maxIGT) || 1);
  const sliderStep = Math.max(1, Math.min(60 * 60 * 1000, Math.floor(rangeMax / 120) || 1));
  const commitReplayIGT = (value) => onChange(Math.min(rangeMax, Math.max(0, Number(value) || 0)));
  const handleReplayKeyDown = (event) => {
    const current = Number(event.currentTarget.value) || 0;
    const pageStep = sliderStep * 5;
    if (event.key === 'Home') {
      event.preventDefault();
      commitReplayIGT(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      commitReplayIGT(rangeMax);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') {
      event.preventDefault();
      commitReplayIGT(current - sliderStep);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') {
      event.preventDefault();
      commitReplayIGT(current + sliderStep);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      commitReplayIGT(current - pageStep);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      commitReplayIGT(current + pageStep);
    }
  };
  const replayEntries = [
    ...(snapshot?.tasks || []).filter((entry) => entry.completedAt).map((entry) => ({
      id: entry.UUID,
      type: 'Task',
      title: entry.name || 'Completed task',
      meta: `${Math.floor(Number(entry.pointsBase ?? entry.points) || 0).toLocaleString()} pts`,
      at: entry.completedAt || entry.createdAt,
    })),
    ...(snapshot?.journals || []).map((entry) => ({
      id: entry.UUID,
      type: 'Post',
      title: entry.title || String(entry.entry || 'Journal entry').slice(0, 48),
      meta: (entry.tags || []).slice(0, 2).join(' ') || 'Journal',
      at: entry.createdAt,
    })),
    ...(snapshot?.matches || []).filter((entry) => entry.status !== 'active').map((entry) => ({
      id: entry.UUID,
      type: 'Match',
      title: getProfileMatchOutcome(entry, snapshot?.player?.UUID) === 'win' ? 'Match won' : 'Match recorded',
      meta: `${entry.duration || 0}h match`,
      at: entry.result?.concludedAt || entry.createdAt,
    })),
    ...(snapshot?.events || []).map((entry) => ({
      id: entry.UUID,
      type: 'Event',
      title: entry.name || entry.type || 'Event',
      meta: entry.type || 'Event',
      at: entry.createdAt,
    })),
  ]
    .filter((entry) => entry.at)
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')))
    .slice(0, 10);
  const summaryRank = getPlayerRankPresentation(summary || {});
  const stats = summary ? [
    ['RANK', summaryRank.rankLabel],
    ['ELO', summaryRank.hasVisibleRating ? Math.round(summaryRank.elo).toLocaleString() : 'Unrated'],
    ['RECORD', `${summary.wins}-${summary.losses}`],
    ['TASKS', summary.tasks.toLocaleString()],
    ['POSTS', summary.journals.toLocaleString()],
    ['MILESTONES', replayMilestones.length.toLocaleString()],
  ] : [];

  return (
    <div className="profile-replay">
      <div className="profile-replay-control">
        <div>
          <span>PROFILE AS OF</span>
          <strong>{formatInGameTime(replayIGT)}</strong>
        </div>
        <input
          type="range"
          min="0"
          max={rangeMax}
          step={sliderStep}
          value={Math.min(replayIGT, rangeMax)}
          onChange={(event) => commitReplayIGT(event.target.value)}
          onKeyDown={handleReplayKeyDown}
          aria-label="Replay profile history"
        />
      </div>
      <p className="profile-replay-note">
        Activity, ELO, rank, and economy are historical. Identity, picture, and cosmetics use the current profile state.
      </p>
      {loading && <div className="profile-empty-row">Loading profile history.</div>}
      {!loading && summary && (
        <>
          <div className="profile-replay-stats">
            {stats.map(([label, value]) => (
              <div key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
          <div className="profile-replay-economy">
            <div><span>Tokens earned</span><strong>{Math.round(summary.earned).toLocaleString()}</strong></div>
            <div><span>Tokens spent</span><strong>{Math.round(summary.spent).toLocaleString()}</strong></div>
            <div className="profile-replay-contribution">
              <ContributionIcon size={16} />
              <span>Contribution</span>
              <strong>{Math.round(summary.contribution).toLocaleString()}</strong>
            </div>
          </div>
          <div className="profile-replay-history">
            {replayEntries.length ? replayEntries.map((entry) => (
              <article key={`${entry.type}-${entry.id}`} className="profile-replay-history-row">
                <span>{entry.type}</span>
                <strong>{entry.title}</strong>
                <small>{entry.meta} · {UTCStringToLocalDate(entry.at)}</small>
              </article>
            )) : (
              <div className="profile-empty-row">No visible history at this point.</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function MatchSummaryBand({ summary }) {
  const stats = [
    ['Record', `${summary.wins}-${summary.losses}`],
    ['Win rate', `${summary.winRate}%`],
    ['Total ELO', `${summary.totalEloChange > 0 ? '+' : ''}${summary.totalEloChange}`],
  ];
  return (
    <div className="profile-match-summary-band">
      {stats.map(([label, value]) => (
        <div key={label} className="profile-match-summary-stat">
          <span>{value}</span>
          <small>{label}</small>
        </div>
      ))}
    </div>
  );
}

function MatchList({ matches, profileUUID, onOpen }) {
  const { visibleItems, sentinelRef, hasMore } = useProgressiveList(matches, 20);
  if (matches.length === 0) return <div className="profile-empty-row">No matches recorded.</div>;
  return (
    <div className="profile-match-list profile-match-list--full">
      {visibleItems.map((match) => {
        const outcome = getProfileMatchOutcome(match, profileUUID);
        const eloChange = match.result?.eloChange;
        return (
          <button key={match.UUID} className="profile-match-row" onClick={() => onOpen(match)}>
            <span className={`pmr-result ${outcome}`}>{outcome.toUpperCase()}</span>
            <span className="pmr-info">
              {match.duration || 0}h match
              {eloChange != null && (
                <span className={`pmr-elo ${eloChange > 0 ? 'is-positive' : eloChange < 0 ? 'is-negative' : ''}`}>
                  {eloChange > 0 ? '+' : ''}{eloChange} ELO
                </span>
              )}
            </span>
            <span className="pmr-date">{UTCStringToLocalDate(match.createdAt)}</span>
          </button>
        );
      })}
      {hasMore && <div ref={sentinelRef} className="profile-list-sentinel">Loading more matches.</div>}
    </div>
  );
}

/* ── Inline Profile Banner Editor ───────────────────────── */
function ProfileBannerEditor({ current, databaseConnection, ownerUUID, onSave, onClose }) {
  const [type, setType]     = useState(current?.type || 'gradient');
  const [value, setValue]   = useState(current?.value || BANNER_GRADIENTS[0].value);
  const [colorVal, setColorVal] = useState(current?.type === 'color' ? current.value : '#0d1b2a');
  const imageUrl = useResourceUrl(type === 'image' ? value : null, databaseConnection);

  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const resource = await findOrCreateResource(databaseConnection, file, {
      parent: ownerUUID,
      kind: 'banner',
      usedBy: [{ store: STORES.player, UUID: ownerUUID, field: 'activeCosmetics.profileBanner' }],
    });
    setValue(resource);
    e.target.value = '';
  };

  const handleSave = () => {
    if (type === 'gradient') onSave({ type: 'gradient', value });
    else if (type === 'color') onSave({ type: 'color', value: colorVal });
    else if (type === 'image' && value) onSave({ type: 'image', value });
  };

  const previewStyle = type === 'gradient' ? { background: value }
    : type === 'color' ? { background: colorVal }
    : type === 'image' && imageUrl ? { backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {};

  return (
    <ModalFrame
      onClose={onClose}
      title="Profile banner"
      subtitle="Choose a gradient, color, or image."
      eyebrow="Customization"
      size="lg"
      accent="var(--color-profile)"
      className="profile-banner-editor"
      footer={(
        <ActionRow>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" onClick={handleSave}>Apply banner</button>
        </ActionRow>
      )}
    >
        <div className="pbe-body">
          <div className="pbe-type-row">
            {['gradient', 'color', 'image'].map((t) => (
              <button key={t} className={`pbe-type-btn ${type === t ? 'active' : ''}`} onClick={() => setType(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {type === 'gradient' && (
            <div className="pbe-gradient-grid">
              {BANNER_GRADIENTS.map((g) => (
                <button key={g.id}
                  className={`pbe-gradient-chip ${value === g.value ? 'selected' : ''}`}
                  style={{ background: g.value }}
                  onClick={() => setValue(g.value)}
                  title={g.label}
                />
              ))}
            </div>
          )}

          {type === 'color' && (
            <div className="pbe-color-grid">
              {['#0d1b2a','#1a0507','#0a1a0d','#09090f','#1a0800','#1a1a2e','#100840','#1a1040'].map((c) => (
                <button key={c}
                  className={`pbe-color-chip ${colorVal === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColorVal(c)}
                />
              ))}
              <input type="color" value={colorVal} onChange={(e) => setColorVal(e.target.value)}
                className="pbe-color-custom" title="Custom color" />
            </div>
          )}

          {type === 'image' && (
            <div className="pbe-image-row">
              <input type="file" accept="image/*" id="profile-banner-upload" style={{ display: 'none' }}
                onChange={handleImageUpload} />
              <label htmlFor="profile-banner-upload" className="pbe-upload-label">Choose image</label>
              {imageUrl && type === 'image' && (
                <div className="pbe-image-thumb" style={{ backgroundImage: `url(${imageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
              )}
            </div>
          )}

          <div className="pbe-preview" style={previewStyle}>
            <div className="pbe-preview-overlay" />
            <span className="pbe-preview-name">Your Name</span>
          </div>
        </div>
    </ModalFrame>
  );
}

function ProfileAchievementShelf({ player, allPlayersForRarity, onOpenAchievements, compact = false }) {
  const earnedKeys = Object.keys(player.achievements || {});
  const shelf = [
    ...(player.selectedAchievementsV2 || []),
    ...(player.selectedAchievements || []),
    ...earnedKeys,
  ]
    .filter(Boolean)
    .filter((key, index, arr) => arr.indexOf(key) === index)
    .slice(0, compact ? 3 : 8);

  return (
    <button
      type="button"
      className="profile-skin-achievement-shelf"
      onClick={onOpenAchievements}
      disabled={!onOpenAchievements}
    >
      {shelf.length === 0 ? (
        <span className="profile-empty-row">No earned achievements yet.</span>
      ) : shelf.map((key) => {
        const rarityPct = computeRarity(key, allPlayersForRarity);
        return (
          <AchievementBadge
            key={key}
            achievementKey={key}
            size={compact ? 30 : 42}
            rarity={getRarityLabel(rarityPct)}
            showTooltip
            className="profile-shelf-badge"
          />
        );
      })}
    </button>
  );
}

function ProfileRecentActivity({ entries, currentPlayerUUID, profileUUID, onOpen, onTogglePin, onViewTimeline }) {
  return (
    <div className="profile-skin-activity-list">
      {entries.length === 0 ? (
        <div className="profile-empty-row">No profile activity yet.</div>
      ) : entries.map((item) => {
        const ownsEntry = item.parent && currentPlayerUUID && item.parent === currentPlayerUUID;
        const onOwnProfile = profileUUID === currentPlayerUUID;
        const canPin = item.type === 'journal' && ownsEntry && onOwnProfile;
        return (
          <HistoryItem
            key={`${item.type}-${item.UUID}`}
            item={item}
            onOpen={onOpen}
            canPin={canPin}
            onTogglePin={onTogglePin}
          />
        );
      })}
      {onViewTimeline && (
        <button type="button" className="profile-skin-text-button" onClick={onViewTimeline}>
          VIEW DAYBOOK
        </button>
      )}
    </div>
  );
}

function GoalContributionDonut({ rows, total }) {
  if (!rows.length || total <= 0) {
    return <div className="profile-contribution-empty">No Goal Contribution yet. Complete a task assigned to a Goal to start this chart.</div>;
  }

  const displayRows = rows.length > 6
    ? [
      ...rows.slice(0, 5),
      {
        goalUUID: '__other__',
        name: 'Other',
        value: rows.slice(5).reduce((sum, row) => sum + row.value, 0),
        color: '#64748b',
      },
    ]
    : rows;
  let cursor = 0;
  const stops = displayRows.map((row) => {
    const start = cursor;
    cursor += (row.value / total) * 100;
    return `${row.color} ${start}% ${cursor}%`;
  });

  return (
    <div className="profile-contribution-chart">
      <div className="profile-contribution-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }}>
        <div>
          <strong>{total.toLocaleString()}</strong>
          <span>Contribution</span>
        </div>
      </div>
      <div className="profile-contribution-legend">
        {displayRows.map((row) => (
          <div key={row.goalUUID}>
            <i style={{ background: row.color }} />
            <span>{row.name}</span>
            <strong>{Math.round((row.value / total) * 100)}%</strong>
            <b>{row.value}</b>
          </div>
        ))}
      </div>
    </div>
  );
}

function ProfileSkinView({
  player,
  prefs,
  profileView,
  recentTimelineEntries,
  allPlayersForRarity,
  elo,
  rankLabel,
  hasVisibleRating,
  viewerIGT,
  currentPlayerUUID,
  onOpenHistoryItem,
  onTogglePin,
  onOpenHighlight,
  onOpenAchievements,
  onViewTimeline,
  isEditing = false,
  draggedBlockId,
  resizingBlockId,
  onDragStart,
  onDragEnd,
  onDropBlock,
  onMoveBlock,
  onResizeStart,
  onUpdateTextBlock,
  onRemoveBlock,
  contributionDistribution,
  totalContribution,
  lifeContext,
}) {
  const skin = getProfileSkin(prefs.skin);
  const blocks = prefs.blocks || [];

  const renderBlockContent = (block) => {
    if (block.type === 'lifeContext') return lifeContext || (
      <div className="profile-empty-row">No life context is visible for this relationship.</div>
    );
    if (block.type === 'text') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>{block.title || 'Text Block'}</span>
            <small>{player.username}</small>
          </div>
          {block.content
            ? <MarkdownEditor value={block.content} readOnly className="profile-skin-about" />
            : <div className="profile-empty-row">This text block is empty.</div>
          }
        </>
      );
    }
    if (block.type === 'stats') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Career Snapshot</span>
            <small>{hasVisibleRating ? `${elo} ELO` : 'Current Elo: Unrated'}</small>
          </div>
          <SummaryBand stats={profileView.summaryStats} />
        </>
      );
    }
    if (block.type === 'achievements') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Achievement Shelf</span>
            <small>Selected and earned</small>
          </div>
          <ProfileAchievementShelf
            player={player}
            allPlayersForRarity={allPlayersForRarity}
            onOpenAchievements={onOpenAchievements}
            compact={!onOpenAchievements}
          />
        </>
      );
    }
    if (block.type === 'activity') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Recent Activity</span>
            <small>Latest profile activity</small>
          </div>
          <ProfileRecentActivity
            entries={recentTimelineEntries}
            currentPlayerUUID={currentPlayerUUID}
            profileUUID={player.UUID}
            onOpen={onOpenHistoryItem}
            onTogglePin={onTogglePin}
            onViewTimeline={onViewTimeline}
          />
        </>
      );
    }
    if (block.type === 'rankGraph') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Rank Trend</span>
            <small>{rankLabel}</small>
          </div>
          <EloChart
            data={profileView.eloSeries}
            viewerIGT={viewerIGT}
            timeBasis="igt"
            spans={PROFILE_ELO_SPANS}
            initialSpan="all"
            emptyMessage={profileView.eloNote || 'Play completed matches to build an ELO graph.'}
            className="profile-elo-chart"
          />
        </>
      );
    }
    if (block.type === 'highlights') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Highlights</span>
            <small>Recent highlights</small>
          </div>
          <HighlightGrid cards={profileView.highlightCards} onOpen={onOpenHighlight} />
        </>
      );
    }
    if (block.type === 'goalContribution') {
      return (
        <>
          <div className="profile-skin-section-head">
            <span>Contribution by Goal</span>
            <small>{totalContribution.toLocaleString()} total</small>
          </div>
          <GoalContributionDonut rows={contributionDistribution} total={totalContribution} />
        </>
      );
    }
    return null;
  };

  return (
    <div className={`profile-skin-view profile-skin-view--${skin.id} profile-skin-view--${skin.layout} ${isEditing ? 'is-editing' : ''}`}>
      {blocks.map((block, index) => {
        const definition = getProfileBlockDefinition(block.type);
        return (
          <section
            key={block.id}
            className={`profile-skin-panel profile-block profile-block--${block.type} ${isEditing && block.type === 'text' ? 'profile-block--editable-text' : ''} ${draggedBlockId === block.id ? 'is-dragging' : ''} ${resizingBlockId === block.id ? 'is-resizing' : ''}`}
            style={{
              '--profile-block-columns': block.columns,
              '--profile-block-height': `${block.height}px`,
            }}
            onDragOver={(event) => { if (isEditing) event.preventDefault(); }}
            onDrop={(event) => { event.preventDefault(); onDropBlock?.(block.id); }}
          >
            {isEditing && block.type === 'text' ? (
              <div className="profile-block-text-inline-editor">
                <div className="profile-block-inline-toolbar">
                  <span
                    className="profile-block-drag-handle"
                    draggable
                    onDragStart={(event) => onDragStart?.(event, block.id)}
                    onDragEnd={() => onDragEnd?.()}
                    aria-label="Drag text block"
                    role="button"
                    tabIndex={0}
                  >
                    ::::
                  </span>
                  <div className="profile-block-edit-actions">
                    <button type="button" onClick={() => onMoveBlock?.(block.id, -1)} disabled={index === 0} aria-label="Move block earlier">↑</button>
                    <button type="button" onClick={() => onMoveBlock?.(block.id, 1)} disabled={index === blocks.length - 1} aria-label="Move block later">↓</button>
                    <button type="button" className="danger" onClick={() => onRemoveBlock?.(block.id)}>REMOVE</button>
                  </div>
                </div>
                <input
                  className="profile-block-title-input"
                  value={block.title}
                  onChange={(event) => onUpdateTextBlock?.(block.id, { title: event.target.value })}
                  placeholder="Block title"
                  aria-label="Text block title"
                />
                <textarea
                  className="profile-block-content-input"
                  value={block.content}
                  onChange={(event) => onUpdateTextBlock?.(block.id, { content: event.target.value })}
                  placeholder="Write something for your profile..."
                  aria-label="Text block content"
                />
              </div>
            ) : isEditing ? (
              <div className="profile-block-edit-shell">
                <span
                  className="profile-block-drag-handle"
                  draggable
                  onDragStart={(event) => onDragStart?.(event, block.id)}
                  onDragEnd={() => onDragEnd?.()}
                  aria-label={`Drag ${definition?.label || block.type}`}
                  role="button"
                  tabIndex={0}
                >
                  ::::
                </span>
                <strong>{definition?.label || block.type}</strong>
                <div className="profile-block-edit-actions">
                  <button type="button" onClick={() => onMoveBlock?.(block.id, -1)} disabled={index === 0} aria-label="Move block earlier">↑</button>
                  <button type="button" onClick={() => onMoveBlock?.(block.id, 1)} disabled={index === blocks.length - 1} aria-label="Move block later">↓</button>
                  <button type="button" className="danger" onClick={() => onRemoveBlock?.(block.id)}>REMOVE</button>
                </div>
              </div>
            ) : renderBlockContent(block)}
            {isEditing && ['nw', 'ne', 'sw', 'se'].map((corner) => (
              <button
                key={corner}
                type="button"
                className={`profile-block-resize-handle profile-block-resize-handle--${corner}`}
                onPointerDown={(event) => onResizeStart?.(event, block.id, corner)}
                aria-label={`Resize ${definition?.label || block.type} from ${corner} corner`}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

function ProfileBlockComposer({
  prefs,
  ownedCosmeticIds,
  isEditing,
  isAddOpen,
  hasChanges,
  saving,
  onToggleEditing,
  onToggleAdd,
  onCloseAdd,
  onSave,
  onAdd,
}) {
  const usedTypes = new Set((prefs.blocks || []).map((block) => block.type));
  const editButtonLabel = hasChanges
    ? 'Save profile layout changes'
    : isEditing
      ? 'Exit profile layout edit mode'
      : 'Edit profile layout';

  return (
    <>
      <div className="profile-block-fab-stack" aria-label="Profile layout controls">
        <button
          type="button"
          className={`profile-block-fab profile-block-fab--add ${isAddOpen ? 'is-open' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleAdd}
          aria-expanded={isAddOpen}
          aria-label={isAddOpen ? 'Close add block menu' : 'Add profile block'}
          title={isAddOpen ? 'Close add block menu' : 'Add profile block'}
        >
          <Icon name={isAddOpen ? 'close' : 'add'} size={22} />
        </button>
        <button
          type="button"
          className={`profile-block-fab profile-block-fab--edit ${isEditing || hasChanges ? 'is-open' : ''} ${hasChanges ? 'has-changes' : ''}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={hasChanges ? onSave : onToggleEditing}
          disabled={saving}
          aria-pressed={isEditing}
          aria-label={editButtonLabel}
          title={editButtonLabel}
        >
          <Icon name={hasChanges ? 'check' : 'settings'} size={22} />
        </button>
      </div>
      <DrawerFrame
        open={isAddOpen}
        title="Add profile block"
        subtitle="Choose a block to add. Editing stays available on the profile itself."
        eyebrow="Customization"
        accent="var(--color-profile)"
        onClose={onCloseAdd}
        className="profile-block-drawer"
        modal={false}
        autoFocus={false}
      >
          <div className="profile-block-catalog">
            {PROFILE_BLOCK_DEFINITIONS
              .filter((definition) => definition.type === 'text' || !usedTypes.has(definition.type))
              .map((definition) => {
                const unlocked = isProfileBlockUnlocked(definition.type, ownedCosmeticIds);
                return (
                  <button
                    key={definition.type}
                    type="button"
                    className="profile-block-catalog-item"
                    onClick={() => onAdd(definition.type)}
                    disabled={!unlocked}
                  >
                    <span>
                      <strong>{definition.label}</strong>
                      <small>{definition.description}</small>
                    </span>
                    <b>{unlocked ? 'Add' : 'Pass'}</b>
                  </button>
                );
              })}
          </div>
      </DrawerFrame>
    </>
  );
}

function ProfileThemeCustomizer({
  prefs,
  ownedCosmeticIds,
  hasBannerPass,
  onChange,
  onEditBanner,
}) {
  const updateDraft = (patch) => {
    onChange(normalizeProfilePersonalization({ ...prefs, ...patch }));
  };
  return (
    <div className="profile-tab-panel profile-customizer">
      <section className="profile-panel profile-customizer-section profile-customizer-section--identity">
        <div className="profile-panel-header">
          <div>
            <span className="profile-card-title">IDENTITY</span>
            <p className="profile-panel-sub">Keep a short headline beneath your player name.</p>
          </div>
        </div>
        <div className="profile-form-grid">
          <label>Headline<input value={prefs.tagline} onChange={(e) => updateDraft({ tagline: e.target.value })} placeholder="Short page headline" /></label>
        </div>
      </section>

      <section className="profile-panel profile-customizer-section profile-customizer-section--cosmetics">
        <div className="profile-panel-header">
          <div>
            <span className="profile-card-title">APPEARANCE PRESETS</span>
            <p className="profile-panel-sub">Profile theme, layout, backdrop, and avatar frame are independent. Use Appearance below to combine owned Road presets; profile blocks remain on Overview.</p>
          </div>
        </div>
      </section>
    </div>
  );
}
export { ProfileBannerEditor, ProfileBlockComposer, ProfilePlayerSearch, ProfileSkinView, ProfileTabs, ProfileThemeCustomizer, PlayerRow, TimelineControls, TimelineGroupList, DaybookChapterList, ProfilePresenceSummary, TimelineModeTabs, MilestoneList, ReplayPanel, MatchSummaryBand, MatchList, buildProfileBackgroundStyle, scorePlayerSearch };
