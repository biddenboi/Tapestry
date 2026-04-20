/**
 * Achievement system — definitions, evaluation logic, and SVG icons.
 *
 * Achievements are stored on the player object:
 *   player.achievements          = { [key]: { earnedAt: ISO } }
 *   player.selectedAchievements  = [key | null, key | null, key | null]
 */

import { COSMETIC_THEMES, COSMETIC_FONTS, COSMETIC_PASSES, STORES } from './Constants.js';
import { getRank } from './Helpers/Rank.js';

/* ─── Tier Roman Numerals ─────────────────────────────── */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/* ─── Total purchasable cosmetics (excludes free defaults) ─ */
export const TOTAL_PAID_COSMETICS =
  COSMETIC_THEMES.filter((t) => !t.free).length +
  COSMETIC_FONTS.filter((f) => !f.free).length +
  COSMETIC_PASSES.length;

/* ─── Rank group index for underdog math ─────────────────── */
const RANK_GROUPS = ['Iron','Bronze','Silver','Gold','Platinum','Diamond','Ascendant','Immortal','Radiant'];
function rankGroupIndex(elo) {
  return RANK_GROUPS.indexOf(getRank(elo).group);
}

/* ─── SVG icon factory ───────────────────────────────────── */
function svgWrap(inner, viewBox = '0 0 24 24') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICONS = {
  king_of_the_hill: svgWrap(
    '<path d="M3 17h18M5 17V9l7-5 7 5v8"/>' +
    '<path fill="currentColor" stroke="none" d="M12 4L6 8.5V17h12V8.5L12 4z" opacity=".15"/>' +
    '<circle cx="12" cy="10" r="2" fill="currentColor" stroke="none" opacity=".7"/>' +
    '<path d="M2 7l3.5 3L9 5l3 4 3-4 3.5 5L23 7"/>'
  ),
  overkill: svgWrap(
    '<path d="M4 20L20 4M8 4h-4v4M20 16v4h-4"/>' +
    '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" opacity=".2"/>' +
    '<path d="M9 9l6 6" stroke-width="2.5"/>'
  ),
  underdog: svgWrap(
    '<circle cx="12" cy="8" r="3"/>' +
    '<path d="M9 21v-5a3 3 0 016 0v5"/>' +
    '<path d="M12 14v-3M9.5 12.5l2.5-2.5 2.5 2.5" stroke-width="2"/>' +
    '<path d="M5 5l2 2M19 5l-2 2" opacity=".5"/>'
  ),
  contributor: svgWrap(
    '<circle cx="12" cy="12" r="3"/>' +
    '<circle cx="4" cy="6" r="2"/>' +
    '<circle cx="20" cy="6" r="2"/>' +
    '<circle cx="4" cy="18" r="2"/>' +
    '<circle cx="20" cy="18" r="2"/>' +
    '<path d="M6 6.5l4.5 4M17.5 6.5l-4.5 4M6 17.5l4.5-4M17.5 17.5l-4.5-4"/>'
  ),
  soldier: svgWrap(
    '<path d="M12 2l2.5 5.5 5.5.8-4 3.9.9 5.5L12 15l-4.9 2.7.9-5.5-4-3.9 5.5-.8z"/>' +
    '<path d="M12 2l2.5 5.5 5.5.8-4 3.9.9 5.5L12 15l-4.9 2.7.9-5.5-4-3.9 5.5-.8z" fill="currentColor" opacity=".15"/>' +
    '<path d="M9 21h6M12 17v4" opacity=".6"/>'
  ),
  peace: svgWrap(
    '<path d="M12 2C8 2 4 6 4 11c0 4 3 7 8 9 5-2 8-5 8-9 0-5-4-9-8-9z" fill="currentColor" opacity=".1"/>' +
    '<path d="M12 6v6l-3 3M12 6c0 0 3 3 3 6"/>' +
    '<circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>' +
    '<path d="M7 9c1-2 3-3 5-3s4 1 5 3"/>'
  ),
  legacy: svgWrap(
    '<rect x="4" y="3" width="13" height="18" rx="1"/>' +
    '<rect x="4" y="3" width="13" height="18" rx="1" fill="currentColor" opacity=".1"/>' +
    '<path d="M8 7h7M8 11h7M8 15h5"/>' +
    '<path d="M17 3h1a2 2 0 012 2v14a2 2 0 01-2 2h-1" opacity=".5"/>'
  ),
  basket: svgWrap(
    '<path d="M4 6h16l-2 12H6L4 6z"/>' +
    '<path d="M4 6h16l-2 12H6L4 6z" fill="currentColor" opacity=".1"/>' +
    '<path d="M8 6V4a4 4 0 018 0v2"/>' +
    '<path d="M8 11h1M12 11h1M16 11h1M9 15h6"/>'
  ),
  hobbyist: svgWrap(
    '<circle cx="12" cy="12" r="4"/>' +
    '<circle cx="12" cy="12" r="4" fill="currentColor" opacity=".15"/>' +
    '<circle cx="5" cy="8" r="2" fill="currentColor" stroke="none" opacity=".6"/>' +
    '<circle cx="19" cy="8" r="2" fill="currentColor" stroke="none" opacity=".6"/>' +
    '<circle cx="5" cy="17" r="2" fill="currentColor" stroke="none" opacity=".4"/>' +
    '<circle cx="19" cy="17" r="2" fill="currentColor" stroke="none" opacity=".4"/>' +
    '<circle cx="12" cy="3" r="2" fill="currentColor" stroke="none" opacity=".6"/>'
  ),
  scholar: svgWrap(
    '<path d="M12 3L3 8l9 5 9-5-9-5z"/>' +
    '<path d="M12 3L3 8l9 5 9-5-9-5z" fill="currentColor" opacity=".15"/>' +
    '<path d="M3 8v6"/>' +
    '<path d="M7 10v5a5 5 0 0010 0v-5"/>' +
    '<circle cx="3" cy="15" r="1.5" fill="currentColor" stroke="none" opacity=".7"/>'
  ),
  long_game: svgWrap(
    '<circle cx="12" cy="12" r="9"/>' +
    '<circle cx="12" cy="12" r="9" fill="currentColor" opacity=".08"/>' +
    '<path d="M12 7v5l3.5 3.5"/>' +
    '<path d="M7 3.5l1.5 1.5M17 3.5l-1.5 1.5"/>'
  ),
  town: svgWrap(
    '<circle cx="8" cy="7" r="3"/>' +
    '<circle cx="16" cy="7" r="3"/>' +
    '<path d="M2 21v-2a5 5 0 0110 0v2"/>' +
    '<path d="M14 21v-1a4 4 0 018 0v1"/>' +
    '<path d="M12 21v-2" opacity=".5"/>'
  ),
  savant: svgWrap(
    '<polygon points="12,2 15,9 22,9 16.5,13.5 18.5,21 12,16.5 5.5,21 7.5,13.5 2,9 9,9"/>' +
    '<polygon points="12,2 15,9 22,9 16.5,13.5 18.5,21 12,16.5 5.5,21 7.5,13.5 2,9 9,9" fill="currentColor" opacity=".2"/>'
  ),
};

