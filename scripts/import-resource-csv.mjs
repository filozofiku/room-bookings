// resources-v2 CSV update. Preview by default; --apply removes only conflicting assignments.
import admin from 'firebase-admin';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseCsvResourceSchedule,reconcileReservations} from './csv-resource-schedule.mjs';

const [csvPath,fetPath,flag]=process.argv.slice(2);
if (!csvPath || !fetPath || (flag && flag!=='--apply') || process.argv.length>5) throw Error('Usage: node scripts/import-resource-csv.mjs CSV_FILE FET_FILE [--apply]');
const csv=readFileSync(csvPath,'utf8'),fet=readFileSync(fetPath,'utf8');
const sha256=createHash('sha256').update(csv).digest('hex');
const credentials=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
if (credentials.project_id!=='filozofiku') throw Error('Unexpected Firebase project');
admin.initializeApp({credential:admin.credential.cert(credentials)});
const db=admin.firestore(),control=db.doc('settings/control'),apply=flag==='--apply';
const importId=randomUUID(),collections=['resourceCatalog','weeklyResources','weeklyRooms','reservations','publicBookings','eventDays','calendarDays','rooms','periods','regularClasses'];
let paused=false,backup;
const rows=snap=>snap.docs.map(d=>({id:d.id,data:d.data()}));
const map=rows=>new Map(rows.map(({id,data})=>[id,data]));
function prepare(snapshots) {
  const data=Object.fromEntries(snapshots.map((s,i)=>[collections[i],rows(s)]));
  const parsed=parseCsvResourceSchedule(csv,fet,data.periods.map(({id,data})=>({id,...data})),map(data.resourceCatalog).get('current'));
  // Carry date-specific cancellation intent through timetable updates, and
  // recompute released keys from the new authoritative resource assignments.
  const calendar=map(data.calendarDays);
  for(const [date,day] of calendar)if(day.cancelledClasses){
    const cancelledClasses={};
    for(const [id,entry] of Object.entries(day.cancelledClasses)){
      const lesson=parsed.regularClasses.get(id);
      if(lesson && lesson.weekday===String(day.weekday))cancelledClasses[id]={...entry,class:lesson.publicInfo};
    }
    calendar.set(date,{...day,cancelledClasses,releasedKeys:[...new Set(Object.keys(cancelledClasses).flatMap(id=>parsed.regularClasses.get(id).keys))].sort()});
  }
  const result=reconcileReservations(data.reservations,calendar,parsed.weekly);
  const writes=[];
  const set=(path,value)=>writes.push({path,data:value});
  function compare(collection,desired,remove=false) {
    const old=map(data[collection]);
    for (const [id,value] of desired) if (!isDeepStrictEqual(old.get(id),value)) set(`${collection}/${id}`,value);
    if (remove) for (const id of old.keys()) if (!desired.has(id)) writes.push({path:`${collection}/${id}`,delete:true});
  }
  compare('resourceCatalog',new Map([['current',parsed.catalog]]));
  compare('weeklyResources',new Map(parsed.weekly.map((d,i)=>[String(i),d])));
  compare('weeklyRooms',parsed.weeklyRooms,true);
  compare('regularClasses',parsed.regularClasses,true);
  compare('calendarDays',calendar);
  const existingRooms=map(data.rooms);
  compare('rooms',new Map(Object.entries(parsed.catalog.rooms).map(([id,name])=>[id,{...existingRooms.get(id),name}])));
  const oldDays=map(data.eventDays);
  for (const {id} of data.eventDays) if (!result.days.has(id)) result.days.set(id,{...oldDays.get(id),bookings:{}});
  for (const [date,day] of result.days) {
    day.changedReservationId=result.updates.filter(u=>u.after.date===date).at(-1)?.id || oldDays.get(date)?.changedReservationId || day.changedReservationId;
  }
  compare('eventDays',result.days);
  for (const update of result.updates) {
    update.after={...update.after,updatedAt:admin.firestore.Timestamp.now()};
    const {ownerUid,studentEmails,...published}=update.after;
    set(`reservations/${update.id}`,update.after);
    set(`publicBookings/${update.id}`,published);
    set(`activityEvents/${importId}__${update.id}__import`,{
      kind:'adjusted',entityId:update.id,ownerUid:update.before.ownerUid,actorUid:'timetable-import',
      occurredAt:update.after.updatedAt,activityDate:update.before.date,title:update.before.title,
      revision:update.after.revision,method:'',requestedAt:null,source:'import'
    });
  }
  const report={csvSha256:sha256,rows:parsed.rows,activities:parsed.activities,reservations:data.reservations.length,
    changes:writes.length,conflicts:result.updates.map(u=>({id:u.id,date:u.before.date,title:u.before.title,removed:u.removed}))};
  if (writes.length>450) throw Error('Import exceeds the single-transaction safety limit');
  return {data,parsed,result,writes,report};
}

