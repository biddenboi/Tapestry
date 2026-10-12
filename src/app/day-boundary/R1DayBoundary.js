import { STORES } from '@domain/constants.js';
// Keep the existing lifecycle while recording the small availability boundary
// R1 needs. Events screens remain until their later Gate removal item.
export async function startR1Shift(db, player, now = new Date()) {
 const end=new Date(now);const [hours,minutes]=String(player.sleepTime||'23:00').split(':').map(Number);
 end.setHours(hours,minutes,0,0);if(end<=now)end.setDate(end.getDate()+1);
 return db.add(STORES.appSetting,{UUID:`r1.workWindow:${player.UUID}`,kind:'r1-work-window',value:{startedAt:now.toISOString(),endsAt:end.toISOString(),endedAt:null},updatedAt:now.toISOString()});
}
export async function endR1Shift(db, player, now = new Date()) {
 const prior=await db.get(STORES.appSetting,`r1.workWindow:${player.UUID}`);
 return db.add(STORES.appSetting,{...prior,UUID:`r1.workWindow:${player.UUID}`,kind:'r1-work-window',value:{...prior?.value,endsAt:now.toISOString(),endedAt:now.toISOString()},updatedAt:now.toISOString()});
}
