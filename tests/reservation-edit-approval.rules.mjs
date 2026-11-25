import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotKeys,validPeriodRanges} from '../src/booking-resources.js';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,query,where,setDoc,writeBatch,serverTimestamp}=require('firebase/firestore');
test('special-room metadata and student edits publish immediately; schedule proposals preserve the live booking until approval',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-edit-approval',firestore:{rules:readFileSync('firestore.rules','utf8')}});await env.clearFirestore();
 const owner=env.authenticatedContext('owner',{name:'Owner'}).firestore(),manager=env.authenticatedContext('manager',{name:'Manager'}).firestore(),other=env.authenticatedContext('other',{name:'Other'}).firestore(),anon=env.unauthenticatedContext().firestore();
 const seed=(path,value)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),value));
 const rooms=['r_9c3ca97a27ce','r_a8ae63f60a13','normal'],date='2026-11-16',next='2026-11-17';
 const initial={title:'Original',date,roomId:rooms[0],periodIds:['p1'],groupIds:[],teacherIds:[],eventType:'Panel',isPublic:false,description:'',mode:'physical',onlineUrl:'',ownerUid:'owner',creatorName:'Owner',createdAt:new Date('2026-11-01T10:00Z'),studentEmails:['a@student.uni-pr.edu']};
 const current=async()=> (await getDoc(doc(owner,'reservations/event'))).data();
 function audit(batch,db,kind,id,booking,uid,requestedAt=null){
  const suffix={requested:'requested',edited:'edit__'+booking.revision,approved:'approved',declined:'declined'}[kind];
  batch.set(doc(db,'activityEvents',id+'__'+suffix),{kind,entityId:id,ownerUid:'owner',actorUid:uid,occurredAt:serverTimestamp(),activityDate:booking.date,title:booking.title,revision:booking.revision||0,method:'',requestedAt,source:'app'});
 }
 async function writesForEdit(batch,db,before,patch,uid='owner'){
  const after={...before,...patch,revision:(before.revision||0)+1,updatedAt:serverTimestamp()};
  const {ownerUid,studentEmails,...published}=after;
  batch.set(doc(db,'reservations/event'),after);batch.set(doc(db,'publicBookings/event'),published);
  for(const date of new Set([before.date,after.date])){
   const snap=await getDoc(doc(db,'eventDays',date)),locks={...(snap.data()?.bookings||{})};
   if(date===before.date)slotKeys(before).forEach(k=>delete locks[k]);if(date===after.date)slotKeys(after).forEach(k=>locks[k]='event');
   batch.set(doc(db,'eventDays',date),{bookings:locks,changedReservationId:'event'});
  }
  batch.set(doc(db,'modificationNotifications','event__'+after.revision),{reservationId:'event',before,booking:after,previousKeys:slotKeys(before),modifiedBy:uid,modifierName:uid==='owner'?'Owner':'Manager',createdAt:serverTimestamp(),status:uid==='owner'?'recorded':'pending'});
  if(before.studentEmails?.length||after.studentEmails?.length)batch.set(doc(db,'studentChangeNotifications','event__edit__'+after.revision),{reservationId:'event',before,booking:after,recipients:after.studentEmails||[],kind:'students',eventAction:'modified',status:after.studentEmails?.length?'pending':'skipped',createdAt:serverTimestamp()});
  audit(batch,db,'edited','event',after,uid);return after;
 }
 async function edit(patch,db=owner){const before=await current(),batch=writeBatch(db);await writesForEdit(batch,db,before,patch,db===owner?'owner':'manager');return batch.commit();}
 async function submit(id,patch,override={}){
  const before=await current(),{revision,updatedAt,...base}=before,booking={...base,...patch};
  const proposal={reservationId:'event',expectedRevision:revision||0,booking,ownerUid:'owner',createdAt:serverTimestamp(),...override};
  const batch=writeBatch(owner);batch.set(doc(owner,'reservationEditRequests',id),proposal);
  batch.set(doc(owner,'requestNotifications',id),{booking:proposal.booking,kind:'request-submitted',status:'pending',createdAt:serverTimestamp()});audit(batch,owner,'requested',id,proposal.booking,'owner');return batch.commit();
 }
 async function decide(id,outcome='approved',options={}){
  const request=(await getDoc(doc(manager,'reservationEditRequests',id))).data(),batch=writeBatch(manager);
  if(outcome==='approved'&&options.apply!==false)await writesForEdit(batch,manager,await current(),{...request.booking,...options.patch},'manager');
  batch.set(doc(manager,'requestDecisions',id),{booking:request.booking,reservationId:'event',outcome,reason:'Reason',status:'pending',decidedBy:'manager',deciderName:'Manager',createdAt:serverTimestamp(),...options.decision});
  if(options.delete!==false)batch.delete(doc(manager,'reservationEditRequests',id));
  audit(batch,manager,outcome==='approved'?'approved':'declined',id,request.booking,'manager',request.createdAt);
  return batch.commit();
 }
 try{
  for(const [uid,elevated] of [['owner',false],['other',false],['manager',true]])await seed('users/'+uid,{active:true,role:'teacher',canCancelAll:elevated});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',auditLoggingRequired:true,startDate:'2026-01-01',endDate:'2026-12-31',periodOrder:{p1:0,p2:1,p3:2},validPeriodRanges:validPeriodRanges([{id:'p1'},{id:'p2'},{id:'p3'}])});
  await seed('resourceCatalog/current',{rooms:Object.fromEntries(rooms.map(r=>[r,r])),groups:{g:'Group'},teachers:{t:'Teacher'}});
  for(const d of [date,next])await seed('calendarDays/'+d,{bookingAllowed:true,fetActive:false});
  await seed('reservations/event',initial);const {ownerUid,studentEmails,...published}=initial;await seed('publicBookings/event',published);
  await seed('eventDays/'+date,{bookings:Object.fromEntries(slotKeys(initial).map(k=>[k,'event'])),changedReservationId:'event'});
  await assertSucceeds(edit({title:'Edited',titleEn:'English edit',isPublic:true,description:Array(100).fill('shqip').join(' '),descriptionEn:Array(100).fill('English').join(' '),mode:'online',onlineUrl:'https://example.test',groupIds:['g'],teacherIds:['t'],studentEmails:['b@student.uni-pr.edu']}));
  assert.equal((await current()).title,'Edited');assert.equal((await current()).roomId,rooms[0]);assert.deepEqual((await current()).studentEmails,['b@student.uni-pr.edu']);
  assert.equal((await current()).titleEn,'English edit');
  const publicData=(await getDoc(doc(anon,'publicBookings/event'))).data();assert(!('studentEmails' in publicData));assert(!('ownerUid' in publicData));
  await assertFails(getDoc(doc(other,'reservations/event')));
  await assertFails(getDocs(collection(owner,'reservations')));
  await assertSucceeds(getDocs(query(collection(owner,'reservations'),where('ownerUid','==','owner'))));
  assert.deepEqual((await getDoc(doc(owner,'studentChangeNotifications/event__edit__1'))).data().recipients,['b@student.uni-pr.edu']);
  await assertFails(edit({studentEmails:['attacker@example.test']}));
  for(const patch of [{roomId:rooms[1]},{roomId:'normal'},{roomId:''},{date:next},{periodIds:['p1','p2']},{periodIds:['p2']}])await assertFails(edit(patch));
  const original=await current();
  await assertFails(submit('metadata',{title:'No approval needed'}));await assertFails(submit('stale',{periodIds:['p2']},{expectedRevision:0}));
  await assertSucceeds(submit('move',{roomId:rooms[1],periodIds:['p2'],title:'Awaiting approval',titleEn:'Proposed English title',studentEmails:['c@student.uni-pr.edu']}));
  assert.deepEqual(await current(),original);assert.equal((await getDoc(doc(anon,'publicBookings/event'))).data().title,'Edited');
  await assertFails(getDoc(doc(anon,'reservationEditRequests/move')));await assertFails(getDoc(doc(other,'reservationEditRequests/move')));
  await assertSucceeds(getDocs(query(collection(owner,'reservationEditRequests'),where('ownerUid','==','owner'))));
  for(const options of [{apply:false},{delete:false},{patch:{title:'Tampered'}},{decision:{reservationId:'different'}}])await assertFails(decide('move','approved',options));
  await assertSucceeds(decide('move'));const approved=await current();assert.equal(approved.title,'Awaiting approval');assert.equal(approved.titleEn,'Proposed English title');assert.equal(approved.roomId,rooms[1]);assert.deepEqual(approved.periodIds,['p2']);assert.equal(approved.createdAt.toMillis(),original.createdAt.toMillis());
  assert.equal((await getDoc(doc(manager,'reservationEditRequests/move'))).exists(),false);
  assert(!Object.keys((await getDoc(doc(owner,'eventDays/'+date))).data().bookings).includes(rooms[0]+'__p1'));
  await assertSucceeds(edit({title:'Room 127 metadata',studentEmails:[]}));
  assert.equal((await getDoc(doc(owner,'studentChangeNotifications/event__edit__3'))).data().status,'skipped');
  await assertSucceeds(submit('date-approved',{date:next}));await assertSucceeds(decide('date-approved'));assert.equal((await current()).date,next);
  await assertSucceeds(submit('date-back',{date}));await assertSucceeds(decide('date-back'));assert.equal((await current()).date,date);
  await assertSucceeds(submit('reject',{date:next}));await assertSucceeds(decide('reject','rejected'));assert.equal((await current()).date,date);
  await assertSucceeds(submit('outdated',{periodIds:['p3']}));await assertSucceeds(edit({title:'Changed after request'}));
  await assertFails(decide('outdated'));await assertSucceeds(decide('outdated','rejected'));
  await assertSucceeds(submit('conflict',{periodIds:['p3']}));await seed('eventDays/'+date,{bookings:{[rooms[1]+'__p2']:'event',[rooms[1]+'__p3']:'someone'},changedReservationId:'someone'});
  await assertFails(decide('conflict'));assert.deepEqual((await current()).periodIds,['p2']);
  // Every edit by a request-only account needs approval, including metadata.
  await seed('users/owner',{active:true,role:'teacher',requiresApproval:true,canCancelAll:false});
  await seed('eventDays/'+date,{bookings:Object.fromEntries(slotKeys(await current()).map(k=>[k,'event'])),changedReservationId:'event'});
  for(const roomId of ['normal','']){
   await assertSucceeds(edit({roomId},manager));
   const before=await current();
   await assertFails(edit({title:'Bypass approval'}));
   await assertSucceeds(submit('restricted-edit-'+(roomId||'roomless'),{title:'Council proposal'}));
   assert.deepEqual(await current(),before);
   await assertSucceeds(decide('restricted-edit-'+(roomId||'roomless')));
   assert.equal((await current()).title,'Council proposal');
  }
  // Restricted replacement edits carry the chosen database course, missed date
  // and private student recipients all the way through approval.
  await seed('weeklyRooms/1__course-room',{activities:{p1:{subject:'Replacement course'}}});
  const replacement={eventType:'Zëvendësim i mësimit',title:'Replacement course',titleEn:'',description:'',descriptionEn:'',isPublic:false,groupIds:['g'],teacherIds:['t'],studentEmails:['new@student.uni-pr.edu'],replacementDate:date,courseSource:{weeklyRoomId:'1__course-room',periodId:'p1'}};
  for(const invalid of [{replacementDate:''},{courseSource:{}},{title:'Invented course'},{isPublic:true,description:Array(100).fill('word').join(' ')}])await assertFails(submit('invalid-replacement',{...replacement,...invalid}));
  await assertSucceeds(submit('replacement-edit',replacement));
  await assertSucceeds(decide('replacement-edit'));
  assert.equal((await current()).replacementDate,date);
  assert.equal((await current()).title,'Replacement course');
  assert.equal((await getDoc(doc(anon,'publicBookings/event'))).data().courseSource.periodId,'p1');
 }finally{await env.cleanup();}
});
