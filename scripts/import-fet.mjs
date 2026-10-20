/** FET weekly-slot importer (Spark-friendly). Default is DRY RUN.
 * --apply writes only weekly occupancy, calendar dates, and metadata.
 * Keep Firebase Admin credentials private and outside the repository.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {parse} from 'csv-parse/sync';
import admin from 'firebase-admin';

const [csvPath, semesterPath, flag] = process.argv.slice(2);
if (!csvPath || !semesterPath || (flag && flag !== '--apply')) {
  console.error('Usage: npm run import -- data/timetable.csv data/semester.json [--apply]');
  process.exit(1);
}
const keyFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
if (!keyFile || !fs.existsSync(keyFile)) {
  console.error('Set GOOGLE_APPLICATION_CREDENTIALS to a valid private service-account JSON path.');
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(semesterPath,'utf8'));
const records = parse(fs.readFileSync(csvPath,'utf8'), {columns:true,skip_empty_lines:true,bom:true,trim:true});
const days = {
  'monday':1,'tuesday':2,'wednesday':3,'thursday':4,'friday':5,'saturday':6,'sunday':0,
  'e hënë':1,'e martë':2,'e mërkurë':3,'e enjte':4,'e premte':5,'e shtunë':6,'e diel':0,
};
const periodMap = new Map(config.periods.map(p => [String(p.fetHour),p]));
if (periodMap.size !== config.periods.length) throw new Error('Duplicate fetHour values in semester.json');
if (config.periods.some(p => !/^p\d\d$/.test(p.id))) throw new Error('Period IDs must be p01, p02, etc.');
if (!/^\d{4}-\d{2}-\d{2}$/.test(config.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(config.endDate)
    || config.startDate > config.endDate) throw new Error('Invalid semester dates.');
const isoDate = s => new Date(`${s}T00:00:00Z`).toISOString().slice(0,10) === s;
if (!isoDate(config.startDate) || !isoDate(config.endDate)) throw new Error('Invalid calendar date');
const holidays = new Set(config.holidays || []);
const closedDates = new Set(config.closedDates || []);
for (const d of [...holidays, ...closedDates]) if (!isoDate(d)) throw new Error(`Invalid holiday/closed date: ${d}`);
const roomId = room => 'r_' + crypto.createHash('sha256').update(room).digest('hex').slice(0,12);
const rooms = new Map();
const weekly = new Map();
let unassigned = 0;
for (const row of records) {
  const room = (row['Room'] || '').trim();
  if (!room) { unassigned++; continue; }
  const weekday = days[String(row['Day'] || '').trim().toLocaleLowerCase('sq')];
  const period = periodMap.get(String(row['Hour']).trim());
  if (weekday === undefined) throw new Error(`Unrecognized day: ${row['Day']}`);
  if (!period) throw new Error(`Unrecognized FET Hour: ${row['Hour']}. Fix period fetHour mapping.`);
  const id = roomId(room);
  rooms.set(id, {name:room});
  const key = `${weekday}__${id}__${period.id}`;
  const data = {
    weekday:String(weekday), roomId:id, periodId:period.id,
    activityId:String(row['Activity Id']), subject:row['Subject']||'',
    teachers:row['Teachers']||'', studentSets:row['Students Sets']||''
  };
  if (weekly.has(key) && JSON.stringify(weekly.get(key)) !== JSON.stringify(data)) {
    throw new Error(`Two distinct FET activities occupy ${key}. Check duplicate rows.`);
  }
  weekly.set(key,data);
}
if (!weekly.size) throw new Error('No FET room slots found.');
// Group all periods for the same weekday+room into a SINGLE document.
// This both saves writes and keeps security-rule cross-document reads low.
const weeklyRooms = new Map();
for (const record of weekly.values()) {
  const key = `${record.weekday}__${record.roomId}`;
  if (!weeklyRooms.has(key)) weeklyRooms.set(key, {
    weekday:record.weekday, roomId:record.roomId, busyPeriods:[], activities:{}
  });
  const group = weeklyRooms.get(key);
  group.busyPeriods.push(record.periodId);
  group.activities[record.periodId] = {
    activityId:record.activityId, subject:record.subject,
    teachers:record.teachers, studentSets:record.studentSets
  };
}
for (const group of weeklyRooms.values()) group.busyPeriods.sort();
const calendar = new Map();
for (let d=new Date(`${config.startDate}T00:00:00Z`),end=new Date(`${config.endDate}T00:00:00Z`);
     d<=end; d.setUTCDate(d.getUTCDate()+1)) {
  const date=d.toISOString().slice(0,10);
  calendar.set(date, {
    weekday:String(d.getUTCDay()),
    fetActive:!holidays.has(date),
    bookingAllowed:!closedDates.has(date),
  });
}
console.log(`FET rows: ${records.length}; unassigned room rows: ${unassigned}; rooms: ${rooms.size}; weekly occupied room-periods: ${weekly.size}; weekly room/day documents: ${weeklyRooms.size}; calendar dates: ${calendar.size}`);

admin.initializeApp({credential:admin.credential.applicationDefault()});
const db=admin.firestore();
const settings=db.collection('settings').doc('control');
const apply=flag==='--apply';
// Pause reservations BEFORE checking for import/booking conflicts.
if (apply) {
  await settings.set({bookingOpen:false},{merge:true});
  console.log('Teacher bookings paused during import.');
}
// Avoid accidentally mixing incompatible version-1 dated FET locks with weekly slots.
const legacy = await db.collection('roomSlots').where('source','==','fet').limit(1).get();
if (!legacy.empty) throw new Error('Legacy dated FET roomSlots exist. Do not mix import formats; migration is required.');
const existingWeekly = await db.collection('weeklyRooms').get();
const existingCalendar = await db.collection('calendarDays').get();
const existingRooms = await db.collection('rooms').get();
const existingPeriods = await db.collection('periods').get();
const reservations = await db.collection('reservations').get();
for (const r of reservations.docs) {
  const b=r.data();
  const day=calendar.get(b.date);
  if (!day) continue; // An older/other-semester reservation is left untouched.
  if (!day.bookingAllowed) throw new Error(`Reservation ${r.id} is now on a closed date ${b.date}.`);
  if (day.fetActive) {
    for (const periodId of b.periodIds) {
      const k=`${day.weekday}__${b.roomId}__${periodId}`;
      if (weekly.has(k)) throw new Error(`New FET timetable conflicts with reservation ${r.id} on ${b.date}, period ${periodId}. Booking remains paused.`);
    }
  }
}
const changes=[];
function compare(collectionName, existing, desired, removeOld=false) {
  const old=new Map(existing.docs.map(d => [d.id,d.data()]));
  for (const [id,data] of desired) {
    if (JSON.stringify(old.get(id)) !== JSON.stringify(data)) {
      changes.push({type:'set',ref:db.collection(collectionName).doc(id),data});
    }
  }
  if (removeOld) for (const [id] of old) {
    if (!desired.has(id)) changes.push({type:'delete',ref:db.collection(collectionName).doc(id)});
  }
}
compare('weeklyRooms',existingWeekly,weeklyRooms,true);
compare('calendarDays',existingCalendar,calendar,true);
compare('rooms',existingRooms,rooms,false);
compare('periods',existingPeriods,new Map(config.periods.map(p=>[p.id,{label:p.label,start:p.start,end:p.end}])),false);
console.log(`Database changes required: ${changes.length}. (The original importer estimated 39,881.)`);
if (!apply) {
  console.log('DRY RUN: no writes performed. Inspect the results before re-running with --apply.');
  process.exit(0);
}
// Keep an ample safety margin under the 20k writes/day Spark quota.
if (changes.length>12000) {
  console.error('More than 12,000 changes needed. No timetable changes applied; booking remains paused. Review the dataset/import approach.');
  process.exit(2);
}
try {
  for (let i=0;i<changes.length;i+=200) {
    const batch=db.batch();
    for (const change of changes.slice(i,i+200)) {
      if (change.type==='delete') batch.delete(change.ref);
      else batch.set(change.ref,change.data);
    }
    await batch.commit();
    console.log(`Applied ${Math.min(i+200,changes.length)} / ${changes.length}`);
  }
  await settings.set({bookingOpen:true,startDate:config.startDate,endDate:config.endDate,
    updatedAt:admin.firestore.FieldValue.serverTimestamp()},{merge:true});
  console.log('Import complete. Teacher bookings are open.');
} catch (err) {
  console.error('IMPORT INCOMPLETE: booking remains paused; investigate and re-run safely.',err);
  process.exit(1);
}
