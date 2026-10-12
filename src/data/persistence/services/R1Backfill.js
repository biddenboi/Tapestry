import { eventAt } from '@domain/r1/events.js';
import { todoFacts } from './R1EventService.js';
import { toModelHours } from './R1Clock.js';
// Legacy `duration` and modern `actualDurationMs` are observed milliseconds.
// Legacy sessionDuration was also stored as minutes; accept it only when the
// completion receipt establishes the modern contract. Never guess units.
export function verifiedDurationMs(task) {
 const value = task.actualDurationMs ?? task.duration ?? (task.completionEventUUID ? task.sessionDuration : null);
 return value != null && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
}
export function buildR1Backfill(tasks, todos, now = new Date()) {
 const events=[]; let loggedMs=0; let untimed=0;
 const completed=tasks.filter(t=>t.completedAt && Number.isFinite(new Date(t.completedAt).getTime()));
 for(const task of completed) {
  const duration=verifiedDurationMs(task); if(duration==null) untimed++;
  const dur=(duration||0)/3600000; const end=toModelHours(task.completedAt); const start=end-dur; const id=`history:${task.UUID}`;
  events.push({ev:'add',id,now:start,q:dur,d:end,start:null,cycle:null,habit:false,category:task.projectId ? String(task.projectId) : null});
  if(dur>0) events.push({ev:'log',start,dur,kind:'work',ref:id});
  events.push({ev:'complete',id,now:end}); loggedMs+=duration||0;
 }
 events.sort((a,b)=>eventAt(a)-eventAt(b));
 let eligibleTodos=0;
 for(const todo of todos) { const f=todoFacts(todo); if(!f) continue; eligibleTodos++;
  events.push({ev:'add',id:f.id,now:toModelHours(now),q:f.q,d:f.d,start:f.start,cycle:f.cycle,habit:f.habit,category:f.category});
  if(f.block) events.push({ev:'block',id:f.id,now:toModelHours(now),block:f.block});
  if(f.after) events.push({ev:'after',id:f.id,now:toModelHours(now),after:f.after});
 }
 const dates=completed.map(t=>t.completedAt).sort();
 return {events,summary:{tasks:completed.length,minutesLogged:loggedMs/60000,untimedTasks:untimed,openTodos:todos.length,eligibleTodos,dateRange:dates.length?[dates[0],dates.at(-1)]:null}};
}
