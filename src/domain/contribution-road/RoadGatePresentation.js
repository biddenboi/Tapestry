import { ACHIEVEMENT_DEFINITIONS_V2 } from '@domain/achievements-v2/AchievementCatalogV2.js';
import {
  OPENING_TRAIL_STEPS,
  ROAD_CHAPTERS,
  ROAD_STAT_DEFINITIONS,
  getRoadNode,
} from './ContributionRoadCatalog.js';

const achievementsById = new Map(
  ACHIEVEMENT_DEFINITIONS_V2.map((achievement) => [achievement.id, achievement]),
);
const statsById = new Map(ROAD_STAT_DEFINITIONS.map((stat) => [stat.id, stat]));
const chaptersById = new Map(ROAD_CHAPTERS.map((chapter) => [chapter.id, chapter]));
const trailStepsByNumber = new Map(OPENING_TRAIL_STEPS.map((step) => [Number(step.step), step]));

function count(value) {
  return Number(value || 0).toLocaleString();
}

/**
 * Human-readable, evidence-specific Road gate copy. The evaluated result keeps
 * the exact authored gate attached, so presentation never has to guess what a
 * generic "requirement incomplete" means.
 */
export function describeRoadGate(result) {
  if (!result) return 'No additional requirement';
  const gate = result.gate || {};
  switch (result.kind) {
    case 'all':
      return `${count(result.current)} of ${count(result.target)} required routes complete`;
    case 'any': {
      const routes = (result.alternatives || []).map(describeRoadGate);
      return routes.length
        ? `Complete either: ${routes.join(' · OR · ')}`
        : 'Complete either available route';
    }
    case 'min':
      return `${count(result.current)} of ${count(result.target)} listed routes complete`;
    case 'stat': {
      const label = statsById.get(gate.stat)?.label || String(gate.stat || 'Recorded progress').replaceAll('-', ' ');
      return `${label}: ${count(result.current)} / ${count(result.target)}`;
    }
    case 'contribution':
      return `Lifetime Contribution: ${count(result.current)} / ${count(result.target)}`;
    case 'achievement':
    case 'achievement-stage': {
      const achievement = achievementsById.get(gate.achievementId);
      const title = achievement?.title || String(gate.achievementId || 'achievement').replaceAll('_', ' ');
      if (result.kind === 'achievement-stage') {
        return `${title} stage: ${count(result.current)} / ${count(result.target)}`;
      }
      return result.passed
        ? `${title} achievement earned`
        : `Earn ${title}: ${achievement?.description || 'complete its recorded evidence requirement'}`;
    }
    case 'node': {
      const node = getRoadNode(gate.nodeId);
      return result.passed
        ? `${node?.label || gate.nodeId} unlocked`
        : `Unlock ${node?.label || gate.nodeId}`;
    }
    case 'chapter': {
      const chapter = chaptersById.get(gate.chapterId);
      return result.passed
        ? `${chapter?.label || gate.chapterId} chapter committed`
        : `Commit the ${chapter?.label || gate.chapterId} chapter`;
    }
    case 'interface-reveal': {
      const step = trailStepsByNumber.get(Number(gate.step));
      return result.passed
        ? `Opening Trail ${gate.step} complete`
        : `Opening Trail ${gate.step}: ${step?.milestone || 'complete this reveal step'}`;
    }
    case 'none':
      return 'No additional requirement';
    default:
      return result.passed ? 'Requirement complete' : 'Requirement not yet complete';
  }
}

export default describeRoadGate;
