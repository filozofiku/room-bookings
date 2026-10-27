import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firestoreRest,timestamp} from '../mailer/firestore-rest.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
import {slotKeys,validPeriodRanges} from '../src/booking-resources.js';
const require=createRequire(process.env.TEST_MODULES_DIR?`${process.env.TEST_MODULES_DIR}/package.json`:import.meta.url);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,runTransaction,serverTimestamp}=require('firebase/firestore');
test('reservation edits are atomic, conflict-safe and require owner notifications for delegated edits',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-fet-edits',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const owner=env.authenticatedContext('owner',{name:'Owner'}).firestore(),manager=env.authenticatedContext('manager',{name:'Manager'}).firestore(),other=env.authenticatedContext('other',{name:'Other'}).firestore();
 const seed=async(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
 const date='2026-10-28',next='2026-10-29',roomId='r_123456abcdef';
 const periods=Array.from({length:18},(_,i)=>({id:`p${String(i+1).padStart(2,'0')}`}));
 const groups=Object.fromEntries(Array.from({length:57},(_,i)=>[`g_${String(i).padStart(12,'0')}`,`Group ${i}`]));
 const teachers=Object.fromEntries(Array.from({length:93},(_,i)=>[`t_${String(i).padStart(12,'0')}`,`Teacher ${i}`]));
 const initial={title:'Original',date,roomId,periodIds:['p01'],groupIds:[],teacherIds:[],ownerUid:'owner',creatorName:'Owner',createdAt:new Date('2026-10-20T10:00:00Z'),eventType:'Panel',mode:'physical',onlineUrl:'',isPublic:false,description:''};
 const setup=async(data=initial)=>{
  await seed('reservations/edit',data);const {ownerUid,...published}=data;await seed('publicBookings/edit',published);
  for(const d of [date,next])await seed(`eventDays/${d}`,{bookings:d===data.date?Object.fromEntries(slotKeys(data).map(k=>[k,'edit'])):{},changedReservationId:'edit'});
 };
 const edit=(context,patch={},options={})=>runTransaction(context,async tx=>{
  const before=(await tx.get(doc(context,'reservations','edit'))).data();
  const after={...before,...patch,revision:(before.revision||0)+1,updatedAt:serverTimestamp(),...options.override};
  const old=(await tx.get(doc(context,'eventDays',before.date))).data().bookings;
  const fresh=before.date===after.date?old:(await tx.get(doc(context,'eventDays',after.date))).data().bookings;
  const oldMap={...old};slotKeys(before).forEach(k=>delete oldMap[k]);
  const newMap=before.date===after.date?oldMap:{...fresh};slotKeys(after).forEach(k=>newMap[k]='edit');
  tx.set(doc(context,'reservations','edit'),after);
  const {ownerUid,...published}=after;
  if(options.publish!==false)tx.set(doc(context,'publicBookings','edit'),{...published,...options.public});
  if(options.locks!==false){
   if(before.date!==after.date && slotKeys(before).length)tx.set(doc(context,'eventDays',before.date),{bookings:oldMap,changedReservationId:'edit'});
   if(slotKeys(after).length || (before.date===after.date && slotKeys(before).length))tx.set(doc(context,'eventDays',after.date),{bookings:newMap,changedReservationId:'edit'});
  }
  if(options.notice!==false)tx.set(doc(context,'modificationNotifications',`edit__${after.revision}`),{reservationId:'edit',before,booking:after,previousKeys:slotKeys(before),modifiedBy:context===manager?'manager':context===other?'other':'owner',modifierName:context===manager?'Manager':context===other?'Other':'Owner',createdAt:serverTimestamp(),status:context===owner?'recorded':'pending',...options.notice});
 });
 try{
  await seed('users/owner',{active:true,role:'teacher',email:'owner@example.test'});await seed('users/manager',{active:true,role:'admin',canCancelAll:true});await seed('users/other',{active:true,role:'teacher'});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-09-01',endDate:'2026-12-31',periodOrder:Object.fromEntries(periods.map((p,i)=>[p.id,i])),validPeriodRanges:validPeriodRanges(periods)});
  await seed('resourceCatalog/current',{rooms:{[roomId]:'Salla'},groups,teachers});
  for(const [d,weekday] of [[date,'3'],[next,'4']]){await seed(`calendarDays/${d}`,{weekday,bookingAllowed:true,fetActive:true});await seed(`weeklyResources/${weekday}`,{busyKeys:[]});}
  await setup();
  await assertFails(edit(other,{title:'Unauthorized'}));
  await assertFails(edit(manager,{title:'Missing notice'},{notice:false}));
  for(const notice of [{modifiedBy:'owner'},{modifierName:'Fake'},{status:'sent'},{previousKeys:[]},{before:{...initial,title:'Fake'}},{booking:{...initial,ownerUid:'other'}}])await assertFails(edit(manager,{title:'Invalid notice'},{notice}));
  for(const override of [{ownerUid:'other'},{creatorName:'Other'},{createdAt:new Date()},{revision:0},{updatedAt:new Date(0)}])await assertFails(edit(owner,{title:'Tampered'},{override}));
  await assertFails(edit(owner,{title:'Private only'},{publish:false}));
  await assertFails(edit(owner,{title:'Mismatch'},{public:{title:'Other'}}));
  await assertFails(edit(owner,{periodIds:['p02']},{locks:false}));
  await assertFails(edit(owner,{title:'Unrecorded'},{notice:false}));
  await assertSucceeds(edit(owner,{title:'Own title'}));
  assert.equal((await getDoc(doc(owner,'reservations','edit'))).data().createdAt.toMillis(),initial.createdAt.getTime());
  await assertSucceeds(edit(manager,{title:'Changed by admin',date:next,periodIds:['p02','p03']}));
  assert.equal((await getDoc(doc(owner,'modificationNotifications','edit__2'))).data().before.title,'Own title');
  await assertFails(getDoc(doc(other,'modificationNotifications','edit__2')));
  await assertFails(setDoc(doc(manager,'modificationNotifications','edit__2'),{status:'sent'},{merge:true}));
  assert.deepEqual((await getDoc(doc(owner,'eventDays',date))).data().bookings,{});
  await seed('weeklyResources/4',{busyKeys:[`${roomId}__p04`]});
  await assertFails(edit(owner,{periodIds:['p04']}));
  assert.equal((await getDoc(doc(owner,'reservations','edit'))).data().title,'Changed by admin');
  await seed(`eventDays/${next}`,{bookings:{[`${roomId}__p02`]:'edit',[`${roomId}__p03`]:'edit',[`${roomId}__p05`]:'someone-else'},changedReservationId:'someone-else'});
  await assertFails(edit(owner,{periodIds:['p05']}));
  await assertSucceeds(edit(owner,{roomId:'',groupIds:[],teacherIds:[]}));
  await assertSucceeds(edit(owner,{roomId,date,periodIds:['p01']}));
  await seed('weeklyResources/4',{busyKeys:[]});
  // Full-size resource sets exercise the rules expression and document-read limits.
  await setup({...initial,revision:10,updatedAt:new Date(),periodIds:periods.slice(0,16).map(p=>p.id),groupIds:Object.keys(groups),teacherIds:Object.keys(teachers)});
  await assertSucceeds(edit(manager,{date:next}));
  await assertSucceeds(edit(manager,{periodIds:periods.slice(1,17).map(p=>p.id)}));
  await assertSucceeds(edit(manager,{roomId:'',groupIds:[],teacherIds:[]}));
  await assertSucceeds(edit(manager,{roomId,groupIds:Object.keys(groups),teacherIds:Object.keys(teachers)}));
  const worker=env.authenticatedContext('cancellation-mail-worker',{cancellationMailWorker:true}).firestore();
  await assertFails(setDoc(doc(worker,'modificationNotifications','edit__2'),{previousKeys:[]},{merge:true}));
  for(const p of periods)await seed(`periods/${p.id}`,{start:'08:00',end:'08:15'});
  await seed(`rooms/${roomId}`,{name:'Salla'});
  const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=part({alg:'none',typ:'JWT'})+'.'+part({sub:'cancellation-mail-worker',user_id:'cancellation-mail-worker',aud:'demo-fet-edits',iss:'https://securetoken.google.com/demo-fet-edits',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,cancellationMailWorker:true,firebase:{sign_in_provider:'custom',identities:{}}})+'.';
  const rest=firestoreRest('demo-fet-edits',token,fetch,`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
  const pending=await rest.pending('modificationNotifications');
  assert.ok(pending.some(ref=>ref.id==='edit__2'));
  assert.ok(!pending.some(ref=>ref.id==='edit__1'));
  let sent=0;
  const delivery={db:rest,auth:{getUser:async uid=>(await rest.doc(`users/${uid}`).get()).data()},send:async mail=>{assert.equal(mail.to,'owner@example.test');assert.match(mail.text,/Më parë: Own title/);assert.match(mail.text,/Tani: Changed by admin/);sent++;},now:Date.now,timestamp,token:'lease'};
  await deliverCancellation(rest.doc('modificationNotifications/edit__2'),delivery);
  await deliverCancellation(rest.doc('modificationNotifications/edit__2'),delivery);
  assert.equal(sent,1);
  await seed('users/manager',{active:true,role:'admin',canCancelAll:false});await assertFails(edit(manager,{title:'Not delegated'}));
  await seed('settings/control',{bookingOpen:false,slotStorage:'resources-v2'});await assertFails(edit(owner,{title:'Paused'}));
 }finally{await env.cleanup();}
});
