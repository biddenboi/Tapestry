import './AchievementsModal.css';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ACHIEVEMENT_GROUPS, ACHIEVEMENT_MAP, computeRarity, getRarityLabel, TOTAL_PAID_COSMETICS, getAchievementByKey } from '../../utils/Achievements.js';
import { STORES, COSMETIC_THEMES, COSMETIC_FONTS, COSMETIC_PASSES } from '../../utils/Constants.js';

/* ─── Progress computation for quantitative achievements ──── */
function getAchievementProgress(groupId, tier, playerData) {
  const { tasks = [], journals = [], events = [], matches = [], friends = [], inventory = [], allPlayers = [] } = playerData;
  const { playerUUID } = playerData;

  switch (groupId) {
    case 'overkill': {
      const thresholds = [300, 500, 1000];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const best = Math.max(0, ...matches
        .filter((m) => {
          if (m.status !== 'complete' || !m.result) return false;
          const t1 = m.teams?.[0] || [];
          const onT1 = t1.some((p) => String(p.UUID) === String(playerUUID));
          const winner = m.result.winner;
          const won = (winner === 1 && onT1) || (winner === 2 && !onT1);
          if (!won) return false;
          const diff = Math.abs((m.result.team1Total || 0) - (m.result.team2Total || 0));
          return diff;
        })
        .map((m) => Math.abs((m.result.team1Total || 0) - (m.result.team2Total || 0)))
      );
      return { value: Math.min(best, max), max };
    }
    case 'soldier': {
      const thresholds = [2, 3, 5, 10, 100];
      const max = thresholds[tier - 1];
      if (!max) return null;
      // Count current win streak
      const sorted = [...matches]
        .filter((m) => m.status === 'complete' && m.result)
        .sort((a, b) => String(b.result?.concludedAt || b.createdAt || '').localeCompare(String(a.result?.concludedAt || a.createdAt || '')));
      let streak = 0;
      for (const m of sorted) {
        const t1 = m.teams?.[0] || [];
        const onT1 = t1.some((p) => String(p.UUID) === String(playerUUID));
        const won = (m.result.winner === 1 && onT1) || (m.result.winner === 2 && !onT1);
        if (won) streak++;
        else break;
      }
      return { value: Math.min(streak, max), max };
    }
    case 'long_game': {
      const thresholds = [10, 100];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const count = matches.filter((m) => m.status === 'complete').length;
      return { value: Math.min(count, max), max };
    }
    case 'basket': {
      const thresholds = [10, 100, 1000];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const count =
        tasks.filter((t) => t.parent === playerUUID && t.completedAt).length +
        journals.filter((j) => j.parent === playerUUID).length +
        events.filter((e) => e.parent === playerUUID).length;
      return { value: Math.min(count, max), max };
    }
    case 'hobbyist': {
      const thresholds = [Math.ceil(TOTAL_PAID_COSMETICS * 0.25), Math.ceil(TOTAL_PAID_COSMETICS * 0.50), TOTAL_PAID_COSMETICS];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const cosTypes = new Set(['cosmetic_theme','cosmetic_font','cosmetic_card_banner','cosmetic_profile_banner','cosmetic_lobby_banner']);
      const ownedIds = new Set(inventory.filter((i) => cosTypes.has(i.type)).map((i) => i.itemId || i.name));
      return { value: Math.min(ownedIds.size, max), max };
    }
    case 'scholar': {
      const thresholds = [10, 20];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const myTasks = tasks.filter((t) => t.parent === playerUUID && t.completedAt);
      const byDay = {};
      for (const t of myTasks) {
        const day = t.completedAt.split('T')[0];
        byDay[day] = (byDay[day] || 0) + 1;
      }
      const best = Math.max(0, ...Object.values(byDay));
      return { value: Math.min(best, max), max };
    }
    case 'legacy': {
      const thresholds = [1000, 10000];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const myJournals = journals.filter((j) => j.parent === playerUUID);
      const best = Math.max(0, ...myJournals.map((j) => (j.entry || '').trim().split(/\s+/).filter(Boolean).length));
      return { value: Math.min(best, max), max };
    }
    case 'town': {
      const thresholds = [5, 10, 20];
      const max = thresholds[tier - 1];
      if (!max) return null;
      const count = friends.filter((f) => f.status === 'accepted').length;
      return { value: Math.min(count, max), max };
    }
    case 'king_of_the_hill': {
      // Not really quantitative, but show lifetime pts vs top
      const myPts = tasks.filter((t) => t.parent === playerUUID && t.completedAt).reduce((s, t) => s + Number(t.points || 0), 0);
      const allPts = allPlayers.map((p) =>
        tasks.filter((t) => t.parent === p.UUID && t.completedAt).reduce((s, t) => s + Number(t.points || 0), 0)
      );
      const topPts = Math.max(...allPts, 1);
      return tier === 2 ? { value: myPts, max: topPts } : null;
    }
    default:
      return null;
  }
}

