import test from 'node:test';
import assert from 'node:assert/strict';
import { loadR1State, prepareR1Mutation, eventRecords } from './R1EventService.js';
import { toModelHours } from './R1Clock.js';
import { decideWith } from '@domain/r1/decide.js';
const at = '2026-10-12T14:00:00Z';
const todo = { UUID: 'a', estimatedDuration: 60, dueDate: '2026-10-15T23:00:00Z' };
function database() {
 const stores = new Map([['todos', [todo]], ['r1Events', eventRecords([{ ev:'add', id:'a', now:toModelHours(at), q:1, d:toModelHours(todo.dueDate), start:null, cycle:null, habit:false, category:null }], {sourceKey:'seed'})]]);
 return { stores, getAll:async(s)=>stores.get(s)||[], get:async(s,id)=>(stores.get(s)||[]).find(r=>r.UUID===id)||null };
}
test('R1 captures estimate changes without touching saved state before commit', async()=>{
 const db=database(); const before=decideWith(await loadR1State(db),toModelHours(at));
 const rows=await prepareR1Mutation(db,[{type:'put',store:'todos',record:{...todo,estimatedDuration:120}}],'edit');
 assert.deepEqual(rows.map(r=>r.type),['estimate']); assert.equal(rows[0].payload.q,2);
 assert.deepEqual(decideWith(await loadR1State(db),toModelHours(at)),before);
 db.stores.get('r1Events').push(...rows); assert.equal((await loadR1State(db)).items[0].q,2);
 assert.deepEqual(await prepareR1Mutation(db,[{type:'put',store:'todos',record:todo}],'edit'),[]);
});
test('a stopped session logs observed time once and retains its kind',async()=>{
 for(const kind of ['work','extra','rest','reward','wait']) {
 const db=database(); const session={UUID:'s',targetUUID:'a',startedAt:at,endedAt:'2026-10-12T14:20:00Z',outcome:'stopped',activeDurationMs:1200000,sessionKind:kind};
 const rows=await prepareR1Mutation(db,[{type:'put',store:'actionSessions',record:session}],kind);
 assert.equal(rows[0].payload.kind,kind); assert.equal(rows[0].payload.dur,1/3);
 db.stores.set('actionSessions',[session]); assert.deepEqual(await prepareR1Mutation(db,[{type:'put',store:'actionSessions',record:session}],kind+'-retry'),[]);
 }
});
test('completion with an Action Session leaves time logging to that session',async()=>{
 const db=database(); const rows=await prepareR1Mutation(db,[{type:'put',store:'taskCompletionEvents',record:{UUID:'c',todoUUID:'a',completedAt:at,durationMs:60000,actionSessionUUID:'s'}}],'complete');
 assert.deepEqual(rows.map(r=>r.type),['complete']);
});

test('Module 2 holds survive event replay and protect a short availability window',async()=>{
 const {decideR1}=await import('./R1EventService.js'); const db=database();
 db.stores.get('r1Events').push(...eventRecords([{ev:'block',id:'a',now:toModelHours(at),block:1.5}],{sourceKey:'block',seq:1}));
 db.commitAtomicMutation=async({puts})=>{db.stores.get('r1Events').push(...puts.map(p=>p.record));return {changed:true};};
 const end=new Date(new Date(at).getTime()+40*60000);
 await decideR1(db,{now:new Date(at),windowEnd:end});
 const restored=await loadR1State(db); assert.equal(restored.holds.get('a'),toModelHours(end));
 const {view}=await import('@domain/r1/view.js');assert.equal(view(restored,toModelHours(at)).items[0].start_now,null);
});

test('first live mutation seeds current facts and captures the change when no backfill was imported',async()=>{
 const db=database();db.stores.set('r1Events',[]);
 const rows=await prepareR1Mutation(db,[{type:'put',store:'todos',record:{...todo,estimatedDuration:120}}],'first-edit');
 assert.deepEqual(rows.map(r=>r.type),['add','estimate']);assert.equal(rows.at(-1).payload.q,2);
});
