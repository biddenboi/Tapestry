import { ITEM_TYPE } from '../Constants.js';

export function calculateItemCost(type, duration, quantity, enjoyment) {
    const e = Math.max(1, Math.min(3, Number(enjoyment) || 1));

    if (type === ITEM_TYPE.duration) {
        const dur = Math.max(0, Number(duration) || 0);
        if (dur <= 0) return 0;

        const perMinuteRate = 0.35 + (0.15 * e); // 0.50, 0.65, 0.80
        return Math.max(1, Math.ceil(dur * perMinuteRate));
    }

    if (type === ITEM_TYPE.quantity) {
        const qty = Math.max(0, Number(quantity) || 0);
        if (qty <= 0) return 0;

        const perUnitCost = 2 + (2 * e); // 4, 6, 8
        return Math.max(1, Math.ceil(qty * perUnitCost));
    }

    return 0;
}

export const SHOP_CATEGORIES = ['Movement', 'Nutrition', 'Entertainment', 'Rest'];