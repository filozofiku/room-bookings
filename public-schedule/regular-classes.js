// Cancellation snapshots are stored with the calendar date. Existing weekly
// calendar subscriptions update all public views when that date changes.
const clean=value=>String(value||'').normalize('NFC').replace(/\s+/g,' ').trim();
export function classCancellation(event, day, times, kind, entityName) {
  if(event.booking)return null;
  for(const [id,entry] of Object.entries(day?.cancelledClasses||{})){
    const info=entry.class;
    if(!info || clean(info.subject)!==clean(event.t) || info.start!==times[event.s] || info.end!==times[event.e] || clean(info.room)!==clean(event.r))continue;
    if(event.p && !info.teachers.some(name=>clean(event.p).split(' · ').includes(clean(name))))continue;
    if(kind==='teachers' && !info.teachers.includes(entityName))continue;
    if(kind==='subgroups' && !info.groups.includes(entityName))continue;
    return {id,...entry};
  }
  return null;
}
export function markClassCancellation(event,day,times,kind,entityName){
  const cancellation=classCancellation(event,day,times,kind,entityName);
  return {...event,cancelled:Boolean(cancellation),regularClassId:cancellation?.id};
}
