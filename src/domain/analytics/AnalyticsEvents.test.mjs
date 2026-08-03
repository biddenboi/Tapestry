import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = (await readFile(new URL('./AnalyticsEvents.js', import.meta.url), 'utf8'))
  .replace("import { v4 as uuid } from 'uuid';", "const uuid = () => 'analytics-id';")
  .replace(/import \{ STORES \} from '(?:@domain\/constants|\.\.\/constants)\.js';/,
    "const STORES = { analyticsEvent: 'analyticsEvents' };");
const analytics = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('analytics records exclude ranking and recommender fields', () => {
  const event = analytics.normalizeAnalyticsEvent({
    eventName: 'feed_post_opened',
    surface: 'feed',
    targetType: 'journal',
    targetUUID: 'journal-1',
    outcome: 'opened',
    reward: 1,
    position: 4,
    probability: 0.9,
    model: 'legacy-feed-ranker',
  }, { UUID: 'player-1' });

  assert.equal(event.parent, 'player-1');
  assert.equal(event.eventName, 'feed_post_opened');
  assert.equal(event.reward, undefined);
  assert.equal(event.position, undefined);
  assert.equal(event.probability, undefined);
  assert.equal(event.model, undefined);
  assert.equal(event.outcome, undefined);
});

test('analytics events persist in their own store', async () => {
  const writes = [];
  const db = {
    add: async (store, event) => writes.push({ store, event }),
  };
  await analytics.recordAnalyticsEvent(db, { UUID: 'player-1' }, {
    eventName: 'shop_item_opened',
    surface: 'shop',
    targetUUID: 'item-1',
  });

  assert.equal(writes[0].store, 'analyticsEvents');
  assert.equal(writes[0].event.eventName, 'shop_item_opened');
});
