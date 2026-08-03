/**
 * Pure match rating input calculation. Ratings are read from the supplied
 * team snapshots, so callers can replay the same outcome against any prior
 * world state without mutating player records.
 */
export function computeEloChanges(teams, scores, forcedLoserTeamIdx = null) {
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
