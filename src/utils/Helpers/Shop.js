import { ITEM_TYPE, ITEM_CLASS } from '../Constants.js';

export const SHOP_CATEGORIES = ['Rest', 'Exercise', 'Focus', 'Entertainment', 'Social', 'Food', 'Misc'];

export const DEFAULT_SHOP_ITEMS = [
  {
    UUID: 'shop-focus-25',
    name: 'Focus Sprint',
    description: 'A 25-minute intentional break replacement. Use it to structure a focused off-task reset.',
    type: ITEM_TYPE.duration,
    itemClass: ITEM_CLASS.consumable,
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
    itemClass: ITEM_CLASS.consumable,
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
    itemClass: ITEM_CLASS.consumable,
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
    itemClass: ITEM_CLASS.consumable,
    duration: 45,
    quantity: 1,
    enjoyment: 3,
    category: 'Entertainment',
    icon: '🎮',
  },
];

/**
 * Cost formula: 3 tokens per minute of fun (3:1 ratio vs work).
 * Distraction multiplier: 1.0 / 1.5 / 2.0 for enjoyment 1/2/3.
 */
export function calculateItemCost(type, duration = 0, quantity = 1, enjoyment = 1) {
  const distMult = 1 + (Math.max(1, Number(enjoyment || 1)) - 1) * 0.5;
  if (type === ITEM_TYPE.duration) {
    return Math.max(1, Math.round(Number(duration || 0) * 3 * distMult));
  }
  // Quantity items: 20 base tokens each × distraction
  return Math.max(1, Math.round(Number(quantity || 1) * 20 * distMult));
}
