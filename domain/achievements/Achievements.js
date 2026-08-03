/**
 * Achievement system — definitions, evaluation logic, and SVG icons.
 *
 * Achievements are stored on the player object:
 *   player.achievements          = { [key]: { earnedAt: ISO } }
 *   player.selectedAchievements  = [key | null, key | null, key | null]
 */

import { COSMETIC_THEMES, COSMETIC_TITLES, COSMETIC_PASSES, SPECIAL_KIND, STORES } from '@domain/constants.js';
import { getRank } from '@domain/rank/Rank.js';

/* ─── Tier Roman Numerals ─────────────────────────────── */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/* ─── Total purchasable cosmetics (excludes free defaults) ─ */
export const TOTAL_PAID_COSMETICS =
  COSMETIC_THEMES.filter((t) => !t.free).length +
  COSMETIC_TITLES.filter((title) => !title.free).length +
  COSMETIC_PASSES.length;

/* ─── Rank group index for underdog math ─────────────────── */
const RANK_GROUPS = ['Iron','Bronze','Silver','Gold','Platinum','Diamond','Ascendant','Immortal','Radiant'];
function rankGroupIndex(elo) {
  return RANK_GROUPS.indexOf(getRank(elo).group);
}

/* ─── SVG icon factory ───────────────────────────────────── */
function svgWrap(inner, viewBox = '0 0 20 20') {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const ICONS = {
  king_of_the_hill: svgWrap(
    '<polyline points="2,16 10,4 18,16"/>' +
    '<line x1="3.5" y1="16" x2="16.5" y2="16"/>' +
    '<path d="M7 10 L7 7 L9 9 L10 6.5 L11 9 L13 7 L13 10 Z" fill="currentColor" opacity="0.3"/>' +
    '<path d="M7 10 L7 7 L9 9 L10 6.5 L11 9 L13 7 L13 10"/>' +
    '<circle cx="7.5" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>' +
    '<circle cx="10" cy="6" r="0.8" fill="currentColor" stroke="none"/>' +
    '<circle cx="12.5" cy="6.5" r="0.8" fill="currentColor" stroke="none"/>' +
    '<line x1="6" y1="10" x2="14" y2="10"/>'
  ),
  overkill: svgWrap(
    '<circle cx="10" cy="10" r="8"/>' +
    '<circle cx="10" cy="10" r="5"/>' +
    '<circle cx="10" cy="10" r="2" fill="currentColor" opacity="0.25" stroke="none"/>' +
    '<line x1="3" y1="3" x2="17" y2="17" stroke-width="2.2"/>' +
    '<line x1="2" y1="7" x2="5" y2="7" opacity="0.5"/>' +
    '<line x1="2" y1="10" x2="4" y2="10" opacity="0.35"/>' +
    '<line x1="2" y1="13" x2="5" y2="13" opacity="0.5"/>'
  ),
  underdog: svgWrap(
    '<line x1="2" y1="13" x2="18" y2="13" stroke-width="1.8"/>' +
    '<circle cx="10" cy="16.5" r="1.5" fill="currentColor" opacity="0.4" stroke-width="1"/>' +
    '<line x1="10" y1="11" x2="10" y2="3"/>' +
    '<polyline points="7,6 10,3 13,6"/>' +
    '<line x1="7" y1="9" x2="7" y2="12" opacity="0.35" stroke-dasharray="1.5 1.5"/>' +
    '<line x1="13" y1="9" x2="13" y2="12" opacity="0.35" stroke-dasharray="1.5 1.5"/>' +
    '<path d="M8,13 L9,11.5 L11,14.5 L12,13" stroke-width="1" opacity="0.7"/>'
  ),
  contributor: svgWrap(
    '<circle cx="10" cy="2.5" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="17" cy="7" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="17" cy="13" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="10" cy="17.5" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="3" cy="13" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="3" cy="7" r="1.5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<circle cx="10" cy="10" r="3" fill="currentColor" opacity="0.22"/>' +
    '<circle cx="10" cy="10" r="3"/>' +
    '<line x1="10" y1="4" x2="10" y2="7"/>' +
    '<line x1="15.7" y1="7.8" x2="12.8" y2="8.8"/>' +
    '<line x1="15.7" y1="12.2" x2="12.8" y2="11.2"/>' +
    '<line x1="10" y1="16" x2="10" y2="13"/>' +
    '<line x1="4.3" y1="12.2" x2="7.2" y2="11.2"/>' +
    '<line x1="4.3" y1="7.8" x2="7.2" y2="8.8"/>' +
    '<circle cx="10" cy="10" r="5" opacity="0.2" stroke-dasharray="2 2"/>'
  ),
  soldier: svgWrap(
    '<path d="M10 2 L17 5 L17 12 L10 18 L3 12 L3 5 Z"/>' +
    '<path d="M10 2 L17 5 L17 12 L10 18 L3 12 L3 5 Z" fill="currentColor" opacity="0.1" stroke="none"/>' +
    '<line x1="7" y1="7" x2="7" y2="12"/>' +
    '<line x1="9" y1="7" x2="9" y2="12"/>' +
    '<line x1="11" y1="7" x2="11" y2="12"/>' +
    '<line x1="13" y1="7" x2="13" y2="12"/>' +
    '<line x1="6" y1="12" x2="14" y2="7" stroke-width="1.6"/>' +
    '<polygon points="10,3.5 10.7,5.5 12.8,5.5 11.2,6.7 11.8,8.7 10,7.5 8.2,8.7 8.8,6.7 7.2,5.5 9.3,5.5" fill="currentColor" opacity="0.6" stroke="none"/>'
  ),
  peace: svgWrap(
    '<polygon points="10,2 18,10 10,18 2,10"/>' +
    '<polygon points="10,5 15,10 10,15 5,10"/>' +
    '<polygon points="10,8 12,10 10,12 8,10" fill="currentColor" opacity="0.25" stroke="none"/>' +
    '<circle cx="10" cy="10" r="1.2" fill="currentColor" stroke="none"/>'
  ),
  legacy: svgWrap(
    '<path d="M4 3 L13 3 L16 6 L16 18 L4 18 Z"/>' +
    '<path d="M4 3 L13 3 L16 6 L16 18 L4 18 Z" fill="currentColor" opacity="0.08" stroke="none"/>' +
    '<polyline points="13,3 13,6 16,6" stroke-width="1"/>' +
    '<line x1="7" y1="9" x2="13" y2="9"/>' +
    '<line x1="7" y1="11.5" x2="13" y2="11.5"/>' +
    '<line x1="7" y1="14" x2="11" y2="14"/>' +
    '<path d="M11 5 L14.5 3.5 L15 5 L12 7 Z" fill="currentColor" opacity="0.5" stroke="none"/>' +
    '<line x1="11" y1="5" x2="12" y2="7" stroke-width="1.4"/>' +
    '<line x1="4" y1="3" x2="4" y2="18" stroke-width="2"/>' +
    '<circle cx="10" cy="16" r="2.5"/>' +
    '<circle cx="10" cy="16" r="1" fill="currentColor" opacity="0.5" stroke="none"/>'
  ),
  basket: svgWrap(
    '<path d="M3 8 L17 8 L15 17 L5 17 Z"/>' +
    '<path d="M3 8 L17 8 L15 17 L5 17 Z" fill="currentColor" opacity="0.1" stroke="none"/>' +
    '<line x1="8" y1="8" x2="7" y2="17" opacity="0.5"/>' +
    '<line x1="12" y1="8" x2="13" y2="17" opacity="0.5"/>' +
    '<path d="M6 8 C6 4 14 4 14 8"/>' +
    '<polygon points="7,7.5 8.5,5.5 10,7.5 8.5,9.5" fill="currentColor" opacity="0.4" stroke="currentColor" stroke-width="1"/>' +
    '<polygon points="10,6.5 11.5,4.5 13,6.5 11.5,8.5" fill="currentColor" opacity="0.6" stroke="currentColor" stroke-width="1"/>' +
    '<polygon points="12.5,7.5 14,5.5 15.5,7.5 14,9.5" fill="currentColor" opacity="0.3" stroke="currentColor" stroke-width="1"/>'
  ),
  hobbyist: svgWrap(
    '<rect x="2" y="2" width="5" height="5" fill="currentColor" opacity="0.3" stroke="none"/>' +
    '<rect x="7.5" y="2" width="5" height="5" fill="currentColor" opacity="0.15" stroke="none"/>' +
    '<rect x="13" y="2" width="5" height="5" fill="currentColor" opacity="0.45" stroke="none"/>' +
    '<rect x="2" y="7.5" width="5" height="5" fill="currentColor" opacity="0.2" stroke="none"/>' +
    '<rect x="7.5" y="7.5" width="5" height="5" fill="currentColor" opacity="0.5" stroke="none"/>' +
    '<rect x="13" y="7.5" width="5" height="5" fill="currentColor" opacity="0.1" stroke="none"/>' +
    '<rect x="2" y="13" width="5" height="5" fill="currentColor" opacity="0.4" stroke="none"/>' +
    '<rect x="7.5" y="13" width="5" height="5" fill="currentColor" opacity="0.2" stroke="none"/>' +
    '<rect x="13" y="13" width="5" height="5" stroke-dasharray="2 1" opacity="0.6"/>' +
    '<line x1="2" y1="7.5" x2="18" y2="7.5" opacity="0.3"/>' +
    '<line x1="2" y1="13" x2="18" y2="13" opacity="0.3"/>' +
    '<line x1="7.5" y1="2" x2="7.5" y2="18" opacity="0.3"/>' +
    '<line x1="13" y1="2" x2="13" y2="18" opacity="0.3"/>'
  ),
  scholar: svgWrap(
    '<rect x="3" y="13" width="14" height="3.5" fill="currentColor" opacity="0.15" stroke="none"/>' +
    '<rect x="3" y="13" width="14" height="3.5"/>' +
    '<rect x="4.5" y="10" width="11" height="3.5" fill="currentColor" opacity="0.1" stroke="none"/>' +
    '<rect x="4.5" y="10" width="11" height="3.5"/>' +
    '<polygon points="10,3 18,7 10,11 2,7" fill="currentColor" opacity="0.2" stroke="none"/>' +
    '<polygon points="10,3 18,7 10,11 2,7"/>' +
    '<line x1="18" y1="7" x2="18" y2="11"/>' +
    '<line x1="18" y1="11" x2="16" y2="13"/>' +
    '<circle cx="16" cy="13.5" r="1" fill="currentColor" opacity="0.6" stroke="none"/>' +
    '<line x1="7" y1="6" x2="10" y2="5" opacity="0.5"/>'
  ),
  long_game: svgWrap(
    '<path d="M4 2 L16 2 L16 3 L12 8.5 L12 11.5 L16 17 L16 18 L4 18 L4 17 L8 11.5 L8 8.5 L4 3 Z"/>' +
    '<path d="M4 2 L16 2 L16 3 L12 8.5 L12 11.5 L16 17 L16 18 L4 18 L4 17 L8 11.5 L8 8.5 L4 3 Z" fill="currentColor" opacity="0.07" stroke="none"/>' +
    '<path d="M5 17 L15 17 L12.5 13 L7.5 13 Z" fill="currentColor" opacity="0.3" stroke="none"/>' +
    '<line x1="10" y1="9.5" x2="10" y2="10.5" stroke-width="2" opacity="0.5"/>' +
    '<line x1="4" y1="3" x2="16" y2="3"/>' +
    '<line x1="4" y1="17" x2="16" y2="17"/>'
  ),
  town: svgWrap(
    '<polygon points="5,4 7,5.2 7,7.5 5,8.7 3,7.5 3,5.2" opacity="0.6"/>' +
    '<path d="M2 13 L2 11 L4 10 L6 10 L8 11 L8 13" opacity="0.6"/>' +
    '<polygon points="15,4 17,5.2 17,7.5 15,8.7 13,7.5 13,5.2" opacity="0.6"/>' +
    '<path d="M12 13 L12 11 L14 10 L16 10 L18 11 L18 13" opacity="0.6"/>' +
    '<polygon points="10,2 12.5,3.5 12.5,6.5 10,8 7.5,6.5 7.5,3.5" fill="currentColor" opacity="0.2" stroke="none"/>' +
    '<polygon points="10,2 12.5,3.5 12.5,6.5 10,8 7.5,6.5 7.5,3.5"/>' +
    '<path d="M6 18 L6 15 L9 13 L11 13 L14 15 L14 18"/>' +
    '<line x1="6" y1="18" x2="14" y2="18"/>'
  ),
  savant: svgWrap(
    '<polygon points="10,1.5 11.5,8.5 18.5,10 11.5,11.5 10,18.5 8.5,11.5 1.5,10 8.5,8.5" fill="currentColor" opacity="0.15" stroke="none"/>' +
    '<polygon points="10,1.5 11.5,8.5 18.5,10 11.5,11.5 10,18.5 8.5,11.5 1.5,10 8.5,8.5"/>' +
    '<polygon points="10,5.5 13,10 10,14.5 7,10" fill="currentColor" opacity="0.3" stroke="none"/>' +
    '<circle cx="10" cy="10" r="2" fill="currentColor" opacity="0.8" stroke="none"/>' +
    '<path d="M8,5 L8,3 L9.5,4.5 L10,2 L10.5,4.5 L12,3 L12,5" stroke-width="1.4"/>'
  ),
  climber: svgWrap(
    '<path d="M3 17 H7 V13 H11 V9 H15 V5 H18"/>' +
    '<path d="M3 17 H7 V13 H11 V9 H15 V5" fill="currentColor" opacity="0.12" stroke="none"/>' +
    '<polyline points="12,5 15,2 18,5"/>' +
    '<circle cx="5" cy="15" r="1" fill="currentColor" opacity="0.45" stroke="none"/>' +
    '<circle cx="9" cy="11" r="1" fill="currentColor" opacity="0.55" stroke="none"/>' +
    '<circle cx="13" cy="7" r="1" fill="currentColor" opacity="0.65" stroke="none"/>'
  ),
  clutch: svgWrap(
    '<circle cx="10" cy="10" r="8"/>' +
    '<path d="M10 4 V10 L14 12"/>' +
    '<path d="M5 14 L8 11 L10 13 L15 8" stroke-width="1.7"/>' +
    '<circle cx="10" cy="10" r="2" fill="currentColor" opacity="0.18" stroke="none"/>'
  ),
  momentum: svgWrap(
    '<path d="M3 14 C6 16 8 9 11 11 C13 12.3 14 8 17 7"/>' +
    '<polyline points="13,6 17,7 15,11"/>' +
    '<path d="M3 17 H17"/>' +
    '<circle cx="7" cy="12" r="1.2" fill="currentColor" opacity="0.5" stroke="none"/>' +
    '<circle cx="11" cy="11" r="1.2" fill="currentColor" opacity="0.65" stroke="none"/>'
  ),
  grinder: svgWrap(
    '<rect x="4" y="3" width="12" height="15"/>' +
    '<path d="M7 7 L8.5 8.5 L12 5.5"/>' +
    '<path d="M7 11 L8.5 12.5 L12 9.5"/>' +
    '<line x1="7" y1="15" x2="13" y2="15"/>' +
    '<path d="M4 3 L16 3 L16 18 L4 18 Z" fill="currentColor" opacity="0.08" stroke="none"/>'
  ),
  scorer: svgWrap(
    '<circle cx="10" cy="10" r="8"/>' +
    '<path d="M7 12.5 C7.5 14 12.5 14 13 11.8 C13.4 10 8.1 10.4 8.4 8.2 C8.7 6.2 12.2 6.2 13 7.7"/>' +
    '<line x1="10" y1="4.5" x2="10" y2="6.4"/>' +
    '<line x1="10" y1="13.6" x2="10" y2="15.5"/>' +
    '<circle cx="10" cy="10" r="4" fill="currentColor" opacity="0.08" stroke="none"/>'
  ),
  deep_work: svgWrap(
    '<rect x="3" y="4" width="14" height="12" rx="1"/>' +
    '<circle cx="10" cy="10" r="3.5"/>' +
    '<circle cx="10" cy="10" r="1.3" fill="currentColor" opacity="0.45" stroke="none"/>' +
    '<line x1="10" y1="2" x2="10" y2="5"/>' +
    '<line x1="10" y1="15" x2="10" y2="18"/>' +
    '<line x1="2" y1="10" x2="5" y2="10"/>' +
    '<line x1="15" y1="10" x2="18" y2="10"/>'
  ),
  consistency: svgWrap(
    '<rect x="3" y="4" width="14" height="14"/>' +
    '<line x1="3" y1="8" x2="17" y2="8"/>' +
    '<line x1="7" y1="2.5" x2="7" y2="5.5"/>' +
    '<line x1="13" y1="2.5" x2="13" y2="5.5"/>' +
    '<path d="M6 12 L8 14 L13.5 10" stroke-width="1.8"/>' +
    '<rect x="3" y="4" width="14" height="14" fill="currentColor" opacity="0.05" stroke="none"/>'
  ),
  fellowship: svgWrap(
    '<circle cx="6" cy="10" r="3.5"/>' +
    '<circle cx="14" cy="10" r="3.5"/>' +
    '<path d="M8.8 7.8 C10 6.6 10 6.6 11.2 7.8"/>' +
    '<path d="M8.8 12.2 C10 13.4 10 13.4 11.2 12.2"/>' +
    '<circle cx="6" cy="10" r="1.2" fill="currentColor" opacity="0.35" stroke="none"/>' +
    '<circle cx="14" cy="10" r="1.2" fill="currentColor" opacity="0.55" stroke="none"/>'
  ),
  event_runner: svgWrap(
    '<path d="M11 2 L4 11 H10 L9 18 L16 8 H10 Z" fill="currentColor" opacity="0.18"/>' +
    '<path d="M11 2 L4 11 H10 L9 18 L16 8 H10 Z"/>' +
    '<line x1="4" y1="16" x2="7" y2="16" opacity="0.5"/>' +
    '<line x1="13" y1="4" x2="17" y2="4" opacity="0.5"/>'
  ),
  treasurer: svgWrap(
    '<circle cx="10" cy="10" r="8"/>' +
    '<circle cx="10" cy="10" r="5.5" fill="currentColor" opacity="0.08"/>' +
    '<path d="M7.5 12.2 C8.2 13.5 12.2 13.4 12.6 11.6 C13 9.9 8.1 10.4 8.5 8.2 C8.8 6.5 12.1 6.5 12.7 7.8"/>' +
    '<line x1="10" y1="5.7" x2="10" y2="7"/>' +
    '<line x1="10" y1="13" x2="10" y2="14.3"/>'
  ),
  signature: svgWrap(
    '<path d="M4 4 H16 V16 H4 Z"/>' +
    '<path d="M4 4 H16 V16 H4 Z" fill="currentColor" opacity="0.08" stroke="none"/>' +
    '<path d="M7 12 C8.5 8.5 9.2 14 11 10 C12 7.8 12.7 9.5 14 8.5"/>' +
    '<line x1="6" y1="6.5" x2="11" y2="6.5"/>' +
    '<line x1="6" y1="14" x2="14" y2="14"/>'
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
      { tier: 1, label: 'Legacy I',  desc: 'Wrote 1,000 words in a single feed post.' },
      { tier: 2, label: 'Archive II', desc: 'Wrote 10,000 words in a single feed post.' },
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
    id: 'climber',
    icon: ICONS.climber,
    color: '#38bdf8',
    tiers: [
      { tier: 1, label: 'Climber I',       desc: 'Reached Bronze or higher.' },
      { tier: 2, label: 'Gold Route II',    desc: 'Reached Gold or higher.' },
      { tier: 3, label: 'Diamond Line III', desc: 'Reached Diamond or higher.' },
      { tier: 4, label: 'Ascendant IV',     desc: 'Reached Ascendant or higher.' },
      { tier: 5, label: 'Radiant V',        desc: 'Reached Radiant.' },
    ],
  },
  {
    id: 'clutch',
    icon: ICONS.clutch,
    color: '#f97316',
    tiers: [
      { tier: 1, label: 'Clutch I',       desc: 'Won a match by 50 team points or fewer.' },
      { tier: 2, label: 'Last Call II',   desc: 'Won a match by 20 team points or fewer.' },
      { tier: 3, label: 'Knife Edge III', desc: 'Won a match by 5 team points or fewer.' },
    ],
  },
  {
    id: 'momentum',
    icon: ICONS.momentum,
    color: '#22d3ee',
    tiers: [
      { tier: 1, label: 'Momentum I',       desc: 'Gained at least 25 ELO from a single match.' },
      { tier: 2, label: 'Surge II',         desc: 'Gained at least 50 ELO from a single match.' },
      { tier: 3, label: 'Breakthrough III', desc: 'Gained at least 100 ELO from a single match.' },
    ],
  },
  {
    id: 'grinder',
    icon: ICONS.grinder,
    color: '#a78bfa',
    tiers: [
      { tier: 1, label: 'Grinder I',        desc: 'Completed 50 tasks.' },
      { tier: 2, label: 'Operator II',      desc: 'Completed 250 tasks.' },
      { tier: 3, label: 'Workhorse III',    desc: 'Completed 1,000 tasks.' },
    ],
  },
  {
    id: 'scorer',
    icon: ICONS.scorer,
    color: '#fbbf24',
    tiers: [
      { tier: 1, label: 'Scorer I',       desc: 'Earned 1,000 lifetime task points.' },
      { tier: 2, label: 'High Value II',  desc: 'Earned 10,000 lifetime task points.' },
      { tier: 3, label: 'Point Engine III', desc: 'Earned 100,000 lifetime task points.' },
    ],
  },
  {
    id: 'deep_work',
    icon: ICONS.deep_work,
    color: '#60a5fa',
    tiers: [
      { tier: 1, label: 'Deep Work I',      desc: 'Completed a single task session lasting at least 2 hours.' },
      { tier: 2, label: 'Flow State II',    desc: 'Completed a single task session lasting at least 4 hours.' },
      { tier: 3, label: 'Total Immersion III', desc: 'Completed a single task session lasting at least 8 hours.' },
    ],
  },
  {
    id: 'consistency',
    icon: ICONS.consistency,
    color: '#4ade80',
    tiers: [
      { tier: 1, label: 'Consistency I',   desc: 'Completed tasks on 3 consecutive days.' },
      { tier: 2, label: 'Rhythm II',       desc: 'Completed tasks on 7 consecutive days.' },
      { tier: 3, label: 'Ritual III',      desc: 'Completed tasks on 30 consecutive days.' },
    ],
  },
  {
    id: 'event_runner',
    icon: ICONS.event_runner,
    color: '#2dd4bf',
    tiers: [
      { tier: 1, label: 'Habit Runner I',   desc: 'Logged 10 habit check-ins or quantity updates.' },
      { tier: 2, label: 'Signal Keeper II', desc: 'Logged 100 habit check-ins or quantity updates.' },
      { tier: 3, label: 'System Master III',desc: 'Logged 500 habit check-ins or quantity updates.' },
    ],
  },
  {
    id: 'fellowship',
    icon: ICONS.fellowship,
    color: '#a78bfa',
    tiers: [
      { tier: 1, label: 'Fellowship I',      desc: 'Provided a cumulative 1× bonus to the profiles that followed you.' },
      { tier: 2, label: 'Stewardship II',    desc: 'Provided a cumulative 10× bonus to the profiles that followed you.' },
      { tier: 3, label: 'Legacy of Care III',desc: 'Provided a cumulative 100× bonus to the profiles that followed you.' },
    ],
  },
  {
    id: 'treasurer',
    icon: ICONS.treasurer,
    color: '#34d399',
    tiers: [
      { tier: 1, label: 'Treasurer I',    desc: 'Logged $100 in economy income.' },
      { tier: 2, label: 'Ledger II',      desc: 'Logged $1,000 in economy income.' },
      { tier: 3, label: 'Vault III',      desc: 'Logged $10,000 in economy income.' },
    ],
  },
  {
    id: 'signature',
    icon: ICONS.signature,
    color: '#f472b6',
    tiers: [
      { tier: 1, label: 'Signature I',   desc: 'Added at least 2 meaningful profile customization elements.' },
      { tier: 2, label: 'Persona II',    desc: 'Added at least 4 meaningful profile customization elements.' },
      { tier: 3, label: 'Living Page III', desc: 'Added at least 6 meaningful profile customization elements.' },
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

export const ACHIEVEMENT_CATEGORIES = [
  { id: 'competition', label: 'Competition' },
  { id: 'discipline', label: 'Discipline' },
  { id: 'events', label: 'Habits' },
  { id: 'economy', label: 'Economy' },
  { id: 'collection', label: 'Collection' },
  { id: 'social', label: 'Social' },
  { id: 'identity', label: 'Identity' },
];

const ACHIEVEMENT_GROUP_META = {
  king_of_the_hill: {
    name: 'King of the Hill',
    category: 'competition',
    summary: 'Lifetime points supremacy across every profile.',
  },
  overkill: {
    name: 'Overkill',
    category: 'competition',
    summary: 'Win matches by increasingly dominant team-point margins.',
  },
  underdog: {
    name: 'Underdog',
    category: 'competition',
    summary: 'Beat opponents while fighting above your rank class.',
  },
  contributor: {
    name: 'Contributor',
    category: 'competition',
    summary: 'Carry a larger share of your team score in match play.',
  },
  soldier: {
    name: 'Soldier',
    category: 'competition',
    summary: 'Build long current win streaks.',
  },
  peace: {
    name: 'Peace',
    category: 'discipline',
    summary: 'Post dojo sessions strong enough to place on the board.',
  },
  legacy: {
    name: 'Legacy',
    category: 'discipline',
    summary: 'Write unusually large feed posts.',
  },
  basket: {
    name: 'Basket',
    category: 'collection',
    summary: 'Build a deep profile timeline.',
  },
  hobbyist: {
    name: 'Hobbyist',
    category: 'collection',
    summary: 'Own more of the paid cosmetic catalog.',
  },
  scholar: {
    name: 'Scholar',
    category: 'discipline',
    summary: 'Complete many tasks in a single day.',
  },
  long_game: {
    name: 'The Long Game',
    category: 'competition',
    summary: 'Play more completed matches on your profile.',
  },
  climber: {
    name: 'Climber',
    category: 'competition',
    summary: 'Reach higher major rank groups.',
  },
  clutch: {
    name: 'Clutch',
    category: 'competition',
    summary: 'Win matches by narrow margins.',
  },
  momentum: {
    name: 'Momentum',
    category: 'competition',
    summary: 'Create major positive ELO swings.',
  },
  grinder: {
    name: 'Grinder',
    category: 'discipline',
    summary: 'Complete a large number of tasks.',
  },
  scorer: {
    name: 'Scorer',
    category: 'discipline',
    summary: 'Earn more lifetime task points.',
  },
  deep_work: {
    name: 'Deep Work',
    category: 'discipline',
    summary: 'Complete longer focused task sessions.',
  },
  consistency: {
    name: 'Consistency',
    category: 'discipline',
    summary: 'Build consecutive days with completed work.',
  },
  event_runner: {
    name: 'Habit Runner',
    category: 'events',
    summary: 'Use habits and subquests consistently.',
  },
  fellowship: {
    name: 'Fellowship',
    category: 'events',
    summary: 'Leave stronger sleep-time multipliers for the next player.',
  },
  treasurer: {
    name: 'Treasurer',
    category: 'economy',
    summary: 'Log more real economy income.',
  },
  signature: {
    name: 'Signature',
    category: 'identity',
    summary: 'Customize your profile into a more complete personal page.',
  },
  town: {
    name: 'Town',
    category: 'social',
    summary: 'Grow your accepted friend network.',
  },
  savant: {
    name: 'Savant',
    category: 'competition',
    summary: 'Hold the top rank, top lifetime points, and full cosmetic ownership at once.',
  },
};

export const ACHIEVEMENT_THRESHOLDS = {
  overkill: [300, 500, 1000],
  underdog: [1, 3],
  contributor: [0.30, 0.50, 0.70],
  soldier: [2, 3, 5, 10, 100],
  basket: [10, 100, 1000],
  hobbyist: [
    Math.ceil(TOTAL_PAID_COSMETICS * 0.25),
    Math.ceil(TOTAL_PAID_COSMETICS * 0.50),
    TOTAL_PAID_COSMETICS,
  ],
  scholar: [10, 20],
  legacy: [1000, 10000],
  long_game: [10, 100],
  climber: [225, 675, 1200, 1650, 3000],
  clutch: [50, 20, 5],
  momentum: [25, 50, 100],
  grinder: [50, 250, 1000],
  scorer: [1000, 10000, 100000],
  deep_work: [2, 4, 8],
  consistency: [3, 7, 30],
  event_runner: [10, 100, 500],
  fellowship: [1, 10, 100],
  treasurer: [100, 1000, 10000],
  signature: [2, 4, 6],
  town: [5, 10, 20],
};

for (const group of ACHIEVEMENT_GROUPS) {
  Object.assign(group, ACHIEVEMENT_GROUP_META[group.id] || {
    name: group.tiers?.[0]?.label || group.id,
    category: 'competition',
    summary: group.tiers?.[0]?.desc || '',
  });
}

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
  // Inventory entries with cosmetic types (themes, titles, passes)
  const cosmeticTypes = new Set([
    'cosmetic_theme', 'cosmetic_title',
    'cosmetic_card_banner', 'cosmetic_profile_banner', 'cosmetic_lobby_banner',
    'cosmetic_profile_block',
  ]);
  const ids = new Set();
  for (const item of inventory) {
    if (cosmeticTypes.has(item.type)) {
      ids.add(item.itemId || item.name);
    }
  }
  return ids.size;
}

function completedTasksFor(tasks, playerUUID) {
  return tasks.filter((task) => task.parent === playerUUID && task.completedAt);
}

function taskDurationHours(task) {
  if (!task?.createdAt || !task?.completedAt) return 0;
  const ms = new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return ms / (1000 * 60 * 60);
}

function bestTaskDurationHours(tasks, playerUUID) {
  return Math.max(0, ...completedTasksFor(tasks, playerUUID).map(taskDurationHours));
}

function longestCompletedDayStreak(tasks, playerUUID) {
  const days = [...new Set(completedTasksFor(tasks, playerUUID)
    .map((task) => String(task.completedAt || '').split('T')[0])
    .filter(Boolean))]
    .sort();

  let best = 0;
  let current = 0;
  let previousTime = null;

  for (const day of days) {
    const time = new Date(`${day}T00:00:00`).getTime();
    if (!Number.isFinite(time)) continue;
    if (previousTime != null && time - previousTime === 24 * 60 * 60 * 1000) {
      current += 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
    previousTime = time;
  }
  return best;
}

function bestWinningMargin(matches, playerUUID) {
  const wins = matches
    .filter((match) => match.status === 'complete' && match.result)
    .map((match) => {
      const team1 = match.teams?.[0] || [];
      const onTeam1 = team1.some((p) => String(p.UUID) === String(playerUUID));
      const won = (match.result.winner === 1 && onTeam1) || (match.result.winner === 2 && !onTeam1);
      if (!won) return null;
      return Math.abs((match.result.team1Total || 0) - (match.result.team2Total || 0));
    })
    .filter((margin) => margin != null);
  return wins.length ? Math.min(...wins) : Infinity;
}

function bestEloGain(matches) {
  return Math.max(0, ...matches
    .filter((match) => match.status === 'complete')
    .map((match) => Number(match.result?.eloChange || 0)));
}

function eventLogCount(eventLogs, playerUUID) {
  return eventLogs.filter((log) => log.parent === playerUUID).length;
}

function fellowshipContribution(eventLogs, playerUUID) {
  return eventLogs
    .filter((log) => log.parent === playerUUID && log.specialKind === SPECIAL_KIND.sleep_time && log.status === 'success')
    .reduce((sum, log) => sum + Math.max(0, (Number(log.multiplierValue) || 1) - 1), 0);
}

function economyLoggedTotal(transactions, playerUUID) {
  return transactions
    .filter((entry) => entry.parent === playerUUID && entry.type === 'money_log')
    .reduce((sum, entry) => sum + Math.max(0, Number(entry.amount ?? entry.cost ?? 0)), 0);
}

function profileSignatureScore(player) {
  const prefs = player.profilePersonalization || {};
  const links = Array.isArray(prefs.links) ? prefs.links : (Array.isArray(prefs.socialLinks) ? prefs.socialLinks : []);
  const hasLink = links.some((link) => link?.label || link?.url);
  const scoreParts = [
    prefs.tagline,
    prefs.about || prefs.aboutMarkdown,
    prefs.quote,
    hasLink,
    player.activeCosmetics?.profileBanner,
    prefs.skin && prefs.skin !== 'arena',
    player.activeCosmetics?.title,
  ];
  return scoreParts.filter(Boolean).length;
}

export function getAchievementTierKey(groupId, tier) {
  return `${groupId}_${tier}`;
}

/* ─── Progress computation for grouped achievement stages ─── */
function computeCounterProgress(groupId, tier, counters, leaderboard = {}) {
  const threshold = ACHIEVEMENT_THRESHOLDS[groupId]?.[tier - 1];
  const bounded = (value, label) => threshold == null
    ? null
    : { value: Math.min(Number(value || 0), threshold), max: threshold, label };

  switch (groupId) {
    case 'overkill': return bounded(counters.largestWinningMargin, 'Best winning margin');
    case 'soldier': return bounded(counters.currentWinStreak, 'Current win streak');
    case 'long_game': return bounded(counters.completedMatches, 'Completed matches');
    case 'climber': return bounded(counters.currentElo, 'Current ELO');
    case 'clutch': {
      if (threshold == null) return null;
      const best = counters.bestWinningMargin == null ? Infinity : Number(counters.bestWinningMargin);
      return {
        value: best <= threshold ? threshold : 0,
        max: threshold,
        label: best === Infinity ? 'Closest winning margin' : `Closest win: ${best} pts`,
      };
    }
    case 'momentum': return bounded(counters.bestEloGain, 'Best single-match ELO gain');
    case 'grinder': return bounded(counters.completedTasks, 'Completed tasks');
    case 'scorer': return bounded(counters.lifetimeTaskPoints, 'Lifetime task points');
    case 'deep_work': return bounded(Math.floor(Number(counters.maxTaskDurationHours || 0) * 10) / 10, 'Longest task session hours');
    case 'consistency': return bounded(counters.longestTaskDayStreak, 'Best day streak');
    case 'basket': return bounded(counters.timelineEntries, 'Timeline entries');
    case 'hobbyist': return bounded(counters.ownedCosmetics, 'Cosmetics owned');
    case 'event_runner': return bounded(counters.eventLogs, 'Habit logs');
    case 'fellowship': return bounded(Math.round(Number(counters.fellowshipContribution || 0) * 1000) / 1000, 'Cumulative multiplier provided');
    case 'treasurer': return bounded(Math.floor(Number(counters.economyLoggedTotal || 0)), 'Economy income logged');
    case 'signature': return bounded(counters.profileSignatureScore, 'Profile elements customized');
    case 'scholar': return bounded(counters.bestTasksInDay, 'Best task day');
    case 'legacy': return bounded(counters.maxJournalWords, 'Longest entry words');
    case 'town': return bounded(counters.acceptedFriends, 'Accepted friends');
    case 'king_of_the_hill': {
      if (tier !== 2) return null;
      const top = Math.max(1, Number(leaderboard.topTaskPoints || 0));
      return {
        value: Math.min(Number(counters.lifetimeTaskPoints || 0), top),
        max: top,
        label: 'Lifetime points vs top',
      };
    }
    default:
      return undefined;
  }
}

export function computeAchievementProgress(groupId, tier, playerData = {}) {
  const {
    tasks = [],
    journals = [],
    events = [],
    eventLogs = [],
    transactions = [],
    matches = [],
    friends = [],
    inventory = [],
    allPlayers = [],
    player = null,
    playerUUID,
    achievementCounters = null,
    achievementLeaderboard = null,
  } = playerData;

  if (achievementCounters) {
    const progress = computeCounterProgress(groupId, tier, achievementCounters, achievementLeaderboard || {});
    if (progress !== undefined) return progress;
  }

  switch (groupId) {
    case 'overkill': {
      const max = ACHIEVEMENT_THRESHOLDS.overkill[tier - 1];
      if (!max) return null;
      const best = Math.max(0, ...matches
        .filter((m) => {
          if (m.status !== 'complete' || !m.result) return false;
          const t1 = m.teams?.[0] || [];
          const onT1 = t1.some((p) => String(p.UUID) === String(playerUUID));
          const won = (m.result.winner === 1 && onT1) || (m.result.winner === 2 && !onT1);
          return won;
        })
        .map((m) => Math.abs((m.result.team1Total || 0) - (m.result.team2Total || 0))));
      return { value: Math.min(best, max), max, label: 'Best winning margin' };
    }
    case 'soldier': {
      const max = ACHIEVEMENT_THRESHOLDS.soldier[tier - 1];
      if (!max) return null;
      const sorted = [...matches]
        .filter((m) => m.status === 'complete' && m.result)
        .sort((a, b) => String(b.result?.concludedAt || b.createdAt || '').localeCompare(String(a.result?.concludedAt || a.createdAt || '')));
      let streak = 0;
      for (const m of sorted) {
        const t1 = m.teams?.[0] || [];
        const onT1 = t1.some((p) => String(p.UUID) === String(playerUUID));
        const won = (m.result.winner === 1 && onT1) || (m.result.winner === 2 && !onT1);
        if (won) streak += 1;
        else break;
      }
      return { value: Math.min(streak, max), max, label: 'Current win streak' };
    }
    case 'long_game': {
      const max = ACHIEVEMENT_THRESHOLDS.long_game[tier - 1];
      if (!max) return null;
      const count = matches.filter((m) => m.status === 'complete').length;
      return { value: Math.min(count, max), max, label: 'Completed matches' };
    }
    case 'climber': {
      const max = ACHIEVEMENT_THRESHOLDS.climber[tier - 1];
      if (!max) return null;
      const elo = Number(player?.elo || 0);
      return { value: Math.min(elo, max), max, label: 'Current ELO' };
    }
    case 'clutch': {
      const max = ACHIEVEMENT_THRESHOLDS.clutch[tier - 1];
      if (!max) return null;
      const best = bestWinningMargin(matches, playerUUID);
      return {
        value: best <= max ? max : 0,
        max,
        label: best === Infinity ? 'Closest winning margin' : `Closest win: ${best} pts`,
      };
    }
    case 'momentum': {
      const max = ACHIEVEMENT_THRESHOLDS.momentum[tier - 1];
      if (!max) return null;
      const best = bestEloGain(matches);
      return { value: Math.min(best, max), max, label: 'Best single-match ELO gain' };
    }
    case 'grinder': {
      const max = ACHIEVEMENT_THRESHOLDS.grinder[tier - 1];
      if (!max) return null;
      const count = completedTasksFor(tasks, playerUUID).length;
      return { value: Math.min(count, max), max, label: 'Completed tasks' };
    }
    case 'scorer': {
      const max = ACHIEVEMENT_THRESHOLDS.scorer[tier - 1];
      if (!max) return null;
      const points = lifetimePoints(tasks, playerUUID);
      return { value: Math.min(points, max), max, label: 'Lifetime task points' };
    }
    case 'deep_work': {
      const max = ACHIEVEMENT_THRESHOLDS.deep_work[tier - 1];
      if (!max) return null;
      const best = bestTaskDurationHours(tasks, playerUUID);
      return { value: Math.min(Math.floor(best * 10) / 10, max), max, label: 'Longest task session hours' };
    }
    case 'consistency': {
      const max = ACHIEVEMENT_THRESHOLDS.consistency[tier - 1];
      if (!max) return null;
      const streak = longestCompletedDayStreak(tasks, playerUUID);
      return { value: Math.min(streak, max), max, label: 'Best day streak' };
    }
    case 'basket': {
      const max = ACHIEVEMENT_THRESHOLDS.basket[tier - 1];
      if (!max) return null;
      const count = timelineCount(tasks, journals, events, playerUUID);
      return { value: Math.min(count, max), max, label: 'Timeline entries' };
    }
    case 'hobbyist': {
      const max = ACHIEVEMENT_THRESHOLDS.hobbyist[tier - 1];
      if (!max) return null;
      const owned = ownedCosmeticCount(inventory);
      return { value: Math.min(owned, max), max, label: 'Cosmetics owned' };
    }
    case 'event_runner': {
      const max = ACHIEVEMENT_THRESHOLDS.event_runner[tier - 1];
      if (!max) return null;
      const count = eventLogCount(eventLogs, playerUUID);
      return { value: Math.min(count, max), max, label: 'Habit logs' };
    }
    case 'fellowship': {
      const max = ACHIEVEMENT_THRESHOLDS.fellowship[tier - 1];
      if (!max) return null;
      const contribution = fellowshipContribution(eventLogs, playerUUID);
      return {
        value: Math.min(Math.round(contribution * 1000) / 1000, max),
        max,
        label: 'Cumulative multiplier provided',
      };
    }
    case 'treasurer': {
      const max = ACHIEVEMENT_THRESHOLDS.treasurer[tier - 1];
      if (!max) return null;
      const total = Math.floor(economyLoggedTotal(transactions, playerUUID));
      return { value: Math.min(total, max), max, label: 'Economy income logged' };
    }
    case 'signature': {
      const max = ACHIEVEMENT_THRESHOLDS.signature[tier - 1];
      if (!max) return null;
      const score = profileSignatureScore(player || {});
      return { value: Math.min(score, max), max, label: 'Profile elements customized' };
    }
    case 'scholar': {
      const max = ACHIEVEMENT_THRESHOLDS.scholar[tier - 1];
      if (!max) return null;
      const byDay = {};
      for (const t of completedTasksFor(tasks, playerUUID)) {
        const day = t.completedAt.split('T')[0];
        byDay[day] = (byDay[day] || 0) + 1;
      }
      const best = Math.max(0, ...Object.values(byDay));
      return { value: Math.min(best, max), max, label: 'Best task day' };
    }
    case 'legacy': {
      const max = ACHIEVEMENT_THRESHOLDS.legacy[tier - 1];
      if (!max) return null;
      const myJournals = journals.filter((j) => j.parent === playerUUID);
      const best = Math.max(0, ...myJournals.map((j) => (j.entry || '').trim().split(/\s+/).filter(Boolean).length));
      return { value: Math.min(best, max), max, label: 'Longest entry words' };
    }
    case 'town': {
      const max = ACHIEVEMENT_THRESHOLDS.town[tier - 1];
      if (!max) return null;
      const count = friends.filter((f) => f.status === 'accepted').length;
      return { value: Math.min(count, max), max, label: 'Accepted friends' };
    }
    case 'king_of_the_hill': {
      if (tier !== 2) return null;
      const myPts = lifetimePoints(tasks, playerUUID);
      const topPts = Math.max(...allPlayers.map((p) => lifetimePoints(tasks, p.UUID)), 1);
      return { value: Math.min(myPts, topPts), max: topPts, label: 'Lifetime points vs top' };
    }
    default:
      return null;
  }
}

export function getAchievementGroupStatus(group, achievements = {}, playerData = {}) {
  const categoryLabel = ACHIEVEMENT_CATEGORIES.find((category) => category.id === group.category)?.label || group.category;
  const tierStatuses = group.tiers.map((tier) => {
    const key = getAchievementTierKey(group.id, tier.tier);
    return {
      ...tier,
      key,
      earned: !!achievements[key],
      earnedAt: achievements[key]?.earnedAt || null,
      progress: computeAchievementProgress(group.id, tier.tier, playerData),
    };
  });

  const earnedTiers = tierStatuses.filter((tier) => tier.earned);
  const currentTier = earnedTiers[earnedTiers.length - 1] || null;
  const nextTier = tierStatuses.find((tier) => !tier.earned) || null;
  const progressTier = nextTier || currentTier || tierStatuses[0] || null;
  const progress = progressTier?.progress || null;
  const progressPct = progress
    ? Math.min(100, Math.round((progress.value / Math.max(1, progress.max)) * 100))
    : currentTier && !nextTier ? 100 : 0;

  return {
    ...group,
    categoryLabel,
    earned: !!currentTier,
    currentTier,
    nextTier,
    tierStatuses,
    progress,
    progressPct,
    displayLabel: currentTier?.label || group.name,
    displaySubLabel: currentTier ? `Stage ${currentTier.tier} of ${group.tiers.length}` : group.summary,
    stageCount: group.tiers.length,
  };
}

export function getAchievementCategorySections(statuses) {
  return ACHIEVEMENT_CATEGORIES
    .map((category) => ({
      ...category,
      achievements: statuses.filter((status) => status.category === category.id),
    }))
    .filter((category) => category.achievements.length > 0);
}

/* ─── Grant helper ────────────────────────────────────────── */
function grant(achievements, key) {
  if (achievements[key]) return false; // already have it
  // eslint-disable-next-line no-param-reassign
  achievements[key] = { earnedAt: new Date().toISOString() };
  return true;
}

function grantTiered(achievements, earned, groupId, value, predicate = (current, threshold) => current >= threshold) {
  const thresholds = ACHIEVEMENT_THRESHOLDS[groupId] || [];
  thresholds.forEach((threshold, index) => {
    const key = `${groupId}_${index + 1}`;
    if (predicate(value, threshold) && grant(achievements, key)) earned.push(key);
  });
}

function safeGetAll(db, store) {
  return db.getAll(store).catch((err) => {
    console.warn('[Achievements] optional store read failed:', store, err);
    return [];
  });
}

function safeGetPlayerStore(db, store, playerUUID) {
  return db.getPlayerStore(store, playerUUID).catch((err) => {
    console.warn('[Achievements] optional player store read failed:', store, err);
    return [];
  });
}

/* ═══════════════════════════════════════════════════════════
   reconcileAchievements
   Full scan reserved for migration, repair, explicit reconciliation, and development verification.
═══════════════════════════════════════════════════════════ */
export async function reconcileAchievements(player, db, { reason, data = null } = {}) {
  const allowedReasons = new Set(['migration', 'repair', 'explicit-reconciliation', 'development-verification']);
  if (!allowedReasons.has(reason)) {
    throw new Error('Full achievement reconciliation requires an explicit allowed reason.');
  }
  const achievements = { ...(player.achievements || {}) };
  const selectedAchievements = (player.selectedAchievements || [])
    .map((key) => (typeof key === 'string' && key.startsWith('architect_') ? null : key));
  const earned = [];

  for (const key of Object.keys(achievements)) {
    if (key.startsWith('architect_')) delete achievements[key];
  }

  const [allTasks, allJournals, allEvents, allPlayersDB, inventory, friendships, allTransactions, allEventLogs] = data
    ? [
      data.tasks || [],
      data.journals || [],
      data.events || [],
      data.allPlayers || [],
      data.inventory || [],
      data.friends || [],
      data.transactions || [],
      data.eventLogs || [],
    ]
    : await Promise.all([
      safeGetAll(db, STORES.task),
      safeGetAll(db, STORES.journal),
      safeGetAll(db, STORES.event),
      db.getAllPlayers().catch(() => []),
      safeGetPlayerStore(db, STORES.inventory, player.UUID),
      db.getFriendshipsForPlayer(player.UUID).catch(() => []),
      safeGetAll(db, STORES.transaction),
      safeGetAll(db, STORES.eventLog),
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

  /* ── Climber ─── */
  grantTiered(achievements, earned, 'climber', Number(player.elo || 0));

  /* ── Timeline basket ─── */
  const tlCount = timelineCount(allTasks, allJournals, allEvents, player.UUID);
  if (tlCount >= ACHIEVEMENT_THRESHOLDS.basket[2] && grant(achievements, 'basket_3')) earned.push('basket_3');
  if (tlCount >= ACHIEVEMENT_THRESHOLDS.basket[1] && grant(achievements, 'basket_2')) earned.push('basket_2');
  if (tlCount >= ACHIEVEMENT_THRESHOLDS.basket[0] && grant(achievements, 'basket_1')) earned.push('basket_1');

  /* ── Grinder / Scorer / Deep Work / Consistency ─── */
  const completedTasks = completedTasksFor(allTasks, player.UUID);
  grantTiered(achievements, earned, 'grinder', completedTasks.length);
  grantTiered(achievements, earned, 'scorer', myPts);
  grantTiered(achievements, earned, 'deep_work', bestTaskDurationHours(allTasks, player.UUID));
  grantTiered(achievements, earned, 'consistency', longestCompletedDayStreak(allTasks, player.UUID));

  /* ── Hobbyist / Completionist / Maximalist ─── */
  const owned = ownedCosmeticCount(inventory);
  if (owned >= ACHIEVEMENT_THRESHOLDS.hobbyist[2] && grant(achievements, 'hobbyist_3')) earned.push('hobbyist_3');
  if (owned >= ACHIEVEMENT_THRESHOLDS.hobbyist[1] && grant(achievements, 'hobbyist_2')) earned.push('hobbyist_2');
  if (owned >= ACHIEVEMENT_THRESHOLDS.hobbyist[0] && grant(achievements, 'hobbyist_1')) earned.push('hobbyist_1');

  /* ── Events / Economy / Identity ─── */
  grantTiered(achievements, earned, 'event_runner', eventLogCount(allEventLogs, player.UUID));
  grantTiered(achievements, earned, 'fellowship', fellowshipContribution(allEventLogs, player.UUID));
  grantTiered(achievements, earned, 'treasurer', economyLoggedTotal(allTransactions, player.UUID));
  grantTiered(achievements, earned, 'signature', profileSignatureScore(player));

  /* ── Scholar ─── */
  const tasksByDay = {};
  for (const t of completedTasks) {
    const day = t.completedAt.split('T')[0];
    tasksByDay[day] = (tasksByDay[day] || 0) + 1;
  }
  const maxTaskDay = Math.max(0, ...Object.values(tasksByDay));
  if (maxTaskDay >= ACHIEVEMENT_THRESHOLDS.scholar[1] && grant(achievements, 'scholar_2')) earned.push('scholar_2');
  if (maxTaskDay >= ACHIEVEMENT_THRESHOLDS.scholar[0] && grant(achievements, 'scholar_1')) earned.push('scholar_1');

  /* ── Legacy / Archive ─── */
  const myJournals = allJournals.filter((j) => j.parent === player.UUID);
  const maxWords   = Math.max(0, ...myJournals.map((j) => (j.entry || '').trim().split(/\s+/).filter(Boolean).length));
  if (maxWords >= ACHIEVEMENT_THRESHOLDS.legacy[1] && grant(achievements, 'legacy_2')) earned.push('legacy_2');
  if (maxWords >= ACHIEVEMENT_THRESHOLDS.legacy[0] && grant(achievements, 'legacy_1')) earned.push('legacy_1');

  /* ── Town / Inner Empire / Civilization ─── */
  const friendCount = friendships.filter((f) => f.status === 'accepted').length;
  if (friendCount >= ACHIEVEMENT_THRESHOLDS.town[2] && grant(achievements, 'town_3')) earned.push('town_3');
  if (friendCount >= ACHIEVEMENT_THRESHOLDS.town[1] && grant(achievements, 'town_2')) earned.push('town_2');
  if (friendCount >= ACHIEVEMENT_THRESHOLDS.town[0] && grant(achievements, 'town_1')) earned.push('town_1');

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
  const allMatches = data?.matches || await db.getMatchesForPlayer(player.UUID);
  const matchCount = allMatches.filter((m) => m.status === 'complete').length;
  if (matchCount >= ACHIEVEMENT_THRESHOLDS.long_game[1] && grant(achievements, 'long_game_2')) earned.push('long_game_2');
  if (matchCount >= ACHIEVEMENT_THRESHOLDS.long_game[0] && grant(achievements, 'long_game_1')) earned.push('long_game_1');
  grantTiered(achievements, earned, 'soldier', currentWinStreak(allMatches, player.UUID));
  grantTiered(achievements, earned, 'clutch', bestWinningMargin(allMatches, player.UUID), (margin, threshold) => margin <= threshold);
  grantTiered(achievements, earned, 'momentum', bestEloGain(allMatches));

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
  const prevSelectedJSON = JSON.stringify(player.selectedAchievements || []);
  const nextSelectedJSON = JSON.stringify(selectedAchievements);
  if (prevJSON !== nextJSON || prevSelectedJSON !== nextSelectedJSON) {
    await db.add(STORES.player, {
      ...player,
      achievements,
      ...(prevSelectedJSON !== nextSelectedJSON ? { selectedAchievements } : {}),
    });
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
