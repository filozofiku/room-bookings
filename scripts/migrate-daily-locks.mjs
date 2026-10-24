// Dry run by default. --apply migrates and leaves booking paused; --reopen resumes
// only after the matching rules and client have been deployed.
import admin from 'firebase-admin';
import {writeFileSync} from 'node:fs';
if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) throw Error('Set GOOGLE_APPLICATION_CREDENTIALS');
admin.initializeApp({credential:admin.credential.applicationDefault()});
const db = admin.firestore(), control = db.doc('settings/control');
const apply = process.argv.includes('--apply'), reopen = process.argv.includes('--reopen');
const current = await control.get();
if (!current.exists) throw Error('Missing settings/control');
if (current.data().slotStorage === 'resources-v2') throw Error('Use scripts/migrate-resources.mjs; daily-v1 is obsolete.');
if (reopen) {
  if (current.data().slotStorage !== 'daily-v1') throw Error('Migration not complete');
  await control.update({bookingOpen:current.data().migrationWasOpen === true});
  console.log('Restored previous booking availability.');
  await admin.app().delete();
  process.exit(0);
}
if (apply) await control.update({bookingOpen:false,migrationWasOpen:current.data().migrationWasOpen ?? current.data().bookingOpen});
const [reservations,periods,existingDays] = await Promise.all([
  db.collection('reservations').get(),db.collection('periods').get(),db.collection('roomDays').get()
]);
const ordered = periods.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.start.localeCompare(b.start));
const order = Object.fromEntries(ordered.map((p,i)=>[p.id,i]));
const days = new Map();
for (const doc of reservations.docs) {
  const d = doc.data(), key = `${d.date}__${d.roomId}`;
  if (!Array.isArray(d.periodIds) || d.periodIds.length < 1 || d.periodIds.length > 16 || d.periodIds.some((p,i)=>order[p] === undefined || order[p] !== order[d.periodIds[0]]+i)) throw Error(`Invalid periods: ${doc.id}`);
  const day = days.get(key) || {bookings:{},changedReservationId:doc.id};
  for (const p of d.periodIds) {
    if (day.bookings[p]) throw Error(`Conflicting reservation: ${key} ${p}`);
    day.bookings[p]=doc.id;
  }
  days.set(key,day);
}
console.log(`${apply?'Migrating':'Would migrate'} ${reservations.size} reservations into ${days.size} daily occupancy documents.`);
if (apply) {
  const backup = `/tmp/fet-before-daily-locks-${Date.now()}.json`;
  writeFileSync(backup,JSON.stringify({control:current.data(),reservations:reservations.docs.map(d=>({id:d.id,...d.data()})),roomDays:existingDays.docs.map(d=>({id:d.id,...d.data()}))},null,2),{mode:0o600});
  // Keep empty occupancy docs rather than deleting history. Rebuilding is safe while paused.
  for (const old of existingDays.docs) if (!days.has(old.id)) days.set(old.id,{...old.data(),bookings:{}});
  const entries=[...days];
  for(let i=0;i<entries.length;i+=200){
    const batch=db.batch();
    entries.slice(i,i+200).forEach(([key,data])=>batch.set(db.doc(`roomDays/${key}`),data));
    await batch.commit();
  }
  await control.update({slotStorage:'daily-v1',periodOrder:order});
  console.log(`Migration complete; booking remains paused. Backup: ${backup}`);
}
await admin.app().delete();
