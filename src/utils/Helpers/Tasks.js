import { DAY } from '../Constants.js';
import { getLocalDate } from './Time.js';

export const getTaskDuration = (task) => {
    return new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime();
}

export const getNextTodo = (todoArray, weightArray = []) => {
    const rng = 1 + Math.random() * 99;
    let remaining = rng;
    let selected = todoArray[todoArray.length - 1];

    for (let i = 0; i < weightArray.length; i++) {
        remaining -= weightArray[i];
        if (remaining <= 0) {
            selected = todoArray[i];
            break;
        }
    }
    return selected;
}

export const getWeights = (todoArray) => {
    const today = getLocalDate(new Date());
    const dueTodayTasks = todoArray.filter(t => new Date(t.dueDate).getTime() < today);

    const weights = dueTodayTasks.length > 0
        ? getAllWPDFromArray(dueTodayTasks)
        : getAllWPDFromArray(todoArray);

    const total = weights.reduce((sum, w) => sum + w, 0);
    if (total === 0) return todoArray.map(() => 100 / todoArray.length);

    return weights.map(w => (w / total) * 100);
}

export const getAllWPDFromArray = (data) => {
    return data.map(t => getTodoWPD(t));
}

export const getTodoWPD = (task) => {
    const dur = parseFloat(task.estimatedDuration) || 0;
    const daysUntilDue = getDaysUntilDue(task);
    return dur / daysUntilDue;
}

export const getDaysUntilDue = (task) => {
    const now = getLocalDate(new Date());
    const due = new Date(task.dueDate + 'T00:00:00');
    return Math.max((due - now) / DAY, 0) + 1;
}

/**
 * Gaussian multiplier for session scoring.
 *
 * Incentivizes accurate time estimation by rewarding completing a task
 * as close to the estimated duration as possible. The curve is centered
 * at estimatedDuration (σ = estimatedDuration / 3), producing:
 *
 *   - At exact estimate:         multiplier = 1.0  (max)
 *   - At ±33% of estimate:       multiplier ≈ 0.61
 *   - At ±66% of estimate:       multiplier ≈ 0.14
 *   - At 0 or 2× estimate:       multiplier ≈ 0.01
 *
 * The curve is slightly asymmetric: overtime is penalized marginally more
 * than finishing early (σ_early = μ/3, σ_late = μ/3.5), discouraging
 * deliberate padding while not over-penalising unforeseen complexity.
 *
 * @param {number} duration          actual elapsed time (ms)
 * @param {number} estimatedDuration estimated session duration (ms)
 * @returns {number} multiplier in [0, 1]
 */
export const getSessionMultiplier = (duration, estimatedDuration) => {
    if (!estimatedDuration || estimatedDuration <= 0) return 0;
    if (duration <= 0) return 0;

    const diff = duration - estimatedDuration;
    // Slightly tighter penalty on overtime than early completion
    const sigma = diff <= 0
        ? estimatedDuration / 3
        : estimatedDuration / 3.5;

    const multiplier = Math.exp(-(diff * diff) / (2 * sigma * sigma));
    return Math.min(1, Math.max(0, multiplier));
}

/**
 * Generate points along the gaussian curve for visualization.
 * Returns an array of {x, y} pairs where x is a ratio of estimatedDuration.
 *
 * @param {number} estimatedDuration   estimated session duration (ms)
 * @param {number} steps               number of sample points (default 200)
 * @returns {{ x: number, y: number }[]}
 */
export const getGaussianCurvePoints = (estimatedDuration, steps = 200) => {
    const maxX = estimatedDuration * 2.4;
    return Array.from({ length: steps + 1 }, (_, i) => {
        const x = (i / steps) * maxX;
        return { x, y: getSessionMultiplier(x, estimatedDuration) };
    });
}