/* ─── Achievement catalog ────────────────────────────────── */
export const ACHIEVEMENT_GROUPS = [
  {
    id: 'king_of_the_hill',
    icon: ICONS.king_of_the_hill,
    color: '#fbbf24',
    tiers: [
      { tier: 1, label: 'King of the Hill I',  desc: 'Once held the all-time #1 spot in lifetime points across all players.' },
      { tier: 2, label: 'King of the Hill II', desc: 'Currently holding the all-time #1 spot in lifetime points.' },
    ],
  },
  {
    id: 'overkill',
    icon: ICONS.overkill,
    color: '#ef4444',
    tiers: [
      { tier: 1, label: 'Overkill I',   desc: 'Won a match by more than 300 team points.' },
      { tier: 2, label: 'Massacre II',  desc: 'Won a match by more than 500 team points.' },
      { tier: 3, label: 'Decimator III',desc: 'Won a match by more than 1000 team points.' },
    ],
  },
  {
    id: 'underdog',
    icon: ICONS.underdog,
    color: '#60a5fa',
    tiers: [
      { tier: 1, label: 'Underdog I',desc: 'Won a match while being exactly 1 rank tier below all opponents.' },
      { tier: 2, label: 'Prodigy II', desc: 'Won a match while being at least 3 rank tiers below all opponents.' },
    ],
  },
  {
    id: 'contributor',
    icon: ICONS.contributor,
    color: '#34d399',
    tiers: [
      { tier: 1, label: 'Contributor I',      desc: 'Contributed 30% of your team\'s total points in a match.' },
      { tier: 2, label: 'Apex Contributor II', desc: 'Contributed 50% of your team\'s total points in a match.' },
      { tier: 3, label: 'Leader III',          desc: 'Contributed 70% of your team\'s total points in a match.' },
    ],
  },
  {
    id: 'soldier',
    icon: ICONS.soldier,
    color: '#a78bfa',
    tiers: [
      { tier: 1, label: 'Soldier I',      desc: 'Won 2 matches in a row.' },
      { tier: 2, label: 'Commander II',   desc: 'Won 3 matches in a row.' },
      { tier: 3, label: 'Officer III',    desc: 'Won 5 matches in a row.' },
      { tier: 4, label: 'General IV',     desc: 'Won 10 matches in a row.' },
      { tier: 5, label: 'War Machine V',  desc: 'Won 100 matches in a row.' },
    ],
  },
  {
    id: 'peace',
    icon: ICONS.peace,
    color: '#22d3ee',
    tiers: [
      { tier: 1, label: 'Peace I',      desc: 'Posted a dojo session strong enough to appear on the Top Sessions board.' },
      { tier: 2, label: 'Meditation II', desc: 'Claimed the #1 spot on the Top Sessions dojo leaderboard.' },
      { tier: 3, label: 'Serenity III',  desc: 'Currently holds the #1 spot on the Top Sessions dojo leaderboard.' },
    ],
  },
  {
    id: 'legacy',
    icon: ICONS.legacy,
    color: '#f59e0b',
    tiers: [
      { tier: 1, label: 'Legacy I',  desc: 'Wrote 1,000 words in a single journal entry.' },
      { tier: 2, label: 'Archive II', desc: 'Wrote 10,000 words in a single journal entry.' },
    ],
  },
  {
    id: 'basket',
    icon: ICONS.basket,
    color: '#fb923c',
    tiers: [
      { tier: 1, label: 'Basket I',            desc: 'Accumulated 10 items in your profile timeline.' },
      { tier: 2, label: 'Cornucopia II',        desc: 'Accumulated 100 items in your profile timeline.' },
      { tier: 3, label: 'Golden Cornucopia III',desc: 'Accumulated 1,000 items in your profile timeline.' },
    ],
  },
  {
    id: 'hobbyist',
    icon: ICONS.hobbyist,
    color: '#e879f9',
    tiers: [
      { tier: 1, label: 'Hobbyist I',     desc: `Own 25% of all cosmetic items (${Math.ceil(TOTAL_PAID_COSMETICS * 0.25)} items).` },
      { tier: 2, label: 'Completionist II',desc: `Own 50% of all cosmetic items (${Math.ceil(TOTAL_PAID_COSMETICS * 0.50)} items).` },
      { tier: 3, label: 'Maximalist III',  desc: `Own all ${TOTAL_PAID_COSMETICS} cosmetic items.` },
    ],
  },
  {
    id: 'scholar',
    icon: ICONS.scholar,
    color: '#4ade80',
    tiers: [
      { tier: 1, label: 'Scholar I',              desc: 'Completed 10 tasks in a single day.' },
      { tier: 2, label: 'Distinguished Laureate II',desc: 'Completed 20 tasks in a single day.' },
    ],
  },
  {
    id: 'long_game',
    icon: ICONS.long_game,
    color: '#94a3b8',
    tiers: [
      { tier: 1, label: 'The Long Game I',   desc: 'Played 10 matches on your profile.' },
      { tier: 2, label: 'The Longer Game II', desc: 'Played 100 matches on your profile.' },
    ],
  },
  {
    id: 'town',
    icon: ICONS.town,
    color: '#38bdf8',
    tiers: [
      { tier: 1, label: 'Town I',          desc: 'Made 5 friends.' },
      { tier: 2, label: 'Inner Empire II', desc: 'Made 10 friends.' },
      { tier: 3, label: 'Civilization III',desc: 'Made 20 friends.' },
    ],
  },
  {
    id: 'savant',
    icon: ICONS.savant,
    color: '#fde047',
    tiers: [
      { tier: 1, label: 'Savant', desc: 'Simultaneously hold the top rank, top lifetime points, and own every cosmetic item (Maximalist).' },
    ],
  },
];

