// Dry run unless --apply. Keep booking paused until rules and both sites are deployed.
import admin from 'firebase-admin';
import {writeFileSync} from 'node:fs';
import {parseResourceSchedule} from './resource-schedule.mjs';
import {slotKeys, validPeriodRanges} from '../src/booking-resources.js';
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Set GOOGLE_APPLICATION_CREDENTIALS');
const directory = process.argv[2];
if (!directory) throw Error('Usage: node scripts/migrate-resources.mjs HTML_DIRECTORY [--apply|--reopen]');
admin.initializeApp({credential:admin.credential.applicationDefault()});
const db = admin.firestore(), control = db.doc('settings/control');
try {
  const current = await control.get();
  if (!current.exists) throw Error('Missing settings');
  if (process.argv.includes('--reopen')) {
    if (current.data().slotStorage !== 'resources-v2') throw Error('Migration not complete');
    if (!current.data().resourcesMigrationPending) throw Error('No migration awaiting reopening');
    await control.update({bookingOpen:current.data().resourcesWasOpen === true,resourcesMigrationPending:false});
    console.log('Restored booking availability.');
  } else {
    const periods = (await db.collection('periods').get()).docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.start.localeCompare(b.start));
    const parsed = parseResourceSchedule(directory,periods);
    const ranges = validPeriodRanges(periods);
    const apply = process.argv.includes('--apply');
    // Parse completely before pausing. Any later failure deliberately leaves booking paused.
    if (apply) await control.update({bookingOpen:false,resourcesWasOpen:current.data().resourcesMigrationPending ? current.data().resourcesWasOpen === true : current.data().bookingOpen === true,resourcesMigrationPending:true});
    const [reservations,oldDays,oldWeekly,oldCatalog,calendar,rooms] = await Promise.all([
      db.collection('reservations').get(),db.collection('eventDays').get(),db.collection('weeklyResources').get(),db.doc('resourceCatalog/current').get(),db.collection('calendarDays').get(),db.collection('rooms').get()
    ]);
    // Keep existing selectable rooms even when no FET classes use them.
    for (const room of rooms.docs) parsed.catalog.rooms[room.id] = room.data().name;
    const days = new Map(), dates = new Map(calendar.docs.map(d=>[d.id,d.data()]));
    for (const reservation of reservations.docs) {
      const d = reservation.data();
      if (!ranges.includes(d.periodIds.join(','))) throw Error(`Invalid periods: ${reservation.id}`);
      if ((d.roomId && !parsed.catalog.rooms[d.roomId]) || (d.groupIds||[]).some(id=>!parsed.catalog.groups[id]) || (d.teacherIds||[]).some(id=>!parsed.catalog.teachers[id])) throw Error(`Unknown resource: ${reservation.id}`);
      const keys = slotKeys(d), date = dates.get(d.date);
      if (!date) throw Error(`Missing date: ${reservation.id}`);
      if (date.fetActive && keys.some(key=>parsed.weekly[Number(date.weekday)].busyKeys.includes(key))) throw Error(`FET conflict: ${reservation.id}`);
      if (!keys.length) continue;
      const day = days.get(d.date) || {bookings:{},changedReservationId:reservation.id};
      for (const key of keys) {
        if (day.bookings[key]) throw Error(`Overlapping reservation: ${reservation.id}`);
        day.bookings[key] = reservation.id;
      }
      days.set(d.date,day);
    }
    console.log(JSON.stringify({apply,rooms:Object.keys(parsed.catalog.rooms).length,groups:Object.keys(parsed.catalog.groups).length,teachers:Object.keys(parsed.catalog.teachers).length,reservations:reservations.size,days:days.size,generatedAt:parsed.generatedAt}));
    if (apply) {
      const backup = `/tmp/fet-before-resources-${Date.now()}.json`;
      const rows = snap=>snap.docs.map(d=>({id:d.id,...d.data()}));
      writeFileSync(backup,JSON.stringify({control:current.data(),reservations:rows(reservations),eventDays:rows(oldDays),weeklyResources:rows(oldWeekly),catalog:oldCatalog.data()},null,2),{mode:0o600});
      for (const old of oldDays.docs) if (!days.has(old.id)) days.set(old.id,{...old.data(),bookings:{}});
      const writes = [...days].map(([id,data])=>[`eventDays/${id}`,data]);
      writes.push(['resourceCatalog/current',parsed.catalog],...parsed.weekly.map((d,i)=>[`weeklyResources/${i}`,d]));
      for (let i=0;i<writes.length;i+=200) {
        const batch = db.batch();
        writes.slice(i,i+200).forEach(([path,data])=>batch.set(db.doc(path),data));
        await batch.commit();
      }
      await control.update({slotStorage:'resources-v2',validPeriodRanges:ranges});
      console.log(`Migration complete. Booking remains paused. Backup: ${backup}`);
    }
  }
} finally { await admin.app().delete(); }
