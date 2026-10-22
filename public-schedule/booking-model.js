export function localDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function bookingRows(bookings, rooms, periods) {
  return bookings.map(booking => {
    const room = rooms.find(r => r.id === booking.roomId);
    const slots = booking.periodIds?.map(id => periods.find(p => p.id === id));
    if (!room || !slots?.length || slots.some(p => !p || !/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end))) {
      throw new Error('Rezervimet nuk përputhen me sallat ose orët.');
    }
    return {...booking, room: room.name, slots: slots.sort((a,b) => a.start.localeCompare(b.start))};
  }).sort((a,b) => a.slots[0].start.localeCompare(b.slots[0].start) || a.room.localeCompare(b.room));
}
export function overlaps(booking, roomName, start, end) {
  return booking.room === roomName && booking.slots.some(p => p.start < end && p.end > start);
}
export function dayIndex(days, weekday) {
  const names = [['e diel','sunday'],['e hene','monday'],['e marte','tuesday'],['e merkure','wednesday'],['e enjte','thursday'],['e premte','friday'],['e shtune','saturday']];
  return days.findIndex(day => names[Number(weekday)]?.includes(day.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()));
}