/* ─── Flat lookup map: achievementKey → { group, tier info } ─ */
export const ACHIEVEMENT_MAP = {};
for (const group of ACHIEVEMENT_GROUPS) {
  for (const t of group.tiers) {
    const key = `${group.id}_${t.tier}`;
    ACHIEVEMENT_MAP[key] = { ...group, ...t, key };
  }
}

export function getAchievementByKey(key) {
  return ACHIEVEMENT_MAP[key] || null;
}

/* ─── Rarity thresholds ───────────────────────────────────── */
export function getRarityLabel(ownerPct) {
  if (ownerPct <= 3)  return { label: 'Radiant',   color: '#fde047' };
  if (ownerPct <= 10) return { label: 'Legendary',  color: '#f97316' };
  if (ownerPct <= 30) return { label: 'Epic',        color: '#a855f7' };
  if (ownerPct <= 60) return { label: 'Rare',        color: '#3b82f6' };
  return                      { label: 'Common',     color: '#6b7280' };
}

/* ─── Compute lifetime points for a player from all tasks ─── */
function lifetimePoints(tasks, playerUUID) {
  return tasks
    .filter((t) => t.parent === playerUUID && t.completedAt)
    .reduce((s, t) => s + Number(t.points || 0), 0);
}

/* ─── Timeline item count ─────────────────────────────────── */
function timelineCount(tasks, journals, events, playerUUID) {
  return (
    tasks.filter((t) => t.parent === playerUUID && t.completedAt).length +
    journals.filter((j) => j.parent === playerUUID).length +
    events.filter((e) => e.parent === playerUUID).length
  );
}

