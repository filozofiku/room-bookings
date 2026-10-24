import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotKeys,validPeriodRanges} from '../src/booking-resources.js';
const require = createRequire(process.env.TEST_MODULES_DIR ? `${process.env.TEST_MODULES_DIR}/package.json` : import.meta.url);
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,serverTimestamp,runTransaction} = require('firebase/firestore');
test('resource reservations: atomic publication, optional resources, conflicts, authorization, and races',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-fet-public',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const date='2026-10-23', roomId='r_123456abcdef';
 const periods=Array.from({length:18},(_,i)=>({id:`p${String(i+1).padStart(2,'0')}`}));
 const groups=Object.fromEntries(Array.from({length:57},(_,i)=>[`g_${String(i).padStart(12,'0')}`,`Group ${i}`]));
 const teachers=Object.fromEntries(Array.from({length:93},(_,i)=>[`t_${String(i).padStart(12,'0')}`,`Teacher ${i}`]));
 const base={title:'Panel',date,roomId,periodIds:['p01'],groupIds:Object.keys(groups).slice(0,2),teacherIds:Object.keys(teachers).slice(0,2),eventType:'Panel',isPublic:false,mode:'physical',onlineUrl:'',creatorName:'Teacher'};
 const db=env.authenticatedContext('teacher',{name:'Teacher'}).firestore(), other=env.authenticatedContext('other',{name:'Other'}).firestore(), anon=env.unauthenticatedContext().firestore();
 const seed=async(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
 const create=(id,override={},options={})=>runTransaction(options.db||db,async tx=>{
   const context=options.db||db, d={...base,...override}, ref=doc(context,'eventDays',date);
   const snap=await tx.get(ref), bookings=snap.exists()?{...snap.data().bookings}:{};
   tx.set(doc(context,'reservations',id),{...d,ownerUid:'teacher',createdAt:serverTimestamp(),...options.private});
   if(options.publish!==false)tx.set(doc(context,'publicBookings',id),{...d,createdAt:serverTimestamp(),...options.public});
   const keys=slotKeys(d);
   keys.forEach(key=>bookings[key]=id);
   if(options.tamper)options.tamper(bookings,keys);
   if(keys.length && options.locks!==false)tx.set(ref,{bookings,changedReservationId:id});
 });
 const cancel=(id,options={})=>runTransaction(options.db||db,async tx=>{
   const context=options.db||db, ref=doc(context,'eventDays',date), snap=await tx.get(ref), booking=await tx.get(doc(context,'reservations',id));
   const bookings=snap.exists()?{...snap.data().bookings}:{}, keys=slotKeys(booking.data());
   keys.forEach(key=>delete bookings[key]);
   tx.delete(doc(context,'reservations',id));
   if(options.publish!==false)tx.delete(doc(context,'publicBookings',id));
   if(keys.length && options.locks!==false)tx.set(ref,{bookings,changedReservationId:id});
 });
 try{
  await seed('users/teacher',{active:true,role:'teacher'});await seed('users/other',{active:true,role:'teacher'});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-09-01',endDate:'2026-12-31',periodOrder:Object.fromEntries(periods.map((p,i)=>[p.id,i])),validPeriodRanges:validPeriodRanges(periods)});
  await seed('resourceCatalog/current',{rooms:{[roomId]:'Salla 014'},groups,teachers});
  await seed(`calendarDays/${date}`,{weekday:'5',bookingAllowed:true,fetActive:true});
  await seed('weeklyResources/5',{busyKeys:[]});
  for(let n=1;n<=16;n++){
   await assertSucceeds(create('valid',{periodIds:periods.slice(0,n).map(p=>p.id)}));
   await assertSucceeds(cancel('valid'));
  }
  await assertSucceeds(create('all-resources',{periodIds:periods.slice(0,16).map(p=>p.id),groupIds:Object.keys(groups),teacherIds:Object.keys(teachers)}));
  await assertSucceeds(cancel('all-resources'));
  for(const selected of [['p01,p02'],['p01','p03'],['p02','p01'],['p01','p01'],['p99'],[],periods.slice(0,17).map(p=>p.id)])await assertFails(create('bad',{periodIds:selected}));
  for(const override of [{roomId:'unknown'},{groupIds:['unknown']},{teacherIds:['unknown']},{groupIds:[base.groupIds[0],base.groupIds[0]]},{eventType:'Unknown'},{isPublic:'yes'},{mode:'online',onlineUrl:'javascript:alert(1)'},{mode:'online',onlineUrl:''},{mode:'physical',onlineUrl:'https://example.test'},{creatorName:'Forged'}])await assertFails(create('bad',override));
  for(const options of [{locks:false},{publish:false},{public:{title:'Forged'}},{public:{ownerUid:'teacher'}},{public:{creatorName:'Forged'}},{private:{createdAt:new Date(0)}},{tamper:(b,k)=>delete b[k[0]]},{tamper:(b,k)=>b[k[0]]='other'},{tamper:b=>b['extra__p01']='bad'}])await assertFails(create('bad',{},options));
  await assertFails(create('bad',{}, {db:other}));
  await assertFails(setDoc(doc(anon,'publicBookings','fake'),base));
  await assertFails(setDoc(doc(db,'publicBookings','fake'),base));
  await assertSucceeds(create('optional',{roomId:'',groupIds:[],teacherIds:[],mode:'online',onlineUrl:'https://example.test/event'}));
  assert.equal((await getDoc(doc(anon,'publicBookings','optional'))).data().isPublic,false);
  await assertFails(getDoc(doc(anon,'reservations','optional')));
  await assertSucceeds(cancel('optional'));
  // Conflicts are independent of room choice, for each resource type and each source.
  for(const field of ['roomId','groupIds','teacherIds']){
   const selected={roomId:'',groupIds:[],teacherIds:[],[field]:base[field]};
   await assertSucceeds(create('occupied',selected));
   await assertFails(create('overlap',selected));
   await assertSucceeds(create('adjacent',{...selected,periodIds:['p02']}));
   await assertFails(cancel('occupied',{locks:false}));await assertFails(cancel('occupied',{publish:false}));await assertFails(cancel('occupied',{db:other}));
   await assertSucceeds(cancel('occupied'));await assertSucceeds(cancel('adjacent'));
   await seed('weeklyResources/5',{busyKeys:slotKeys({...base,...selected})});
   await assertFails(create('fet',selected));
   await seed('weeklyResources/5',{busyKeys:[]});
  }
  const race=await Promise.allSettled([create('race-a'),create('race-b')]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  await cancel(race[0].status==='fulfilled'?'race-a':'race-b');
  // Old room-only records remain cancellable after occupancy migration.
  await seed('reservations/legacy',{title:'Old',date,roomId,periodIds:['p01'],ownerUid:'teacher'});
  await seed(`eventDays/${date}`,{bookings:{[`${roomId}__p01`]:'legacy'},changedReservationId:'legacy'});
  await assertSucceeds(cancel('legacy'));
  await assertFails(setDoc(doc(db,'eventDays',date),{bookings:{},changedReservationId:'fake'}));
  await seed('settings/control',{bookingOpen:false,slotStorage:'resources-v2'});
  await assertFails(create('paused'));
 }finally{await env.cleanup();}
});
