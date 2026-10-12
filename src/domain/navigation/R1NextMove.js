export function r1RuleSentence(decision) {
 const rule=decision.rule || '';
 if(rule==='1-work-ended') return 'Work has ended for today.';
 if(rule.includes('margin')) return 'Work on the earliest deadline because the schedule is behind pace.';
 if(rule.includes('habit-pooled')) return 'A habit fits here as a spacer between work blocks.';
 if(rule.includes('due')) return 'This task needs work today to stay on pace for its deadline.';
 if(rule.includes('rest-first')) return 'Take the remaining rest time before reward time.';
 if(rule.includes('discretionary')) return 'There is enough slack for the remaining rest or reward time.';
 if(rule.includes('habit-extra')) return 'There is room for an extra habit block.';
 if(rule.includes('ahead')) return 'Use the available slack to work ahead on this task.';
 if(rule.includes('wait')) return 'Keep this window free until the next task can start.';
 if(rule.includes('guard')) return 'Protect the next deadline with this block.';
 return 'No scheduled work is ready to start in this window.';
}
export function mapR1NextMove({decision,view,todos,windowMinutes=Infinity}) {
 const byId=new Map(todos.map(t=>[String(t.UUID),t]));
 const minutes=Math.max(0,Math.min(decision.length*60,windowMinutes));
 const task=byId.get(decision.ref);
 const work=['work','extra'].includes(decision.kind) && task;
 const title=work ? task.nextAction || task.name || 'Begin the next task' : {reward:`Reward time: ${Math.ceil(minutes)} min`,rest:`Rest: ${Math.ceil(minutes)} min`,wait:`Wait: ${Math.ceil(minutes)} min`,free:'Free time'}[decision.kind] || 'Free time';
 const route=(todo)=>({panel:'tasks',entityType:'task',entityUUID:todo.UUID,subview:'preview',focusTarget:'begin-action',routeLabel:`Tasks → ${todo.name || 'task'} → begin`,worldLocationId:'tasks'});
 const executableWork={UUID:task?.UUID||`r1:${decision.kind}`,entityUUID:task?.UUID||null,entityType:work?'task':'r1',title,context:r1RuleSentence(decision),suggestedMinutes:minutes,
  priorityClass:3,resultType:work?'execute':'recover',primaryAction:{type:work?'begin-task':`r1-${decision.kind}`,label:work?'Begin':decision.kind==='free'?'Open Tasks':`Start ${decision.kind}`},
  destination:work?route(task):null,sourceEntityRefs:work?[{type:'task',UUID:task.UUID}]:[],invalidationKeys:[`r1:${decision.rule}:${decision.ref}:${decision.mode}:${minutes}`]};
 const alternatives=view.items.filter(i=>i.start_now!=null && !i.done && i.id!==decision.ref && byId.has(i.id)).map(i=>({title:byId.get(i.id).name,entityUUID:i.id,kind:'work',suggestedMinutes:Math.min(i.start_now*60,windowMinutes),destination:route(byId.get(i.id))}));
 for(const disc of view.disc.filter(i=>i.start_now!=null && i.name!==decision.kind)) alternatives.push({title:disc.name==='rest'?'Rest':'Reward time',kind:disc.name,suggestedMinutes:Math.min(disc.start_now*60,windowMinutes)});
 return {executableWork,alternatives,r1:{...decision,suggestedMinutes:minutes}};
}
