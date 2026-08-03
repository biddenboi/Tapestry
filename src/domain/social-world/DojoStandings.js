import { CAST_ROLE } from './SocialWorldContracts.js';

function decorateRow(row, scene) {
  if (!row) return null;
  const member = scene?.memberById?.get(String(row.playerId)) || null;
  const isViewer = String(row.playerId) === String(scene?.viewer?.profileId || '');
  const isFriend = member?.role === CAST_ROLE.friend;
  const isCast = Boolean(member) && !isViewer;
  return Object.freeze({
    ...row,
    identity: member?.identity || row.identity,
    isViewer,
    isFriend,
    isCast,
    contextLabel: isViewer ? 'Active profile' : isFriend ? 'Friend' : isCast ? 'Current cast' : 'Dojo competitor',
    rankLabel: row.position == null ? 'Updating' : `#${row.position}`,
    sessionLabel: row.status === 'provisional'
      ? (Number(row.points || 0) > 0 ? 'Provisional · in progress' : 'Provisional · no points yet')
      : row.boundaryClaim === 'exact' ? 'Completed session' : 'Historical session · duration unavailable',
  });
}

export function projectDojoStandings(standings, scene) {
  const source = standings || {};
  return Object.freeze({
    current: decorateRow(source.current, scene),
    around: Object.freeze((source.around || []).map((row) => decorateRow(row, scene)).filter(Boolean)),
    top: Object.freeze((source.top || []).map((row) => decorateRow(row, scene)).filter(Boolean)),
    updating: Boolean(source.updating),
    sourceVersion: Number(source.sourceVersion || 0),
    rankVersion: Number(source.rankVersion || 0),
  });
}

export default projectDojoStandings;
