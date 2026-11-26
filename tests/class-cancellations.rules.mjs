import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {slotKeys,validPeriodRanges} from '../src/booking-resources.js';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,updateDoc,writeBatch,runTransaction,serverTimestamp}=require('firebase/firestore');
test('only linked teachers cancel dated classes; all resources are released and restoration is conflict-safe',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-class-cancellation',firestore:{rules:readFileSync('firestore.rules','utf8')}});await env.clearFirestore();
 const teacher=env.authenticatedContext('teacher',{name:'Teacher'}).firestore(),other=env.authenticatedContext('other',{name:'Other'}).firestore(),manager=env.authenticatedContext('manager',{name:'Manager'}).firestore(),anon=env.unauthenticatedContext().firestore();
 const date='2026-11-30',next='2026-12-07',holiday='2026-12-14';
 const periods=['p01','p02','p03'].map(id=>({id}));
 const lesson={weekday:'1',roomId:'r1',groupIds:['g1'],teacherIds:['t1'],periodIds:['p01','p02'],publicInfo:{subject:'Course',start:'09:00',end:'09:30',room:'Room 1',teachers:['Teacher'],groups:['Group 1']}};lesson.keys=slotKeys(lesson);
 const second={...lesson,periodIds:['p03'],publicInfo:{...lesson.publicInfo,subject:'Other course',start:'09:30',end:'09:45'}};second.keys=slotKeys(second);
 const seed=(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
 async function change(context,id='class-1',cancelled=true,target=date,patch={}){
  return runTransaction(context,async tx=>{
   const ref=doc(context,'calendarDays',target),before=(await tx.get(ref)).data();
   const current=(await tx.get(doc(context,'regularClasses',id))).data();
   await tx.get(doc(context,'eventDays',target));
   const map={...before.cancelledClasses},keys=new Set(before.releasedKeys||[]);
   if(cancelled){map[id]={by:'t1',at:serverTimestamp(),class:current.publicInfo};current.keys.forEach(k=>keys.add(k));}
   else{delete map[id];current.keys.forEach(k=>keys.delete(k));}
   tx.update(ref,{cancelledClasses:map,releasedKeys:[...keys],changedClassId:id,classChangeBy:'t1',classChangeAt:serverTimestamp(),...patch});
  });
 }
 const booking={date,roomId:'r1',periodIds:['p01','p02'],groupIds:['g1'],teacherIds:['t1'],title:'Replacement use',eventType:'Panel',isPublic:false,description:'',mode:'physical',onlineUrl:'',creatorName:'Teacher'};
 async function reserve(id,overrides={}){
  return runTransaction(teacher,async tx=>{
   const data={...booking,...overrides};await tx.get(doc(teacher,'calendarDays',data.date));
   const ref=doc(teacher,'eventDays',data.date),before=(await tx.get(ref)).data()?.bookings||{};
   const row={...data,createdAt:serverTimestamp()};
   tx.set(doc(teacher,'reservations',id),{...row,ownerUid:'teacher'});tx.set(doc(teacher,'publicBookings',id),row);
   tx.set(ref,{bookings:{...before,...Object.fromEntries(slotKeys(data).map(key=>[key,id]))},changedReservationId:id});
  });
 }
 async function removeBooking(id){
  const ref=doc(teacher,'reservations',id),row=(await getDoc(ref)).data(),dayRef=doc(teacher,'eventDays',row.date),locks={...(await getDoc(dayRef)).data().bookings};slotKeys(row).forEach(key=>delete locks[key]);
  const batch=writeBatch(teacher);batch.delete(ref);batch.delete(doc(teacher,'publicBookings',id));batch.set(dayRef,{bookings:locks,changedReservationId:id});await batch.commit();
 }
 try{
  await seed('users/teacher',{active:true,role:'teacher',teacherIds:['t1']});await seed('users/other',{active:true,role:'teacher',teacherIds:['t2']});await seed('users/manager',{active:true,role:'admin',canCancelAll:true});
  await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-09-15',endDate:'2026-12-31',periodOrder:{p01:0,p02:1,p03:2},validPeriodRanges:validPeriodRanges(periods)});
  await seed('resourceCatalog/current',{rooms:{r1:'Room 1'},groups:{g1:'Group 1'},teachers:{t1:'Teacher',t2:'Other'}});
  await seed('weeklyResources/1',{busyKeys:[...lesson.keys,...second.keys]});
  for(const d of [date,next,holiday])await seed('calendarDays/'+d,{weekday:'1',fetActive:d!==holiday,bookingAllowed:true});
  await seed('regularClasses/class-1',lesson);await seed('regularClasses/class-2',second);
  await assertFails(updateDoc(doc(teacher,'users/teacher'),{teacherIds:['t2']}));
  await assertFails(setDoc(doc(teacher,'regularClasses/class-1'),{...lesson,teacherIds:['t2']}));
  await assertFails(change(other));await assertFails(change(manager));await assertFails(change(anon));
  await assertFails(change(teacher,'class-1',true,holiday));
  await assertFails(change(teacher,'class-1',true,date,{bookingAllowed:false}));
  await assertFails(change(teacher,'class-1',true,date,{releasedKeys:[...lesson.keys,'r1__p03']}));
  await assertFails(change(teacher,'class-1',true,date,{cancelledClasses:{'class-1':{by:'t1',at:serverTimestamp(),class:{...lesson.publicInfo,subject:'Forged'}}}}));
  await assertFails(reserve('occupied'));
  await assertSucceeds(change(teacher));
  const cancelled=(await getDoc(doc(anon,'calendarDays',date))).data();assert.equal(cancelled.cancelledClasses['class-1'].class.subject,'Course');assert.equal(cancelled.releasedKeys.length,6);
  assert.equal((await getDoc(doc(anon,'calendarDays',next))).data().cancelledClasses,undefined);
  await assertFails(change(teacher)); // Cannot rewrite an existing cancellation.
  await assertFails(reserve('next-week',{date:next}));
  await assertFails(reserve('unreleased',{periodIds:['p03']}));
  for(const override of [{roomId:'r1',groupIds:[],teacherIds:[]},{roomId:'',groupIds:['g1'],teacherIds:[]},{roomId:'',groupIds:[],teacherIds:['t1']}]){
   await assertSucceeds(reserve('released',override));await assertFails(change(teacher,'class-1',false));await removeBooking('released');
  }
  await assertSucceeds(change(teacher,'class-2'));
  await assertSucceeds(change(teacher,'class-1',false));
  const after=(await getDoc(doc(teacher,'calendarDays',date))).data();assert(!after.cancelledClasses['class-1']);assert(after.cancelledClasses['class-2']);assert.deepEqual(new Set(after.releasedKeys),new Set(second.keys));
  await assertFails(reserve('restored'));
  await assertSucceeds(change(teacher,'class-1',true));
  const race=await Promise.allSettled([change(teacher,'class-1',false),reserve('race')]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  const day=(await getDoc(doc(teacher,'calendarDays',date))).data();const reservation=(await getDoc(doc(teacher,'reservations/race'))).exists();assert(!(reservation&&!day.cancelledClasses['class-1']));
 }finally{await env.cleanup();}
});
