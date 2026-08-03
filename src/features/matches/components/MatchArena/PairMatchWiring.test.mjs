import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [arena, arenaStyles, lobby, lobbyStyles, rank, completion] = await Promise.all([
  readFile(new URL('./MatchArena.jsx', import.meta.url), 'utf8'),
  readFile(new URL('./MatchArena.css', import.meta.url), 'utf8'),
  readFile(new URL('../../../lobby/components/Lobby/Lobby.jsx', import.meta.url), 'utf8'),
  readFile(new URL('../../../lobby/components/Lobby/Lobby.css', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/rank/Rank.js', import.meta.url), 'utf8'),
  readFile(new URL('../../../../domain/matches/MatchCompletionService.js', import.meta.url), 'utf8'),
]);

test('Pair Match has one fixed contract and no configurable lobby selectors', () => {
  assert.match(lobby, /PAIR_MATCH_RULESET_ID/);
  assert.match(lobby, /60 minutes · rated · 2v2/);
  assert.match(lobby, /status: MATCH_STATUS\.pending/);
  assert.doesNotMatch(lobby, /<select/);
  assert.doesNotMatch(lobby, /setMatchMode|setMatchRatingMode|setMatchScoreVisibility/);
  assert.doesNotMatch(lobby, /One contract|pair_match_v1/);
  assert.doesNotMatch(rank, /getMatchDurationForRank|matchDurationHours/);
});

test('Pair Match surfaces use theme tokens and explicit old-Windows, pixel, and reward treatments', () => {
  for (const styles of [arenaStyles, lobbyStyles]) {
    assert.match(styles, /--theme-card-radius|--theme-panel-inset|--theme-card-shadow/);
    assert.match(styles, /\[data-theme="old_windows"\]/);
    assert.match(styles, /\[data-theme="pixelated"\]/);
    assert.match(styles, /\[data-theme="gamification"\]/);
  }
  assert.doesNotMatch(lobbyStyles, /\.lobby-action-card strong\s*\{/);
  assert.match(lobbyStyles, /\.lobby-action-card__main > strong/);
});

test('Pair Match reveals teams, locks on ready, and keeps only the live arena views', () => {
  assert.match(arena, /TEAM REVEAL/);
  assert.match(arena, /READY CHECK/);
  assert.match(arena, /lockedAt/);
  assert.match(arena, /phase: 'work'/);
  assert.match(arena, /PairMatchDock/);
  assert.match(arena, /matchPage === 'current'/);
  assert.doesNotMatch(arena, /spectatorOpen|Open full arena|Minimize to dock/);
  assert.match(completion, /phase: pairMatch \? 'recap'/);
  assert.doesNotMatch(arena, /VsScreen|showVsScreen/);
  assert.doesNotMatch(arena, /Team signals|pair-dock-signal|onSignal|handleSignal/);
  assert.doesNotMatch(arena, /id: 'standings'|id: 'history'|matchPage === 'standings'|matchPage === 'history'/);
  assert.doesNotMatch(arenaStyles, /match-history|match-section-list|pair-dock-signal/);
  assert.match(arena, /concludingRef\.current/);
  assert.match(arena, /Forfeit could not be saved/);
  assert.doesNotMatch(arena, /Both teammates receive the same ELO delta/);
});
