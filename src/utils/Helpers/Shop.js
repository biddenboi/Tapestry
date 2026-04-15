import { ITEM_TYPE } from '../Constants.js';

/**
 * Token cost algorithm for shop items.
 *
 * Players earn ~1 token per minute of focused work (ms/10000/6).
 * Enjoyment (1–3) represents how distracting an item is:
 *   1 = barely distracting (short walk, stretch break)
 *   2 = moderately distracting (snack, short video)
 *   3 = highly distracting (gaming, social media, long entertainment)
 *
 * For duration items: cost scales with duration and enjoyment squared,
 * since highly distracting breaks require more recovery time than just
 * the break itself. The base rate is 1 token/min at enjoyment=1.
 *
 *   cost = duration (min) × enjoyment²
 *
 * For quantity items: each unit has a flat base value that also scales
 * with enjoyment, since a more enjoyable consumable costs proportionally more.
 *
 *   cost = quantity × 8 × enjoyment
 */
export function calculateItemCost(type, duration, quantity, enjoyment) {
    const e = Math.max(1, Math.min(3, enjoyment || 1));

    if (type === ITEM_TYPE.duration) {
        const dur = parseFloat(duration) || 0;
        return Math.ceil(dur * e * e);
    }

    if (type === ITEM_TYPE.quantity) {
        const qty = parseFloat(quantity) || 1;
        return Math.ceil(qty * 8 * e);
    }

    return 0;
}

/**
 * Default shop catalogue seeded on first load.
 * Organized by category tag for display grouping.
 */
export const DEFAULT_SHOP_ITEMS = [
    // ── Physical / Movement ───────────────────────────────
    {
        name: "Walk Break",
        description: "Step outside or move around the building. Clears your head without pulling you into screens.",
        type: ITEM_TYPE.duration,
        duration: 15,
        quantity: null,
        enjoyment: 1,
        category: "Movement",
        icon: "🚶",
    },
    {
        name: "Stretch Session",
        description: "Full desk-to-floor stretch routine. Low distraction, high physical recovery.",
        type: ITEM_TYPE.duration,
        duration: 10,
        quantity: null,
        enjoyment: 1,
        category: "Movement",
        icon: "🧘",
    },
    {
        name: "Workout",
        description: "Full gym or home workout. High physical cost but excellent long-term returns.",
        type: ITEM_TYPE.duration,
        duration: 60,
        quantity: null,
        enjoyment: 2,
        category: "Movement",
        icon: "🏋️",
    },

    // ── Nutrition ─────────────────────────────────────────
    {
        name: "Coffee",
        description: "One cup of coffee. A reliable focus catalyst with a brief preparation ritual.",
        type: ITEM_TYPE.quantity,
        duration: null,
        quantity: 1,
        enjoyment: 1,
        category: "Nutrition",
        icon: "☕",
    },
    {
        name: "Snack Break",
        description: "A brief snack away from the desk. Mild context switch.",
        type: ITEM_TYPE.duration,
        duration: 10,
        quantity: null,
        enjoyment: 2,
        category: "Nutrition",
        icon: "🍎",
    },
    {
        name: "Full Meal",
        description: "Sit-down meal, fully away from work. Necessary and restorative.",
        type: ITEM_TYPE.duration,
        duration: 30,
        quantity: null,
        enjoyment: 2,
        category: "Nutrition",
        icon: "🍽️",
    },

    // ── Entertainment ─────────────────────────────────────
    {
        name: "Short Video",
        description: "One short video or clip. Hard to stop at just one — spend wisely.",
        type: ITEM_TYPE.duration,
        duration: 10,
        quantity: null,
        enjoyment: 3,
        category: "Entertainment",
        icon: "▶️",
    },
    {
        name: "Music Session",
        description: "Put on an album and zone out. Moderate distraction, solid mood reset.",
        type: ITEM_TYPE.duration,
        duration: 45,
        quantity: null,
        enjoyment: 2,
        category: "Entertainment",
        icon: "🎵",
    },
    {
        name: "Gaming Session",
        description: "Sit-down gaming. Maximum distraction. Reserve for well-earned rewards.",
        type: ITEM_TYPE.duration,
        duration: 60,
        quantity: null,
        enjoyment: 3,
        category: "Entertainment",
        icon: "🎮",
    },
    {
        name: "Social Media",
        description: "Controlled browse session. High distraction risk. Time-box strictly.",
        type: ITEM_TYPE.duration,
        duration: 15,
        quantity: null,
        enjoyment: 3,
        category: "Entertainment",
        icon: "📱",
    },

    // ── Rest ──────────────────────────────────────────────
    {
        name: "Power Nap",
        description: "20-minute eyes-closed rest. Clinically proven to restore alertness.",
        type: ITEM_TYPE.duration,
        duration: 20,
        quantity: null,
        enjoyment: 2,
        category: "Rest",
        icon: "😴",
    },
    {
        name: "Reading Break",
        description: "Non-work reading. Fiction, articles, anything not task-adjacent.",
        type: ITEM_TYPE.duration,
        duration: 30,
        quantity: null,
        enjoyment: 2,
        category: "Rest",
        icon: "📖",
    },
];

export const SHOP_CATEGORIES = ["Movement", "Nutrition", "Entertainment", "Rest"];
