export const EVENT_TYPES = ['Zëvendësim i mësimit', 'Konferencë', 'Panel', 'Mbrojtje publike','Mbledhje','Tryezë','Diskutim','Punëtori','Ligjëratë e ftuar','Ceremoni','Kolokium','Ekspozitë'];
export function resourceIds(booking) {
  return [...(booking.groupIds || []), ...(booking.teacherIds || []), ...(booking.roomId ? [booking.roomId] : [])];
}
export function slotKeys(booking) {
  return resourceIds(booking).flatMap(id => booking.periodIds.map(period => `${id}__${period}`));
}
export function conflictMessage(booking, locks, busyKeys) {
  const busy = new Set(busyKeys);
  const overlaps = ids => ids.some(id => booking.periodIds.some(p => locks[`${id}__${p}`] || busy.has(`${id}__${p}`)));
  const messages = [];
  if (overlaps(booking.groupIds || [])) messages.push('Grupi i studentëve nuk është i lirë në intervalin e përzgjedhur.');
  if (overlaps(booking.roomId ? [booking.roomId] : [])) messages.push('Salla nuk është e lirë në intervalin e përzgjedhur.');
  if (overlaps(booking.teacherIds || [])) messages.push('Mësimdhënësi nuk është i lirë në intervalin e përzgjedhur.');
  return messages.join('\n');
}
export function validPeriodRanges(periods) {
  return periods.flatMap((p,i) => Array.from({length:Math.min(16,periods.length-i)},(_,n)=>periods.slice(i,i+n+1).map(p=>p.id).join(',')));
}

export function wordCount(text) { return text.trim().split(/\s+/u).filter(Boolean).length; }

export function publicDescriptionError(title, description) {
  const normalize = text => text.trim().replace(/\s+/gu, ' ').toLowerCase();
  if (normalize(description) === normalize(title)) return 'Përshkrimi i aktivitetit publik nuk mund të jetë vetëm kopje e titullit.';
  if (wordCount(description) < 100) return 'Përshkrimi i aktivitetit publik duhet të ketë të paktën 100 fjalë.';
  if (wordCount(description) > 500) return 'Përshkrimi i aktivitetit nuk mund të ketë më shumë se 500 fjalë.';
  return '';
}

export const SPECIAL_ROOMS=['r_9c3ca97a27ce','r_a8ae63f60a13'];
export const isSpecialRoom=id=>SPECIAL_ROOMS.includes(id);
export const scheduleChanged=(before,after)=>before.date!==after.date || before.roomId!==after.roomId || JSON.stringify(before.periodIds)!==JSON.stringify(after.periodIds);
export const needsReapproval=(before,after)=> (isSpecialRoom(before.roomId)||isSpecialRoom(after.roomId)) && scheduleChanged(before,after);