/* ─── Win streak for a player from sorted matches ────────────
   Returns the CURRENT consecutive win streak (most recent first).     */
function currentWinStreak(matches, playerUUID) {
  const sorted = [...matches]
    .filter((m) => m.status === 'complete' && m.result)
    .sort((a, b) => String(b.result.concludedAt || b.createdAt || '').localeCompare(String(a.result.concludedAt || a.createdAt || '')));

  let streak = 0;
  for (const m of sorted) {
    const team1 = m.teams?.[0] || [];
    const onTeam1 = team1.some((p) => String(p.UUID) === String(playerUUID));
    const winner = m.result.winner;
    const iWon = (winner === 1 && onTeam1) || (winner === 2 && !onTeam1);
    if (iWon) streak++;
    else break;
  }
  return streak;
}

/* ─── Cosmetics owned count ───────────────────────────────── */
function ownedCosmeticCount(inventory) {
  // Inventory entries with cosmetic types (themes, fonts, passes)
  const cosmeticTypes = new Set([
    'cosmetic_theme', 'cosmetic_font',
    'cosmetic_card_banner', 'cosmetic_profile_banner', 'cosmetic_lobby_banner',
  ]);
  const ids = new Set();
  for (const item of inventory) {
    if (cosmeticTypes.has(item.type)) {
      ids.add(item.itemId || item.name);
    }
  }
  return ids.size;
}

/* ─── Grant helper ────────────────────────────────────────── */
function grant(achievements, key) {
  if (achievements[key]) return false; // already have it
  // eslint-disable-next-line no-param-reassign
  achievements[key] = { earnedAt: new Date().toISOString() };
  return true;
}

