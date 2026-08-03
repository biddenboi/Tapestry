/**
 * Pure match rating input calculation. Ratings are read from the supplied
 * team snapshots, so callers can replay the same outcome against any prior
 * world state without mutating player records.
 */
export function computeLegacyEloChanges(teams, scores, forcedLoserTeamIdx = null) {
  const all = [...(teams[0] || []), ...(teams[1] || [])];
  const totals = teams.map((team) => (
    (team || []).reduce((sum, player) => sum + Number(scores?.[player.UUID] || 0), 0)
  ));
  const grand = totals[0] + totals[1];

  let winnerIdx = totals[0] >= totals[1] ? 0 : 1;
  if (forcedLoserTeamIdx !== null) winnerIdx = forcedLoserTeamIdx === 0 ? 1 : 0;
  const overwhelm = Math.abs(totals[0] - totals[1]) > 300;

  const sorted = [...all].sort((a, b) => Number(a.elo || 0) - Number(b.elo || 0));
  const lowest = sorted[0];
  const lowestElo = Number(lowest?.elo || 0);
  const underdogUUID = lowest && all.every((player) => (
    player.UUID === lowest.UUID || Number(player.elo || 0) - lowestElo >= 150
  ))
    ? lowest.UUID
    : null;

  const changes = {};
  for (let teamIndex = 0; teamIndex < 2; teamIndex += 1) {
    const isWinner = teamIndex === winnerIdx;
    for (const player of teams[teamIndex] || []) {
      const pct = grand > 0 ? Number(scores?.[player.UUID] || 0) / grand : 0;
      const pctDisplay = Math.round(pct * 100);
      const breakdown = [];
      let change;

      if (isWinner) {
        const contribution = Math.round(pct * 25);
        change = 20 + contribution;
        breakdown.push({ label: 'Win', value: 20 });
        if (contribution > 0) {
          breakdown.push({ label: `Contribution (${pctDisplay}%)`, value: contribution });
        }
        if (overwhelm) {
          change += 5;
          breakdown.push({ label: 'Overwhelm bonus', value: 5 });
        }
      } else {
        const recompense = Math.round(pct * 15);
        change = -20 + recompense;
        breakdown.push({ label: 'Loss', value: -20 });
        if (recompense > 0) {
          breakdown.push({ label: `Contribution (${pctDisplay}%)`, value: recompense });
        }
      }

      if (player.UUID === underdogUUID) {
        const bonus = Math.round(20 * pct);
        if (bonus > 0) {
          change += bonus;
          breakdown.push({ label: 'Underdog bonus', value: bonus });
        }
      }

      changes[player.UUID] = { change, breakdown, isWinner };
    }
  }

  return {
    changes,
    winnerTeamIdx: winnerIdx,
    t1Total: totals[0],
    t2Total: totals[1],
  };
}

function teamAverageRating(team = []) {
  if (!team.length) return 0;
  return team.reduce((sum, player) => sum + Math.max(0, Number(player?.elo) || 0), 0) / team.length;
}

/**
 * Pair Match rating policy.
 *
 * Rating expectation is calculated from the two team-average ratings. Every
 * participant on a team receives the same base delta; individual task-point
 * share never changes rating.
 */
export function computePairMatchEloChanges(
  teams,
  scores,
  forcedLoserTeamIdx = null,
  { kFactor = 32 } = {},
) {
  const safeTeams = [teams?.[0] || [], teams?.[1] || []];
  const totals = safeTeams.map((team) => (
    team.reduce((sum, player) => sum + Number(scores?.[player.UUID] || 0), 0)
  ));
  const teamAverageRatings = safeTeams.map(teamAverageRating);
  const expectedTeam1 = 1 / (
    1 + (10 ** ((teamAverageRatings[1] - teamAverageRatings[0]) / 400))
  );

  let winnerTeamIdx = null;
  if (forcedLoserTeamIdx === 0 || forcedLoserTeamIdx === 1) {
    winnerTeamIdx = forcedLoserTeamIdx === 0 ? 1 : 0;
  } else if (totals[0] !== totals[1]) {
    winnerTeamIdx = totals[0] > totals[1] ? 0 : 1;
  }

  const actualTeam1 = winnerTeamIdx == null ? 0.5 : winnerTeamIdx === 0 ? 1 : 0;
  const teamDeltas = [
    Math.round(Math.max(1, Number(kFactor) || 32) * (actualTeam1 - expectedTeam1)),
    0,
  ];
  teamDeltas[1] = -teamDeltas[0];

  const changes = {};
  safeTeams.forEach((team, teamIndex) => {
    const expected = teamIndex === 0 ? expectedTeam1 : 1 - expectedTeam1;
    const actual = winnerTeamIdx == null ? 0.5 : winnerTeamIdx === teamIndex ? 1 : 0;
    const change = teamDeltas[teamIndex];
    team.forEach((player) => {
      changes[player.UUID] = {
        change,
        isWinner: winnerTeamIdx == null ? false : winnerTeamIdx === teamIndex,
        teamIndex,
        teamAverageRating: teamAverageRatings[teamIndex],
        opponentAverageRating: teamAverageRatings[teamIndex === 0 ? 1 : 0],
        expectedScore: expected,
        actualScore: actual,
        breakdown: [
          { label: winnerTeamIdx == null ? 'Team draw' : actual === 1 ? 'Team win' : 'Team loss', value: change },
          { label: `Expected result (${Math.round(expected * 100)}%)`, value: 0 },
          { label: 'Individual point share', value: 0 },
        ],
      };
    });
  });

  return {
    changes,
    winnerTeamIdx,
    t1Total: totals[0],
    t2Total: totals[1],
    teamAverageRatings,
    expectedTeam1,
    teamDeltas,
    kFactor: Math.max(1, Number(kFactor) || 32),
  };
}

// Compatibility for callers that explicitly replay pre-Pair Match history.
export const computeEloChanges = computeLegacyEloChanges;
