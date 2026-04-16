import { ITEM_TYPE } from '../Constants.js';

export const SHOP_CATEGORIES = ['Rest', 'Exercise', 'Focus', 'Entertainment', 'Social', 'Food', 'Misc'];

export const DEFAULT_SHOP_ITEMS = [
  {
    UUID: 'shop-focus-25',
    name: 'Focus Sprint',
    description: 'A 25-minute intentional break replacement. Use it to structure a focused off-task reset.',
    type: ITEM_TYPE.duration,
    duration: 25,
    quantity: 1,
    enjoyment: 2,
    category: 'Focus',
    icon: '⏱',
  },
  {
    UUID: 'shop-walk-15',
    name: 'Walk Break',
    description: 'Short outside reset to clear your head.',
    type: ITEM_TYPE.duration,
    duration: 15,
    quantity: 1,
    enjoyment: 2,
    category: 'Rest',
    icon: '🚶',
  },
  {
    UUID: 'shop-snack',
    name: 'Snack',
    description: 'Simple instant reward. One-time use.',
    type: ITEM_TYPE.quantity,
    duration: 0,
    quantity: 1,
    enjoyment: 1,
    category: 'Food',
    icon: '🍫',
  },
  {
    UUID: 'shop-game-45',
    name: 'Game Session',
    description: 'Longer recharge block. Going over time becomes expensive.',
    type: ITEM_TYPE.duration,
    duration: 45,
    quantity: 1,
    enjoyment: 4,
    category: 'Entertainment',
    icon: '🎮',
  },
];

export function calculateItemCost(type, duration = 0, quantity = 1, enjoyment = 1) {
  if (type === ITEM_TYPE.duration) {
    return Math.max(1, Math.round((Number(duration || 0) / 10) * (0.75 + Number(enjoyment || 1) * 0.55)));
  }
  return Math.max(1, Math.round(Number(quantity || 1) * (1 + Number(enjoyment || 1) * 0.5)));
}