/* ═══════════════════════════════════════════════════════════
   checkMatchAchievements
   Call right after a match concludes (from concludeMatch).
   Returns array of newly-earned achievement keys.
═══════════════════════════════════════════════════════════ */
export async function checkMatchAchievements(player, concludedMatch, db) {
  const result = concludedMatch?.result;
  if (!result) return [];

  const achievements = { ...(player.achievements || {}) };
  const earned = [];

  const iWon     = result.iWon;
  const team1    = concludedMatch.teams?.[0] || [];
  const team2    = concludedMatch.teams?.[1] || [];
  const allPlayers = [...team1, ...team2];
  const onTeam1  = team1.some((p) => String(p.UUID) === String(player.UUID));
  const myTeam   = onTeam1 ? team1 : team2;
  const oppTeam  = onTeam1 ? team2 : team1;
  const myTeamScore  = onTeam1 ? result.team1Total : result.team2Total;
  const oppTeamScore = onTeam1 ? result.team2Total : result.team1Total;
  const scoreDiff    = (myTeamScore || 0) - (oppTeamScore || 0);

  /* ── King of the Hill (needs all players' pts) ─── */
  const allPlayersDB  = await db.getAllPlayers();
  const allTasksDB    = await db.getAll(STORES.task);
  const myPts         = lifetimePoints(allTasksDB, player.UUID);
  const topPts        = Math.max(...allPlayersDB.map((p) => lifetimePoints(allTasksDB, p.UUID)));
  if (myPts >= topPts && allPlayersDB.length > 1) {
    if (grant(achievements, 'king_of_the_hill_1')) earned.push('king_of_the_hill_1');
    if (grant(achievements, 'king_of_the_hill_2')) earned.push('king_of_the_hill_2');
  } else if (achievements['king_of_the_hill_2']) {
    // Strip tier 2 if no longer #1 (stays as tier 1)
    delete achievements['king_of_the_hill_2'];
  }

  if (iWon) {
    /* ── Overkill / Massacre / Decimator ─── */
    if (scoreDiff > 1000) {
      ['overkill_1','overkill_2','overkill_3'].forEach((k) => { if (grant(achievements, k)) earned.push(k); });
    } else if (scoreDiff > 500) {
      ['overkill_1','overkill_2'].forEach((k) => { if (grant(achievements, k)) earned.push(k); });
    } else if (scoreDiff > 300) {
      if (grant(achievements, 'overkill_1')) earned.push('overkill_1');
    }

    /* ── Underdog / Prodigy ─── */
    const myRankIdx  = rankGroupIndex(player.elo || 0);
    const oppMinRank = Math.min(...oppTeam.map((p) => rankGroupIndex(p.elo || 0)));
    if (oppMinRank >= myRankIdx + 3) {
      ['underdog_1','underdog_2'].forEach((k) => { if (grant(achievements, k)) earned.push(k); });
    } else if (oppMinRank >= myRankIdx + 1) {
      if (grant(achievements, 'underdog_1')) earned.push('underdog_1');
    }

    /* ── Contributor / Apex / Leader ─── */
    const myPtsInMatch = allTasksDB
      .filter((t) => t.parent === player.UUID && t.completedAt &&
        t.completedAt >= (concludedMatch.createdAt || '') &&
        t.completedAt <= (result.concludedAt || new Date().toISOString()))
      .reduce((s, t) => s + Number(t.points || 0), 0);
    const teamTotal = myTeamScore || 0;
    const contribPct = teamTotal > 0 ? myPtsInMatch / teamTotal : 0;
    if (contribPct >= 0.70) {
      ['contributor_1','contributor_2','contributor_3'].forEach((k) => { if (grant(achievements, k)) earned.push(k); });
    } else if (contribPct >= 0.50) {
      ['contributor_1','contributor_2'].forEach((k) => { if (grant(achievements, k)) earned.push(k); });
    } else if (contribPct >= 0.30) {
      if (grant(achievements, 'contributor_1')) earned.push('contributor_1');
    }
  }

  /* ── Soldier / Win Streak (check regardless of current win) ─── */
  const allMatches = await db.getMatchesForPlayer(player.UUID);
  const streak     = currentWinStreak(allMatches, player.UUID);
  const streakTiers = [[2,'soldier_1'],[3,'soldier_2'],[5,'soldier_3'],[10,'soldier_4'],[100,'soldier_5']];
  for (const [threshold, key] of streakTiers) {
    if (streak >= threshold && grant(achievements, key)) earned.push(key);
  }

  /* ── The Long Game / Longer Game ─── */
  const matchCount = allMatches.filter((m) => m.status === 'complete').length;
  if (matchCount >= 100 && grant(achievements, 'long_game_2')) earned.push('long_game_2');
  if (matchCount >= 10  && grant(achievements, 'long_game_1')) earned.push('long_game_1');

  /* ── Savant ─── */
  const isRadiant  = (player.elo || 0) >= 3000;
  const isTopPts   = myPts >= topPts && allPlayersDB.length > 1;
  const inventory  = await db.getPlayerStore(STORES.inventory, player.UUID);
  const owned      = ownedCosmeticCount(inventory);
  if (isRadiant && isTopPts && owned >= TOTAL_PAID_COSMETICS) {
    if (grant(achievements, 'savant_1')) earned.push('savant_1');
  }

  if (earned.length === 0 && JSON.stringify(achievements) === JSON.stringify(player.achievements || {})) {
    return [];
  }

  const updated = { ...player, achievements };
  await db.add(STORES.player, updated);
  return earned;
}

