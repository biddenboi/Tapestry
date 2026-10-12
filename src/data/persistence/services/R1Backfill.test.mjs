import test from 'node:test';
import assert from 'node:assert/strict';
import { buildR1Backfill, verifiedDurationMs } from './R1Backfill.js';
import { replay } from '@domain/r1/state.js';
import { eventAt } from '@domain/r1/events.js';
test('backfill keeps unambiguous timing, orders history, and retains untimed completions',()=>{
 const tasks=[{UUID:'b',completedAt:'2026-10-11T18:00:00Z',duration:600000},{UUID:'a',completedAt:'2026-10-10T18:00:00Z',actualDurationMs:1200000},{UUID:'unknown',completedAt:'2026-10-10T19:00:00Z',sessionDuration:35}];
 const {events,summary}=buildR1Backfill(tasks,[],new Date('2026-10-12T18:00:00Z'));
 assert.equal(summary.minutesLogged,30); assert.equal(summary.untimedTasks,1); assert.equal(verifiedDurationMs(tasks[2]),null);
 assert.deepEqual(events.map(eventAt),events.map(eventAt).sort((a,b)=>a-b));
 const m=replay(events);assert.equal(m.items.every(t=>t.done),true);assert.equal([...m.dayTotal.values()].reduce((a,b)=>a+b,0),.5);
});
