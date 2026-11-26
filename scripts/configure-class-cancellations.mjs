// Initialize the protected class catalog and staff-to-teacher links. Dry run by default.
import admin from 'firebase-admin';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parseCsvResourceSchedule} from './csv-resource-schedule.mjs';
import {teacherIdsForEmail} from './teacher-identity.mjs';
const [csvPath,fetPath,flag]=process.argv.slice(2);
if(!csvPath||!fetPath||(flag&&flag!=='--apply')||process.argv.length>5)throw Error('Usage: node scripts/configure-class-cancellations.mjs CSV_FILE FET_FILE [--apply]');
const csv=readFileSync(csvPath,'utf8'),fet=readFileSync(fetPath,'utf8'),version=createHash('sha256').update(csv).digest('hex');
const credentials=JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'));
if(credentials.project_id!=='filozofiku')throw Error('Unexpected Firebase project');
admin.initializeApp({credential:admin.credential.cert(credentials)});
const db=admin.firestore();
try{
 const accounts=[];let page;
 do{const result=await admin.auth().listUsers(1000,page);accounts.push(...result.users);page=result.pageToken;}while(page);
 const plan=async tx=>{
  const read=ref=>tx?tx.get(ref):ref.get();
  const [control,catalog,periods,weekly,users,existing]=await Promise.all([
   read(db.doc('settings/control')),read(db.doc('resourceCatalog/current')),read(db.collection('periods')),
   read(db.collection('weeklyResources')),read(db.collection('users')),read(db.collection('regularClasses'))
  ]);
  if(control.data()?.timetableCsvSha256!==version)throw Error('CSV does not match the live timetable');
  const parsed=parseCsvResourceSchedule(csv,fet,periods.docs.map(d=>({id:d.id,...d.data()})),catalog.data());
  for(const day of weekly.docs)if(!isDeepStrictEqual([...day.data().busyKeys].sort(),parsed.weekly[Number(day.id)].busyKeys))throw Error('Resource occupancy differs from the live timetable');
  const old=new Map(existing.docs.map(d=>[d.id,d.data()])),writes=[];
  for(const [id,lesson] of parsed.regularClasses)if(!isDeepStrictEqual(old.get(id),lesson))writes.push({path:'regularClasses/'+id,data:lesson});
  for(const doc of existing.docs)if(!parsed.regularClasses.has(doc.id))throw Error('Catalog contains a class absent from this timetable; update through the timetable importer');
  let linked=0,unlinked=0;
  for(const doc of users.docs){
   const profile=doc.data(),account=accounts.find(a=>a.uid===doc.id);
   if(!profile.active||!['teacher','admin'].includes(profile.role)||account?.disabled)continue;
   const ids=profile.teacherIds||teacherIdsForEmail(account?.email||profile.email,parsed.catalog.teachers);
   if(ids.some(id=>!parsed.catalog.teachers[id]))throw Error('Unknown teacher in an existing account binding');
   if(ids.length)linked++;else unlinked++;
   if(!isDeepStrictEqual(ids,profile.teacherIds))writes.push({path:doc.ref.path,data:{teacherIds:ids},merge:true});
  }
  if(writes.length>490)throw Error('Initialization exceeds the atomic-write limit');
  const report={classes:parsed.regularClasses.size,linkedAccounts:linked,accountsWithoutTeaching:unlinked,writes:writes.length,version};
  return {writes,report,before:{classes:existing.docs.map(d=>({id:d.id,data:d.data()})),users:users.docs.map(d=>({id:d.id,teacherIds:d.data().teacherIds??null})),ready:control.data().regularClassesReady??null,version:control.data().regularClassesVersion??null}};
 };
 const preview=await plan();console.log(JSON.stringify({...preview.report,apply:flag==='--apply'},null,2));
 if(flag==='--apply'){
  let backup;
  const applied=await db.runTransaction(async tx=>{
   const prepared=await plan(tx);backup='/tmp/fet-before-class-cancellations-'+Date.now()+'.json';
   writeFileSync(backup,JSON.stringify(prepared.before),{mode:0o600});
   for(const write of prepared.writes)tx.set(db.doc(write.path),write.data,{merge:write.merge===true});
   tx.update(db.doc('settings/control'),{regularClassesReady:true,regularClassesVersion:version});
   return prepared;
  });
  const verified=await plan();if(verified.writes.length)throw Error('Class catalog read-back verification failed');
  console.log(JSON.stringify({applied:true,verified:true,...applied.report,backup}));
 }
}finally{await admin.app().delete();}
