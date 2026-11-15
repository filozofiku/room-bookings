import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {test} from 'node:test';import assert from 'node:assert/strict';
import {validPeriodRanges,slotKeys} from '../src/booking-resources.js';
const require=createRequire(`${process.env.TEST_MODULES_DIR||'/tmp/fet-reporting-validation'}/package.json`);
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,runTransaction,serverTimestamp,deleteDoc}=require('firebase/firestore');
test('reporting: elevated access, immutable audit logs, atomic operations and scoped traffic worker',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-fet-reporting',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const teacher=env.authenticatedContext('owner',{name:'Owner'}).firestore(),manager=env.authenticatedContext('manager',{name:'Manager'}).firestore(),other=env.authenticatedContext('other',{name:'Other'}).firestore();
 const inactive=env.authenticatedContext('inactive').firestore(),anon=env.unauthenticatedContext().firestore();
 const worker=env.authenticatedContext('reporting-worker',{reportingWorker:true}).firestore(),fakeWorker=env.authenticatedContext('imposter',{reportingWorker:true}).firestore();
 const seed=async(path,data)=>env.withSecurityRulesDisabled(c=>setDoc(doc(c.firestore(),path),data));
 const date='2026-11-16',room='r_123456abcdef';
 const periods=Array.from({length:18},(_,i)=>({id:'p'+String(i+1).padStart(2,'0')}));
 const base={title:'Report fixture',date,roomId:'',periodIds:['p01'],ownerUid:'owner',creatorName:'Owner',groupIds:[],teacherIds:[],eventType:'Panel',isPublic:false,mode:'physical',onlineUrl:'',description:''};
 const audit=(kind,id,booking,actor='owner',extra={})=>({kind,entityId:id,ownerUid:booking.ownerUid,actorUid:actor,occurredAt:serverTimestamp(),activityDate:booking.date,title:booking.title,revision:booking.revision||0,method:'',requestedAt:null,source:'app',...extra});
 async function create(id,{context=teacher,includeAudit=true,includePublic=true,patch={},eventPatch={}}={}){
  return runTransaction(context,async tx=>{
   const booking={...base,...patch,createdAt:serverTimestamp()};
   let locks={};if(booking.roomId)locks={...(await tx.get(doc(context,'eventDays',date))).data()?.bookings};
   tx.set(doc(context,'reservations',id),booking);
   const {ownerUid,...published}=booking;if(includePublic)tx.set(doc(context,'publicBookings',id),published);
   if(booking.roomId){slotKeys(booking).forEach(key=>locks[key]=id);tx.set(doc(context,'eventDays',date),{bookings:locks,changedReservationId:id});}
   if(includeAudit)tx.set(doc(context,'activityEvents',id+'__created'),audit('created',id,booking,context===manager?'manager':'owner',{method:'direct',...eventPatch}));
  });
 }
 try{
  await env.clearFirestore();
  await seed('users/owner',{active:true,role:'teacher'});await seed('users/other',{active:true,role:'teacher'});await seed('users/manager',{active:true,role:'admin',canCancelAll:true});await seed('users/inactive',{active:false,role:'admin',canCancelAll:true});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',auditLoggingRequired:true,startDate:'2026-09-01',endDate:'2026-12-31',periodOrder:Object.fromEntries(periods.map((p,i)=>[p.id,i])),validPeriodRanges:validPeriodRanges(periods)});
  await seed('resourceCatalog/current',{rooms:{[room]:'Room'},groups:{},teachers:{}});await seed('calendarDays/'+date,{weekday:'1',bookingAllowed:true,fetActive:true});await seed('weeklyResources/1',{busyKeys:[]});await seed('eventDays/'+date,{bookings:{},changedReservationId:'seed'});
  await assertFails(create('missing',{includeAudit:false}));await assertFails(create('missing-public',{includePublic:false}));
  await assertFails(create('forged-owner',{eventPatch:{ownerUid:'other'}}));await assertFails(create('forged-actor',{eventPatch:{actorUid:'other'}}));await assertFails(create('forged-method',{eventPatch:{method:'approved'}}));
  await assertSucceeds(create('roomless'));await assertSucceeds(create('sixteen',{patch:{roomId:room,periodIds:periods.slice(0,16).map(p=>p.id)}}));
  await assertSucceeds(getDocs(collection(manager,'activityEvents')));
  for(const context of [teacher,other,inactive,anon,fakeWorker,worker]){
   await assertFails(getDocs(collection(context,'activityEvents')));await assertFails(getDoc(doc(context,'activityEvents','roomless__created')));
   await assertFails(getDocs(collection(context,'trafficDaily')));await assertFails(getDoc(doc(context,'reportSettings','traffic')));await assertFails(getDocs(collection(context,'timetableImports')));
  }
  await assertFails(setDoc(doc(manager,'activityEvents','roomless__created'),{kind:'created'}));await assertFails(deleteDoc(doc(manager,'activityEvents','roomless__created')));
  await assertFails(setDoc(doc(manager,'activityEvents','fake__cancelled'),audit('cancelled','fake',base,'manager')));
  const edit=async({record=true,eventPatch={}}={})=>runTransaction(teacher,async tx=>{
   const before=(await tx.get(doc(teacher,'reservations','roomless'))).data(),booking={...before,title:'Edited',revision:1,updatedAt:serverTimestamp()};
   tx.set(doc(teacher,'reservations','roomless'),booking);const {ownerUid,...published}=booking;tx.set(doc(teacher,'publicBookings','roomless'),published);
   tx.set(doc(teacher,'modificationNotifications','roomless__1'),{reservationId:'roomless',before,booking,previousKeys:[],modifiedBy:'owner',modifierName:'Owner',createdAt:serverTimestamp(),status:'recorded'});
   if(record)tx.set(doc(teacher,'activityEvents','roomless__edit__1'),audit('edited','roomless',booking,'owner',eventPatch));
  });
  await assertFails(edit({record:false}));await assertFails(edit({eventPatch:{revision:9}}));await assertSucceeds(edit());
  const cancel=async record=>runTransaction(teacher,async tx=>{
   const before=(await tx.get(doc(teacher,'reservations','roomless'))).data();tx.delete(doc(teacher,'reservations','roomless'));tx.delete(doc(teacher,'publicBookings','roomless'));
   if(record)tx.set(doc(teacher,'activityEvents','roomless__cancelled'),audit('cancelled','roomless',before));
  });
  await assertFails(cancel(false));await assertSucceeds(cancel(true));assert.equal((await getDoc(doc(manager,'activityEvents','roomless__created'))).exists(),true);
  // A request is created with both the durable submission log and the reviewer notice.
  const special='r_9c3ca97a27ce';await seed('resourceCatalog/current',{rooms:{[special]:'Special'},groups:{},teachers:{}});
  const requestId='request',requested={...base,roomId:special};
  const submit=async log=>runTransaction(teacher,async tx=>{
   const booking={...requested,createdAt:serverTimestamp()};tx.set(doc(teacher,'reservationRequests',requestId),booking);tx.set(doc(teacher,'requestNotifications',requestId),{booking,kind:'request-submitted',status:'pending',createdAt:serverTimestamp()});
   if(log)tx.set(doc(teacher,'activityEvents',requestId+'__requested'),audit('requested',requestId,booking));
  });
  await assertFails(submit(false));await assertSucceeds(submit(true));
  const decline=async log=>runTransaction(manager,async tx=>{
   const booking=(await tx.get(doc(manager,'reservationRequests',requestId))).data();tx.set(doc(manager,'requestDecisions',requestId),{booking,outcome:'rejected',reason:'Not available',decidedBy:'manager',deciderName:'Manager',createdAt:serverTimestamp(),status:'pending'});tx.delete(doc(manager,'reservationRequests',requestId));
   if(log)tx.set(doc(manager,'activityEvents',requestId+'__declined'),audit('declined',requestId,booking,'manager',{requestedAt:booking.createdAt}));
  });
  await assertFails(decline(false));await assertSucceeds(decline(true));
  const approvedRequest='approved-request',original={...requested,createdAt:new Date('2026-11-01T10:00Z')};await seed('reservationRequests/'+approvedRequest,original);
  const approve=async omit=>runTransaction(manager,async tx=>{
    const booking={...original,createdAt:serverTimestamp()},locks={...(await tx.get(doc(manager,'eventDays',date))).data().bookings};
    tx.set(doc(manager,'requestDecisions',approvedRequest),{booking:original,outcome:'approved',reason:'Approved',decidedBy:'manager',deciderName:'Manager',createdAt:serverTimestamp(),status:'pending'});
    tx.set(doc(manager,'reservations',approvedRequest),booking);const {ownerUid,...published}=booking;tx.set(doc(manager,'publicBookings',approvedRequest),published);
    slotKeys(booking).forEach(key=>locks[key]=approvedRequest);tx.set(doc(manager,'eventDays',date),{bookings:locks,changedReservationId:approvedRequest});tx.delete(doc(manager,'reservationRequests',approvedRequest));
    tx.set(doc(manager,'activityEvents',approvedRequest+'__approved'),audit('approved',approvedRequest,original,'manager',{requestedAt:original.createdAt}));
    if(!omit)tx.set(doc(manager,'activityEvents',approvedRequest+'__created'),audit('created',approvedRequest,booking,'manager',{method:'approved'}));
  });
  await assertFails(approve(true));await assertSucceeds(approve(false));
  const daily={visits:3,pageViews:5,paths:[{path:'/',pageViews:5}],complete:true,source:'cloudflare',timezone:'Europe/Tirane',sampled:false,updatedAt:serverTimestamp()};
  for(const context of [teacher,manager,fakeWorker,anon])await assertFails(setDoc(doc(context,'trafficDaily','2026-11-15'),daily));
  await assertSucceeds(setDoc(doc(worker,'trafficDaily','2026-11-15'),daily));await assertSucceeds(getDoc(doc(manager,'trafficDaily','2026-11-15')));
  await assertFails(setDoc(doc(worker,'trafficDaily','2026-11-15'),{...daily,apiToken:'forbidden'}));
  await assertFails(setDoc(doc(worker,'users','owner'),{active:false}));await assertFails(setDoc(doc(worker,'reservations','forged'),base));
  await assertSucceeds(setDoc(doc(worker,'reportSettings','traffic'),{status:'ready',hostname:'filozofiku.github.io',updatedAt:serverTimestamp(),lastSuccessAt:serverTimestamp()}));
  await assertFails(setDoc(doc(worker,'reportSettings','other'),{status:'ready',hostname:'filozofiku.github.io',updatedAt:serverTimestamp()}));
 }finally{await env.cleanup();}
});
