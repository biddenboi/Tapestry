import { v4 as uuid } from 'uuid';

const SOURCE_CENTERS = {
  'task-results': { x: 50, y: 42, radius: 34 },
  'task-session': { x: 50, y: 42, radius: 32 },
  feed: { x: 54, y: 22, radius: 24 },
  journal: { x: 50, y: 24, radius: 26 },
  panel: { x: 52, y: 24, radius: 26 },
  event: { x: 50, y: 30, radius: 28 },
  habit: { x: 50, y: 30, radius: 28 },
  quantity: { x: 50, y: 30, radius: 28 },
  match: { x: 50, y: 30, radius: 30 },
  'match-end': { x: 50, y: 34, radius: 30 },
  dojo: { x: 50, y: 30, radius: 28 },
  inventory: { x: 52, y: 24, radius: 24 },
  shop: { x: 52, y: 24, radius: 24 },
  notification: { x: 52, y: 22, radius: 26 },
};

function rewardPosition(source, index) {
  const center = SOURCE_CENTERS[source] || { x: 52, y: 28, radius: 24 };
  const angle = Math.random() * Math.PI * 2 + index * 0.95;
  const distance = center.radius * Math.sqrt(Math.random());
  const stackOffset = index > 0 ? (index - 1) * 3.5 : 0;
  return {
    x: Math.max(12, Math.min(88, center.x + Math.cos(angle) * distance)),
    y: Math.max(10, Math.min(82, center.y + Math.sin(angle) * distance + stackOffset)),
  };
}

export function createPlayerRewardEvents(items = [], options = {}) {
  const source = options.source || 'panel';
  return (items || [])
    .filter((item) => Number(item?.amount || 0) !== 0 || item?.label)
    .map((item, index) => {
      const amount = Number(item.amount || 0);
      const sign = amount > 0 ? '+' : '';
      return {
        id: uuid(),
        source,
        kind: item.kind || options.kind || 'default',
        label: item.label || `${sign}${amount.toLocaleString()} ${item.unit || ''}`.trim(),
        delayMs: index * 140 + Math.floor(Math.random() * 90),
        driftX: (Math.random() - 0.5) * 34,
        driftY: 34 + Math.random() * 26,
        ...rewardPosition(source, index),
      };
    });
}

export function playerRewardEventRemovalDelay(count) {
  return 4800 + Math.max(0, Number(count) || 0) * 240;
}
