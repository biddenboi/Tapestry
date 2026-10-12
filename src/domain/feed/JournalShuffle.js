function shuffled(entries, random) {
  const rows = [...entries];
  for (let i = rows.length - 1; i > 0; i -= 1) {
    const sample = Math.min(1 - Number.EPSILON, Math.max(0, Number(random()) || 0));
    const j = Math.floor(sample * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return rows;
}

// Exhaust each shuffled pass before resurfacing journals in another order.
export class JournalShuffle {
  constructor(entries = [], random = Math.random) {
    this.entries = [...new Map(entries.map((entry) => [String(entry.UUID), entry])).values()];
    this.random = random;
    this.remaining = [];
    this.lastUUID = null;
  }

  next(limit = 12) {
    if (!this.entries.length) return [];
    if (!this.remaining.length) {
      this.remaining = shuffled(this.entries, this.random);
      if (this.remaining.length > 1 && this.remaining[0].UUID === this.lastUUID) {
        [this.remaining[0], this.remaining[1]] = [this.remaining[1], this.remaining[0]];
      }
    }
    const page = this.remaining.splice(0, Math.max(1, Math.floor(Number(limit) || 12)));
    this.lastUUID = page.at(-1)?.UUID || null;
    return page;
  }
}
