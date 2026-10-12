import test from 'node:test';
import assert from 'node:assert/strict';
import { startR1Shift, endR1Shift } from './R1DayBoundary.js';
test('day start opens the local availability window and end work closes it',async()=>{
 let record;const db={add:async(store,next)=>{record=next;},get:async()=>record};
 const player={UUID:'p',sleepTime:'23:00'};const now=new Date(2026,9,12,8);
 await startR1Shift(db,player,now);assert.equal(record.value.startedAt,now.toISOString());assert.equal(new Date(record.value.endsAt).getHours(),23);
 const end=new Date(2026,9,12,17);await endR1Shift(db,player,end);assert.equal(record.value.endedAt,end.toISOString());assert.equal(record.value.endsAt,end.toISOString());
});
