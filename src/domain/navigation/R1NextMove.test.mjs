import test from 'node:test';
import assert from 'node:assert/strict';
import { mapR1NextMove } from './R1NextMove.js';
import { createNextMoveDecision } from './NextMoveDecision.js';
const todos=[{UUID:'a',name:'Work'},{UUID:'b',name:'Other'},{UUID:'future',name:'Future'},{UUID:'held',name:'Held'}];
const modelView={items:[{id:'a',start_now:1},{id:'b',start_now:.5},{id:'future',start_now:null},{id:'held',start_now:null}],disc:[{name:'rest',start_now:.25},{name:'reward',start_now:1/3}]};
test('R1 cards use the target and legal set, retain reasons, and fit the reminder window',()=>{
 const mapped=mapR1NextMove({decision:{kind:'work',ref:'a',length:1.5,rule:'3-due',mode:'normal'},view:modelView,todos,windowMinutes:40});
 assert.equal(mapped.executableWork.entityUUID,'a');assert.equal(mapped.executableWork.suggestedMinutes,40);assert.match(mapped.executableWork.context,/deadline/);
 assert.deepEqual(mapped.alternatives.map(a=>a.entityUUID||a.kind),['b','rest','reward']);
 const persisted=createNextMoveDecision({playerUUID:'p',resultType:'execute',...mapped});assert.equal(persisted.alternatives.length,3);
});
test('rest, reward, wait and free become matching cards',()=>{
 for(const kind of ['rest','reward','wait','free']) {
 const mapped=mapR1NextMove({decision:{kind,ref:kind,length:1/3,rule:'4-discretionary',mode:'normal'},view:modelView,todos});
 assert.equal(mapped.executableWork.resultType,'recover'); assert.match(mapped.executableWork.title,new RegExp(kind==='reward'?'Reward':kind[0].toUpperCase()+kind.slice(1))); }
});

test('an active session keeps control even when the background R1 pick is rest',async()=>{
 const {chooseNextMove}=await import('./NextMoveArbiter.js');
 const result=chooseNextMove({playerUUID:'p',activeTaskSession:{UUID:'current',title:'Current task'},executableWork:{title:'Rest'},r1:{kind:'rest',ref:'rest',rule:'4-discretionary'}});
 assert.equal(result.resultType,'active');assert.equal(result.r1,null);
});
