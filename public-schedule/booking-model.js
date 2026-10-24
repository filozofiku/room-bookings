export function localDate(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Tirane', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
export function bookingRows(bookings, rooms, periods, catalog = {}) {
  return bookings.map(booking => {
    const room = rooms.find(r => r.id === booking.roomId);
    const slots = booking.periodIds?.map(id => periods.find(p => p.id === id));
    if ((booking.roomId && !room) || !slots?.length || slots.some(p => !p || !/^\d{2}:\d{2}$/.test(p.start) || !/^\d{2}:\d{2}$/.test(p.end))) {
      throw new Error('Rezervimet nuk përputhen me sallat ose orët.');
    }
    return {...booking, room: room?.name || '', groups:(booking.groupIds || []).map(id=>catalog.groups?.[id] || id), groupNames:(booking.groupIds || []).map(id=>catalog.groupNames?.[id] || catalog.groups?.[id] || id), teachers:(booking.teacherIds || []).map(id=>catalog.teachers?.[id] || id), slots: slots.sort((a,b) => a.start.localeCompare(b.start))};
  }).sort((a,b) => a.slots[0].start.localeCompare(b.slots[0].start) || a.room.localeCompare(b.room));
}
export function overlaps(booking, roomName, start, end) {
  return booking.room === roomName && booking.slots.some(p => p.start < end && p.end > start);
}
export function dayIndex(days, weekday) {
  const names = [['e diel','sunday'],['e hene','monday'],['e marte','tuesday'],['e merkure','wednesday'],['e enjte','thursday'],['e premte','friday'],['e shtune','saturday']];
  return days.findIndex(day => names[Number(weekday)]?.includes(day.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim()));
}

export function weekDates(date) {
  const day = new Date(`${date}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() - (day.getUTCDay() + 6) % 7);
  return Array.from({length:7}, (_,i) => {
    const next = new Date(day);
    next.setUTCDate(day.getUTCDate()+i);
    return next.toISOString().slice(0,10);
  });
}
export function reservationEvents(rows, room, dates, days, times, kind = 'rooms') {
  return rows.filter(b => (kind === 'other' ? b.roomId === '' : kind === 'rooms' ? b.room === room : kind === 'teachers' ? b.teachers?.includes(room) : b.groupNames?.includes(room) || b.groups?.includes(room)) && dates.includes(b.date)).flatMap(b => {
    const runs = [];
    for (const slot of b.slots) {
      const last = runs.at(-1);
      if (last && last.end === slot.start) last.end = slot.end;
      else runs.push({...slot});
    }
    return runs.map(run => {
      const s = times.indexOf(run.start), e = times.indexOf(run.end);
      if (s < 0 || e <= s) throw Error('Orët e rezervimit nuk përputhen me orarin zyrtar.');
      return {d:dayIndex(days,new Date(`${b.date}T12:00:00Z`).getUTCDay()),s,e,
        t:b.title,r:b.room || 'Pa sallë',a:b.eventType || 'Rezervim',g:b.groups?.join(', ') || 'Pa grup të studentëve',p:b.teachers?.join(', ') || 'Pa mësimdhënës',booking:true,date:b.date,mode:b.mode,onlineUrl:b.onlineUrl,description:b.description,
        creatorName:b.creatorName || 'Emri nuk është i disponueshëm',createdAt:b.createdAt};
    });
  });
}
export function bookingTimestamp(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() :
    typeof value?.seconds === 'number' ? new Date(value.seconds * 1000) : null;
  return date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('sq-AL', {
    timeZone:'Europe/Tirane',dateStyle:'medium',timeStyle:'short'
  }).format(date) : 'Koha nuk është e disponueshme';
}