/* ─── Single achievement row in the list ─────────────────── */
function AchievementRow({ groupId, tier, label, desc, icon, color, isEarned, progress, rarityPct, isHovered, onHover, onLeave }) {
  const rarity = getRarityLabel(rarityPct);

  return (
    <div
      className={`ach-modal-row ${isEarned ? 'ach-modal-row--earned' : 'ach-modal-row--locked'} ${isHovered ? 'ach-modal-row--hovered' : ''}`}
      style={{ '--ach-color': color }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      {/* Icon */}
      <div className="ach-modal-row-icon">
        <span
          className="ach-modal-row-svg"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: icon }}
        />
        {!isEarned && <div className="ach-modal-row-lock">🔒</div>}
      </div>

      {/* Text */}
      <div className="ach-modal-row-body">
        <div className="ach-modal-row-name">
          <span>{label}</span>
          <span className="ach-modal-row-rarity" style={{ color: rarity.color }}>{rarity.label}</span>
        </div>
        <div className="ach-modal-row-desc">{desc}</div>

        {/* Progress bar (quantitative) */}
        {progress && !isEarned && (
          <div className="ach-modal-row-progress">
            <div className="ach-modal-progress-track">
              <div
                className="ach-modal-progress-fill"
                style={{
                  width: `${Math.min(100, (progress.value / progress.max) * 100)}%`,
                  background: color,
                }}
              />
            </div>
            <span className="ach-modal-progress-label">
              {progress.value.toLocaleString()} / {progress.max.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      {/* Earned checkmark */}
      {isEarned && <div className="ach-modal-row-check">✓</div>}
    </div>
  );
}

/* ─── Selected achievement slot in footer ─────────────────── */
function SelectedSlot({ achievementKey, onRemove, shaking }) {
  const a = achievementKey ? getAchievementByKey(achievementKey) : null;

  return (
    <div
      className={`ach-modal-slot ${a ? 'ach-modal-slot--filled' : 'ach-modal-slot--empty'} ${shaking ? 'ach-modal-slot--shake' : ''}`}
      style={a ? { '--ach-color': a.color } : {}}
      onClick={a ? onRemove : undefined}
      role={a ? 'button' : undefined}
      tabIndex={a ? 0 : undefined}
      onKeyDown={a ? (e) => { if (e.key === 'Enter') onRemove?.(); } : undefined}
      title={a ? `Remove ${a.label}` : 'Empty slot'}
    >
      {a ? (
        <>
          <span
            className="ach-modal-slot-icon"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: a.icon }}
          />
          <span className="ach-modal-slot-name">{a.label}</span>
          <span className="ach-modal-slot-remove">✕</span>
        </>
      ) : (
        <span className="ach-modal-slot-empty-label">Empty</span>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Main Component
═══════════════════════════════════════════════════════════ */
export default function AchievementsModal({
  player,
  isSelf,
  databaseConnection,
  onClose,
  onSaved,
}) {
  const [allPlayers,  setAllPlayers]  = useState([]);
  const [tasks,       setTasks]       = useState([]);
  const [journals,    setJournals]    = useState([]);
  const [events,      setEvents]      = useState([]);
  const [matches,     setMatches]     = useState([]);
  const [inventory,   setInventory]   = useState([]);
  const [friends,     setFriends]     = useState([]);
  const [loading,     setLoading]     = useState(true);

  // Selected achievements (mutable copy, only for isSelf)
  const [selected,    setSelected]    = useState(() => {
    const s = player.selectedAchievements || [null, null, null];
    return [s[0] || null, s[1] || null, s[2] || null];
  });
  const [shakingSlots, setShakingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hoveredRow, setHoveredRow] = useState(null);
  const shakeTimer = useRef(null);

  /* Load player data for progress calc */
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const [ap, tk, jn, ev, mt, inv, fr] = await Promise.all([
        databaseConnection.getAllPlayers(),
        databaseConnection.getAll(STORES.task),
        databaseConnection.getAll(STORES.journal),
        databaseConnection.getAll(STORES.event),
        databaseConnection.getMatchesForPlayer(player.UUID),
        databaseConnection.getPlayerStore(STORES.inventory, player.UUID),
        databaseConnection.getFriendshipsForPlayer(player.UUID),
      ]);
      setAllPlayers(ap);
      setTasks(tk);
      setJournals(jn);
      setEvents(ev);
      setMatches(mt);
      setInventory(inv);
      setFriends(fr);
      setLoading(false);
    };
    load();
  }, [databaseConnection, player.UUID]);

  const playerData = { playerUUID: player.UUID, tasks, journals, events, matches, inventory, friends, allPlayers };
  const earned = player.achievements || {};
  const earnedKeys = new Set(Object.keys(earned));

  /* Flat list of all achievement tiers, sorted: earned first */
  const allRows = [];
  for (const group of ACHIEVEMENT_GROUPS) {
    for (const t of group.tiers) {
      const key = `${group.id}_${t.tier}`;
      allRows.push({ key, group, t });
    }
  }
  allRows.sort((a, b) => {
    const aE = earnedKeys.has(a.key) ? 0 : 1;
    const bE = earnedKeys.has(b.key) ? 0 : 1;
    return aE - bE;
  });

  /* Earned count */
  const earnedCount = earnedKeys.size;
  const totalCount  = allRows.length;

  /* Clicking an achievement row (only if earned) */
  const handleRowClick = useCallback((key) => {
    if (!isSelf) return;
    if (!earnedKeys.has(key)) return;

    // Already selected → do nothing (remove handled by slot)
    if (selected.includes(key)) return;

    // Find first empty slot
    const emptyIdx = selected.findIndex((s) => s === null);
    if (emptyIdx !== -1) {
      setSelected((prev) => { const n = [...prev]; n[emptyIdx] = key; return n; });
    } else {
      // All slots full — shake
      if (shakeTimer.current) clearTimeout(shakeTimer.current);
      setShakingSlots(true);
      shakeTimer.current = setTimeout(() => setShakingSlots(false), 500);
    }
  }, [isSelf, earnedKeys, selected]);

  /* Remove from slot */
  const handleSlotRemove = useCallback((idx) => {
    setSelected((prev) => { const n = [...prev]; n[idx] = null; return n; });
  }, []);

  /* Save */
  const handleSave = useCallback(async () => {
    if (!isSelf || saving) return;
    setSaving(true);
    const updated = { ...player, selectedAchievements: selected };
    await databaseConnection.add(STORES.player, updated);
    setSaving(false);
    onSaved?.();
  }, [isSelf, saving, player, selected, databaseConnection, onSaved]);

  /* Overlay click to close */
  const handleOverlayClick = (e) => {
    if (e.target === e.currentTarget) onClose?.();
  };

  return (
    <div className="ach-modal-overlay" onClick={handleOverlayClick}>
      <div className="ach-modal" onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="ach-modal-header">
          <div className="ach-modal-title">
            <span>ACHIEVEMENTS</span>
            <span className="ach-modal-player-name">{player.username}</span>
          </div>
          <button className="ach-modal-close" onClick={onClose}>✕</button>
        </div>

        {loading ? (
          <div className="ach-modal-loading">Loading…</div>
        ) : (
          <>
            {/* Scroll list */}
            <div className="ach-modal-list">
              {allRows.map(({ key, group, t }) => {
                const isEarned = earnedKeys.has(key);
                const rarityPct = computeRarity(key, allPlayers);
                const progress  = isEarned ? null : getAchievementProgress(group.id, t.tier, playerData);
                return (
                  <div
                    key={key}
                    onClick={() => handleRowClick(key)}
                    style={{ cursor: isSelf && isEarned ? 'pointer' : 'default' }}
                  >
                    <AchievementRow
                      groupId={group.id}
                      tier={t.tier}
                      label={t.label}
                      desc={t.desc}
                      icon={group.icon}
                      color={group.color}
                      isEarned={isEarned}
                      progress={progress}
                      rarityPct={rarityPct}
                      isHovered={hoveredRow === key}
                      onHover={() => setHoveredRow(key)}
                      onLeave={() => setHoveredRow(null)}
                    />
                  </div>
                );
              })}
            </div>

            {/* Footer — only for self */}
            {isSelf && (
              <div className="ach-modal-footer">
                <div className="ach-modal-footer-top">
                  <span className="ach-modal-count">
                    {earnedCount} <span className="ach-modal-count-dim">/ {totalCount}</span>
                  </span>
                  <div className="ach-modal-slots">
                    {selected.map((key, i) => (
                      <SelectedSlot
                        key={i}
                        achievementKey={key}
                        onRemove={() => handleSlotRemove(i)}
                        shaking={shakingSlots && key !== null}
                      />
                    ))}
                  </div>
                  <button
                    className="ach-modal-save primary"
                    onClick={handleSave}
                    disabled={saving}
                  >
                    {saving ? 'SAVING…' : 'SAVE'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