try {
  const initial=await control.get(),before=initial.data();
  if (before?.slotStorage!=='resources-v2' || before.resourcesMigrationPending || before.csvImportPending) throw Error('Database is not ready for a resources-v2 timetable update');
  const preview=prepare(await Promise.all(collections.map(n=>db.collection(n).get())));
  console.log(JSON.stringify(preview.report,null,2));
  if (!apply) console.log('DRY RUN: no database writes.');
  else {
    // Freeze browser edits, then read a fresh snapshot. All timetable, reservation,
    // publication and occupancy writes commit together with reopening booking.
    await control.update({bookingOpen:false,csvImportPending:importId},{lastUpdateTime:initial.updateTime});
    paused=true;
    const expected=await db.runTransaction(async tx=>{
      const locked=await tx.get(control);
      if (locked.data().csvImportPending!==importId || locked.data().bookingOpen!==false) throw Error('Import lock lost');
      const snapshots=await Promise.all(collections.map(n=>tx.get(db.collection(n))));
      const plan=prepare(snapshots);
      backup=`/tmp/fet-before-csv-${importId}.json`;
      const encode=value=>value instanceof admin.firestore.Timestamp?{__firestoreTimestamp:[value.seconds,value.nanoseconds]}:
        Array.isArray(value)?value.map(encode):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,encode(v)])):value;
      writeFileSync(backup,JSON.stringify(encode({project:credentials.project_id,control:before,...plan.data}),null,2),{mode:0o600});
      for (const write of plan.writes) {
        if (write.delete) tx.delete(db.doc(write.path)); else tx.set(db.doc(write.path),write.data);
      }
      tx.set(db.doc(`timetableImports/${importId}`),{...plan.report,source:csvPath,hierarchySource:fetPath,backup,appliedAt:admin.firestore.FieldValue.serverTimestamp()});
      tx.update(control,{bookingOpen:before.bookingOpen===true,csvImportPending:admin.firestore.FieldValue.delete(),timetableCsvSha256:sha256,regularClassesReady:true,regularClassesVersion:sha256,updatedAt:admin.firestore.FieldValue.serverTimestamp()});
      return plan;
    });
    paused=false;
    // Read back the committed documents and compare to the calculated values.
    const actual=await db.getAll(...expected.writes.map(w=>db.doc(w.path)),control);
    expected.writes.forEach((w,i)=>{
      if (w.delete?actual[i].exists:!isDeepStrictEqual(actual[i].data(),w.data)) throw Error(`Read-back mismatch: ${w.path}`);
    });
    if (actual.at(-1).data().bookingOpen!==(before.bookingOpen===true) || actual.at(-1).data().timetableCsvSha256!==sha256) throw Error('Control read-back mismatch');
    console.log(JSON.stringify({applied:true,verified:true,...expected.report,backup,bookingOpen:before.bookingOpen===true},null,2));
  }
} catch(error) {
  if (paused) console.error(`Import did not finish; bookings remain paused. Import lock: ${importId}. Backup: ${backup||'not yet created'}`);
  throw error;
} finally {await admin.app().delete();}