/* ═══════════════════════════════════════════════════════════
   checkPassiveAchievements
   Call on profile load, after task/journal saves, etc.
   Returns array of newly-earned keys.
═══════════════════════════════════════════════════════════ */
export async function checkPassiveAchievements(player, db) {
  const achievements = { ...(player.achievements || {}) };
  const earned = [];

  const [allTasks, allJournals, allEvents, allPlayersDB, inventory, friendships] = await Promise.all([
    db.getAll(STORES.task),
    db.getAll(STORES.journal),
    db.getAll(STORES.event),
    db.getAllPlayers(),
    db.getPlayerStore(STORES.inventory, player.UUID),
    db.getFriendshipsForPlayer(player.UUID),
  ]);

  /* ── King of the Hill ─── */
  const myPts  = lifetimePoints(allTasks, player.UUID);
  const topPts = Math.max(...allPlayersDB.map((p) => lifetimePoints(allTasks, p.UUID)));
  if (myPts >= topPts && allPlayersDB.length > 1) {
    if (grant(achievements, 'king_of_the_hill_1')) earned.push('king_of_the_hill_1');
    if (grant(achievements, 'king_of_the_hill_2')) earned.push('king_of_the_hill_2');
  } else {
    // Tier 2 is dynamic — remove if no longer #1
    if (achievements['king_of_the_hill_2']) {
      delete achievements['king_of_the_hill_2'];
    }
  }

  /* ── Timeline basket ─── */
  const tlCount = timelineCount(allTasks, allJournals, allEvents, player.UUID);
  if (tlCount >= 1000 && grant(achievements, 'basket_3')) earned.push('basket_3');
  if (tlCount >= 100  && grant(achievements, 'basket_2')) earned.push('basket_2');
  if (tlCount >= 10   && grant(achievements, 'basket_1')) earned.push('basket_1');

  /* ── Hobbyist / Completionist / Maximalist ─── */
  const owned = ownedCosmeticCount(inventory);
  const pct   = owned / TOTAL_PAID_COSMETICS;
  if (pct >= 1.0 && grant(achievements, 'hobbyist_3')) earned.push('hobbyist_3');
  if (pct >= 0.5 && grant(achievements, 'hobbyist_2')) earned.push('hobbyist_2');
  if (pct >= 0.25 && grant(achievements, 'hobbyist_1')) earned.push('hobbyist_1');

  /* ── Scholar ─── */
  const myTasks = allTasks.filter((t) => t.parent === player.UUID && t.completedAt);
  const tasksByDay = {};
  for (const t of myTasks) {
    const day = t.completedAt.split('T')[0];
    tasksByDay[day] = (tasksByDay[day] || 0) + 1;
  }
  const maxTaskDay = Math.max(0, ...Object.values(tasksByDay));
  if (maxTaskDay >= 20 && grant(achievements, 'scholar_2')) earned.push('scholar_2');
  if (maxTaskDay >= 10 && grant(achievements, 'scholar_1')) earned.push('scholar_1');

  /* ── Legacy / Archive ─── */
  const myJournals = allJournals.filter((j) => j.parent === player.UUID);
  const maxWords   = Math.max(0, ...myJournals.map((j) => (j.entry || '').trim().split(/\s+/).filter(Boolean).length));
  if (maxWords >= 10000 && grant(achievements, 'legacy_2')) earned.push('legacy_2');
  if (maxWords >= 1000  && grant(achievements, 'legacy_1')) earned.push('legacy_1');

  /* ── Town / Inner Empire / Civilization ─── */
  const friendCount = friendships.filter((f) => f.status === 'accepted').length;
  if (friendCount >= 20 && grant(achievements, 'town_3')) earned.push('town_3');
  if (friendCount >= 10 && grant(achievements, 'town_2')) earned.push('town_2');
  if (friendCount >= 5  && grant(achievements, 'town_1')) earned.push('town_1');

  /* ── Peace / Dojo top sessions ─── */
  const dayMap = {};
  allTasks.filter((t) => t.completedAt && t.parent && t.source === 'dojo').forEach((t) => {
    const day = t.completedAt.split('T')[0];
    const key = `${t.parent}__${day}`;
    if (!dayMap[key]) dayMap[key] = { playerUUID: t.parent, day, points: 0 };
    dayMap[key].points += (t.points || 0);
  });
  const sessions = Object.values(dayMap).sort((a, b) => b.points - a.points);
  const top10    = sessions.slice(0, 10);
  const top1     = sessions[0];
  const inTop10  = top10.some((s) => s.playerUUID === player.UUID);
  const isTop1   = top1?.playerUUID === player.UUID;
  if (inTop10 && grant(achievements, 'peace_1')) earned.push('peace_1');
  if (isTop1) {
    if (grant(achievements, 'peace_2')) earned.push('peace_2');
    if (grant(achievements, 'peace_3')) earned.push('peace_3');
  } else if (achievements['peace_3']) {
    delete achievements['peace_3']; // dynamic tier 3
  }

  /* ── Long Game ─── */
  const allMatches = await db.getMatchesForPlayer(player.UUID);
  const matchCount = allMatches.filter((m) => m.status === 'complete').length;
  if (matchCount >= 100 && grant(achievements, 'long_game_2')) earned.push('long_game_2');
  if (matchCount >= 10  && grant(achievements, 'long_game_1')) earned.push('long_game_1');

  /* ── Savant ─── */
  const isRadiant = (player.elo || 0) >= 3000;
  const isTopPts  = myPts >= topPts && allPlayersDB.length > 1;
  const hasMaximalist = !!achievements['hobbyist_3'];
  if (isRadiant && isTopPts && hasMaximalist) {
    if (grant(achievements, 'savant_1')) earned.push('savant_1');
  }

  // Save if anything changed (always do a proper JSON diff)
  const prevJSON = JSON.stringify(player.achievements || {});
  const nextJSON = JSON.stringify(achievements);
  if (prevJSON !== nextJSON) {
    await db.add(STORES.player, { ...player, achievements });
  }
  return earned;
}

/* ─── Compute rarity % for a single key across all players ─ */
export function computeRarity(key, allPlayers) {
  if (!allPlayers.length) return 0;
  const owners = allPlayers.filter((p) => p.achievements?.[key]).length;
  return Math.round((owners / allPlayers.length) * 100);
}

/* ─── Get the highest earned tier key for a group ─────────── */
export function getHighestTierKey(groupId, achievements = {}) {
  const group = ACHIEVEMENT_GROUPS.find((g) => g.id === groupId);
  if (!group) return null;
  // Iterate tiers in reverse to find highest
  for (let i = group.tiers.length; i >= 1; i--) {
    const key = `${groupId}_${i}`;
    if (achievements[key]) return key;
  }
  return null;
}

/* ─── Full label display (with roman numeral) ─────────────── */
export function getAchievementDisplayLabel(key) {
  const a = ACHIEVEMENT_MAP[key];
  if (!a) return key;
  return a.label;
}
