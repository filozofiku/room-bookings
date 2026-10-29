import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {firestoreRest,timestamp} from '../mailer/firestore-rest.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
import {slotKeys,validPeriodRanges} from '../src/booking-resources.js';
const require=createRequire(process.env.TEST_MODULES_DIR?`${process.env.TEST_MODULES_DIR}/package.json`:import.meta.url);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,deleteDoc,writeBatch,serverTimestamp,collection,getDocs,query,where}=require('firebase/firestore');
test('special rooms require private requests and atomic elevated decisions',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-fet-requests',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const owner=env.authenticatedContext('owner',{name:'Owner'}).firestore(),manager=env.authenticatedContext('manager',{name:'Manager'}).firestore(),other=env.authenticatedContext('other',{name:'Other'}).firestore();
 const seed=async(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
 const rooms=['r_9c3ca97a27ce','r_a8ae63f60a13'],date='2026-10-28';
 const groups=Object.fromEntries(Array.from({length:48},(_,i)=>['g_'+i,'Group '+i]));
 const teachers=Object.fromEntries(Array.from({length:93},(_,i)=>['t_'+i,'Teacher '+i]));
 const periods=Array.from({length:16},(_,i)=>({id:`p${String(i+1).padStart(2,'0')}`}));
 const base={title:'Request',date,roomId:rooms[0],periodIds:['p01'],groupIds:[],teacherIds:[],eventType:'Panel',isPublic:false,mode:'physical',onlineUrl:'',description:'',ownerUid:'owner',creatorName:'Owner',createdAt:serverTimestamp()};
 const submit=async(id,data=base,notice={})=>{
  const batch=writeBatch(owner);
  batch.set(doc(owner,'reservationRequests',id),data);
  batch.set(doc(owner,'requestNotifications',id),{booking:data,kind:'request-submitted',status:'pending',createdAt:serverTimestamp(),...notice});
  return batch.commit();
 };
 const create=async(db,id,data=base)=>{
  const batch=writeBatch(db),booking={...data,createdAt:serverTimestamp()}, {ownerUid,...published}=booking;
  batch.set(doc(db,'reservations',id),booking);batch.set(doc(db,'publicBookings',id),published);
  batch.set(doc(db,'eventDays',date),{bookings:Object.fromEntries(slotKeys(booking).map(k=>[k,id])),changedReservationId:id});
  return batch.commit();
 };
 const decide=async(db,id,outcome='approved',options={})=>{
  const data=(await getDoc(doc(db,'reservationRequests',id))).data();
  const batch=writeBatch(db);
  if(options.delete!==false)batch.delete(doc(db,'reservationRequests',id));
  if(options.decision!==false)batch.set(doc(db,'requestDecisions',id),{booking:data,outcome,status:'pending',reason:'Arsyeja e vendimit',decidedBy:db===manager?'manager':'owner',deciderName:db===manager?'Manager':'Owner',createdAt:serverTimestamp(),...options.decision});
  if(outcome==='approved'&&options.reserve!==false){
   const booking={...data,createdAt:serverTimestamp(),...options.booking},{ownerUid,...published}=booking;
   batch.set(doc(db,'reservations',id),booking);
   if(options.publish!==false)batch.set(doc(db,'publicBookings',id),published);
   if(options.locks!==false)batch.set(doc(db,'eventDays',date),{bookings:Object.fromEntries(slotKeys(booking).map(k=>[k,id])),changedReservationId:id});
  }
  return batch.commit();
 };
 try{
  await seed('users/owner',{active:true,role:'teacher'});await seed('users/other',{active:true,role:'teacher'});await seed('users/manager',{active:true,role:'admin',canCancelAll:true});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-09-01',endDate:'2026-12-31',periodOrder:Object.fromEntries(periods.map((p,i)=>[p.id,i])),validPeriodRanges:validPeriodRanges(periods)});
  await seed('resourceCatalog/current',{rooms:{[rooms[0]]:'Salla 102',[rooms[1]]:'Salla 127',normal:'Salla 014'},groups,teachers});
  await seed(`calendarDays/${date}`,{weekday:'3',bookingAllowed:true,fetActive:true});await seed('weeklyResources/3',{busyKeys:[]});
  await assertFails(setDoc(doc(owner,'reservationRequests','unqueued'),base));
  await assertFails(submit('bad-status',base,{status:'sent'}));
  await assertFails(submit('bad-recipient',base,{recipient:'someone@example.test'}));
  await assertFails(submit('bad-snapshot',base,{booking:{...base,title:'Forged'}}));
  for(const roomId of rooms){
   await assertFails(create(owner,'direct',{...base,roomId}));
   await assertSucceeds(submit(roomId,{...base,roomId}));
  }
  await assertFails(setDoc(doc(owner,'reservationRequests','invalid'),{...base,roomId:'normal'}));
  await assertFails(setDoc(doc(owner,'reservationRequests','fake'),{...base,ownerUid:'other'}));
  await assertFails(setDoc(doc(owner,'reservationRequests','fake'),{...base,creatorName:'Other'}));
  await assertFails(getDocs(collection(other,'reservationRequests')));
  await assertFails(getDoc(doc(other,'reservationRequests',rooms[0])));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'reservationRequests',rooms[0])));
  await assertSucceeds(getDocs(query(collection(owner,'reservationRequests'),where('ownerUid','==','owner'))));
  await assertSucceeds(getDocs(collection(manager,'reservationRequests')));
  await assertFails(setDoc(doc(owner,'reservationRequests',rooms[0]),{title:'Edited'},{merge:true}));
  await assertFails(deleteDoc(doc(manager,'reservationRequests',rooms[0])));
  await assertFails(decide(owner,rooms[0]));
  for(const options of [{delete:false},{decision:false},{reserve:false},{publish:false},{locks:false},{decision:{status:'sent'}},{decision:{reason:'   '}},{decision:{reason:'a'.repeat(2001)}},{booking:{title:'Tampered'}},{booking:{ownerUid:'manager',creatorName:'Manager'}}])await assertFails(decide(manager,rooms[0],'approved',options));
  await seed('weeklyResources/3',{busyKeys:[`${rooms[0]}__p01`]});await assertFails(decide(manager,rooms[0]));
  assert.equal((await getDoc(doc(owner,'reservationRequests',rooms[0]))).exists(),true);
  await seed('weeklyResources/3',{busyKeys:[]});
  await seed(`eventDays/${date}`,{bookings:{[`${rooms[0]}__p01`]:'existing'},changedReservationId:'existing'});
  await assertFails(decide(manager,rooms[0]));
  await seed(`eventDays/${date}`,{bookings:{},changedReservationId:'reset'});
  await assertSucceeds(decide(manager,rooms[0]));
  assert.equal((await getDoc(doc(owner,'reservations',rooms[0]))).data().ownerUid,'owner');
  assert.equal((await getDoc(doc(manager,'reservationRequests',rooms[0]))).exists(),false);
  assert.equal((await getDoc(doc(env.unauthenticatedContext().firestore(),'publicBookings',rooms[0]))).data().creatorName,'Owner');
  await assertFails(decide(manager,rooms[1],'rejected',{decision:{reason:''}}));
  await assertSucceeds(decide(manager,rooms[1],'rejected'));
  assert.equal((await getDoc(doc(manager,'reservationRequests',rooms[1]))).exists(),false);
  assert.equal((await getDoc(doc(owner,'reservations',rooms[1]))).exists(),false);
  await assertFails(getDoc(doc(other,'requestDecisions',rooms[1])));
  await assertSucceeds(getDocs(query(collection(owner,'requestDecisions'),where('booking.ownerUid','==','owner'))));
  await assertFails(setDoc(doc(manager,'requestDecisions',rooms[1]),{reason:'changed'},{merge:true}));
  await seed(`eventDays/${date}`,{bookings:{},changedReservationId:'reset'});
  await assertSucceeds(create(manager,'manager-direct',{...base,roomId:rooms[1],ownerUid:'manager',creatorName:'Manager'}));
  await seed(`eventDays/${date}`,{bookings:{},changedReservationId:'reset'});
  await assertSucceeds(submit('maximum',{...base,periodIds:periods.map(p=>p.id),groupIds:Object.keys(groups),teacherIds:Object.keys(teachers)}));
  await assertSucceeds(decide(manager,'maximum'));
  // Exercise the real restricted-worker REST path after both request documents are deleted.
  const worker=env.authenticatedContext('cancellation-mail-worker',{cancellationMailWorker:true}).firestore();
  await assertFails(setDoc(doc(worker,'requestDecisions',rooms[0]),{reason:'Tampered'},{merge:true}));
  await assertFails(setDoc(doc(worker,'requestDecisions',rooms[0]),{deciderName:'Forged'},{merge:true}));
  await assertFails(setDoc(doc(worker,'requestDecisions',rooms[0]),{outcome:'rejected'},{merge:true}));
  await assertFails(setDoc(doc(manager,'requestDecisions',rooms[0]),{status:'sent'},{merge:true}));
  await assertFails(deleteDoc(doc(worker,'requestDecisions',rooms[0])));
  await seed('users/owner',{active:true,role:'teacher',email:'requester@example.test'});
  for(const p of periods)await seed(`periods/${p.id}`,{start:'13:00',end:'13:15'});
  for(const room of rooms)await seed(`rooms/${room}`,{name:room===rooms[0]?'Salla 102':'Salla 127'});
  const part=v=>Buffer.from(JSON.stringify(v)).toString('base64url');
  const token=part({alg:'none',typ:'JWT'})+'.'+part({sub:'cancellation-mail-worker',user_id:'cancellation-mail-worker',aud:'demo-fet-requests',iss:'https://securetoken.google.com/demo-fet-requests',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,cancellationMailWorker:true,firebase:{sign_in_provider:'custom',identities:{}}})+'.';
  const rest=firestoreRest('demo-fet-requests',token,fetch,`http://${process.env.FIRESTORE_EMULATOR_HOST}`);
  const pending=await rest.pending('requestDecisions');
  assert.ok(rooms.every(id=>pending.some(ref=>ref.id===id)));
  const messages=[];
  const deps={db:rest,auth:{getUser:async uid=>(await rest.doc(`users/${uid}`).get()).data()},send:async mail=>messages.push(mail),now:Date.now,timestamp,token:'lease'};
  for(const id of rooms){await deliverCancellation(rest.doc('requestDecisions/'+id),deps);await deliverCancellation(rest.doc('requestDecisions/'+id),deps);}
  assert.equal(messages.length,2);
  for(const mail of messages){assert.equal(mail.to,'requester@example.test');assert.match(mail.text,/Manager/);assert.match(mail.text,/Arsyeja e vendimit/);}
  assert.match(messages[0].subject,/miratuar/);assert.match(messages[1].subject,/refuzuar/);
  assert.ok(!(await rest.pending('requestDecisions')).some(ref=>rooms.includes(ref.id)));
  await assertFails(getDoc(doc(other,'requestNotifications',rooms[0])));
  await assertFails(setDoc(doc(worker,'requestNotifications',rooms[0]),{booking:{...base,title:'Forged'}},{merge:true}));
  await assertFails(setDoc(doc(manager,'requestNotifications',rooms[0]),{status:'sent'},{merge:true}));
  const pendingRequests=await rest.pending('requestNotifications');
  assert.ok(rooms.every(id=>pendingRequests.some(ref=>ref.id===id)));
  const requestMails=[];
  const reviewerDeps={...deps,auth:{getUser:async()=>{throw Error('Must use fixed reviewer recipient');}},send:async mail=>requestMails.push(mail)};
  for(const id of rooms){await deliverCancellation(rest.doc('requestNotifications/'+id),reviewerDeps);await deliverCancellation(rest.doc('requestNotifications/'+id),reviewerDeps);}
  await assertFails(setDoc(doc(owner,'reservationRequests',rooms[0]),base));
  assert.equal(requestMails.length,2);
  for(const mail of requestMails){assert.equal(mail.to,'bardhok.bashota@uni-pr.edu');assert.match(mail.text,/Kërkuesi: Owner/);assert.match(mail.text,/Kërkesat për miratim/);assert.match(mail.messageId,/^<request-submitted-/);}


 }finally{await env.cleanup();}
});
