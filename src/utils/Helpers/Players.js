import { STORES, DAY } from "../Constants"

// ─── Rank Display ────────────────────────────────────────────────────────────

export const getRankColorClass = (player) => {
    if (player.elo < 1199) return "newbie"
    if (player.elo < 1399) return "pupil"
    if (player.elo < 1599) return "specialist"
    if (player.elo < 1899) return "expert"
    if (player.elo < 2099) return "candidate-master"
    if (player.elo < 2299) return "master"
    if (player.elo < 2399) return "international-master"
    if (player.elo < 2599) return "grandmaster"
    if (player.elo < 2999) return "international-grandmaster"
    if (player.elo < 3999) return "legendary-grandmaster"
    return "legendary"
}

// ─── Competition Orchestrator ─────────────────────────────────────────────────

export const endCompetition = async (db) => {
    const players = await db.getAll(STORES.player);
    if (players.length < 2) return;

    const currentPlayer  = await db.getCurrentPlayer();
    const scoredPlayers  = await fetchCompetitionScores(db, players);
    const updatedPlayers = updateElo(scoredPlayers);

    await updateCompetitionStartDate(db, updatedPlayers, currentPlayer.UUID);
};

// ─── Score Fetching ───────────────────────────────────────────────────────────

const fetchCompetitionScores = async (db, players) => {
    return Promise.all(players.map(async (player) => {
        const windowStart = new Date(player.competitionStartDate ?? player.createdAt);
        const windowEnd   = new Date(windowStart.getTime() + DAY);

        const allPlayerTasks = await db.getPlayerStore(STORES.task, player.UUID);

        const score = allPlayerTasks
            .filter(task => {
                if (!task.completedAt) return false;
                const completedAt = new Date(task.completedAt).getTime();
                return completedAt >= windowStart.getTime() && completedAt <= windowEnd.getTime();
            })
            .reduce((sum, task) => sum + (task.points ?? 0), 0);

        return { ...player, score };
    }));
};

// ─── Pure ELO Math ────────────────────────────────────────────────────────────

const winProbability = (ratingA, ratingB) => {
    return 1.0 / (1.0 + Math.pow(6, (ratingB - ratingA) / 400));
};

/**
 * Uses seedElo — 1400 for unrated players (elo === 0), actual elo otherwise.
 * This prevents new players from distorting win-probability calculations.
 */
const computeSeed = (allPlayers, ratingR) => {
    let result = 1;
    for (const other of allPlayers) {
        result += winProbability(other.seedElo, ratingR);
    }
    return result;
};

const binarySearchRating = (allPlayers, targetRank) => {
    let lo = 1;
    let hi = 6000;

    while (hi - lo > 1) {
        const mid = Math.floor((lo + hi) / 2);
        if (computeSeed(allPlayers, mid) < targetRank) {
            hi = mid;
        } else {
            lo = mid;
        }
    }

    return lo;
};

const assignRanks = (scoredPlayers) => {
    const sorted = [...scoredPlayers].sort((a, b) => b.score - a.score);

    let i = 0;
    while (i < sorted.length) {
        let j = i;
        while (j < sorted.length && sorted[j].score === sorted[i].score) j++;
        const avgRank = (i + 1 + j) / 2;
        for (let k = i; k < j; k++) sorted[k] = { ...sorted[k], actualRank: avgRank };
        i = j;
    }

    return sorted;
};

const computeInflationAdjustment = (rankedPlayers) => {
    const totalRawChange = rankedPlayers.reduce((sum, p) => sum + p.rawChange, 0);
    return Math.floor(-totalRawChange / rankedPlayers.length) - 1;
};

const updateElo = (scoredPlayers) => {
    const withElo = scoredPlayers.map(p => ({
        ...p,
        elo:     p.elo ?? 0,
        // seedElo: 1400 for any player whose stored elo is 0 (unrated).
        // elo=0 is our "never competed" sentinel. Once they've competed their
        // elo will be non-zero (positive or negative), so this only applies
        // to genuinely new players in the probability calculations.
        seedElo: (p.elo == null || p.elo === 0) ? 1400 : p.elo,
    }));

    const ranked = assignRanks(withElo);

    const withRawChange = ranked.map(player => {
        const others     = ranked.filter(p => p.UUID !== player.UUID);
        const fairRating = binarySearchRating(others, player.actualRank);
        // rawChange based on seedElo so the delta is relative to 1400,
        // not 0 — prevents the 3000-point first-round spike.
        const rawChange  = Math.floor((fairRating - player.seedElo) / 2);
        return { ...player, rawChange };
    });

    const adjustment = computeInflationAdjustment(withRawChange);

    return withRawChange.map(player => ({
        ...player,
        elo: player.elo + Math.max(player.rawChange + adjustment, -10),
    }));
};

// ─── Competition Window Rolling ───────────────────────────────────────────────

/**
 * @param {DatabaseConnection} db
 * @param {Object[]} players
 * @param {string} currentPlayerUUID - always pins to createdAt so the active
 *   profile's window never jumps into a random historical slot mid-session.
 */
const updateCompetitionStartDate = async (db, players, currentPlayerUUID) => {
    await Promise.all(players.map(async (player) => {
        let newStart;

        if (player.UUID === currentPlayerUUID) {
            // Active profile — always anchor to its own origin.
            newStart = player.createdAt;
        } else {
            const createdAtMs   = new Date(player.createdAt).getTime();
            const completedAtMs = player.completedAt
                ? new Date(player.completedAt).getTime()
                : null;

            const latestPossibleStart = completedAtMs !== null
                ? completedAtMs - DAY
                : null;

            if (latestPossibleStart === null || latestPossibleStart < createdAtMs) {
                newStart = player.createdAt;
            } else {
                const rangeMs  = latestPossibleStart - createdAtMs;
                const offsetMs = Math.random() * rangeMs;
                newStart = new Date(createdAtMs + offsetMs).toISOString();
            }
        }

        await db.add(STORES.player, { ...player, competitionStartDate: newStart });
    }));
};