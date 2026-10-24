export const EVENT_TYPES = ['Zëvendësim i mësimit', 'Konferencë', 'Panel', 'Mbrojtje publike'];
export function resourceIds(booking) {
  return [...(booking.groupIds || []), ...(booking.teacherIds || []), ...(booking.roomId ? [booking.roomId] : [])];
}
export function slotKeys(booking) {
  return resourceIds(booking).flatMap(id => booking.periodIds.map(period => `${id}__${period}`));
}
export function conflictMessage(booking, locks, busyKeys) {
  const busy = new Set(busyKeys);
  const overlaps = ids => ids.some(id => booking.periodIds.some(p => locks[`${id}__${p}`] || busy.has(`${id}__${p}`)));
  if (overlaps(booking.groupIds || [])) return 'Grupi i studentëve nuk është i lirë në intervalin e përzgjedhur.';
  if (overlaps(booking.roomId ? [booking.roomId] : [])) return 'Salla nuk është e lirë në intervalin e përzgjedhur.';
  if (overlaps(booking.teacherIds || [])) return 'Mësimdhënësi nuk është i lirë në intervalin e përzgjedhur.';
  return '';
}
export function validPeriodRanges(periods) {
  return periods.flatMap((p,i) => Array.from({length:Math.min(16,periods.length-i)},(_,n)=>periods.slice(i,i+n+1).map(p=>p.id).join(',')));
}
