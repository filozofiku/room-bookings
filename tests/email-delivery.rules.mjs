import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,query,where,updateDoc,serverTimestamp}=require('firebase/firestore');
test('email status privacy and restricted administrative retries',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-email-status',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const owner=env.authenticatedContext('owner').firestore(),other=env.authenticatedContext('other').firestore(),admin=env.authenticatedContext('admin').firestore(),anon=env.unauthenticatedContext().firestore();
 const worker=env.authenticatedContext('cancellation-mail-worker',{cancellationMailWorker:true}).firestore();
 const seed=(path,value)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),value));
 const patch={status:'pending',attempts:0,retryRequestedAt:serverTimestamp(),retryRequestedBy:'admin'};
 try{
  for(const uid of ['owner','other','admin'])await seed('users/'+uid,{active:true,role:'teacher',canCancelAll:uid==='admin'});
  for(const name of ['cancellationNotifications','modificationNotifications','requestDecisions','requestNotifications']){
   const path=name+'/notice';await seed(path,{booking:{ownerUid:'owner',title:'Private'},status:'failed',attempts:5});
   await assertSucceeds(getDoc(doc(owner,path)));await assertFails(getDoc(doc(other,path)));await assertFails(getDoc(doc(anon,path)));
   await assertSucceeds(getDocs(query(collection(owner,name),where('booking.ownerUid','==','owner'))));
   await assertFails(updateDoc(doc(owner,path),{...patch,retryRequestedBy:'owner'}));
   await assertFails(updateDoc(doc(admin,path),{...patch,booking:{ownerUid:'other'}}));
   await assertFails(updateDoc(doc(admin,path),{...patch,retryRequestedBy:'other'}));
   await assertSucceeds(updateDoc(doc(admin,path),patch));
   await assertFails(updateDoc(doc(admin,path),patch));
   await assertSucceeds(updateDoc(doc(worker,path),{status:'sending',attempts:1}));
   await assertFails(updateDoc(doc(admin,path),patch));
   await assertSucceeds(updateDoc(doc(worker,path),{status:'sent'}));
   await assertFails(updateDoc(doc(admin,path),patch));
  }
  await seed('mailSettings/publicEvents',{recipients:['private@example.test']});
  await assertFails(getDoc(doc(owner,'mailSettings/publicEvents')));await assertSucceeds(getDoc(doc(admin,'mailSettings/publicEvents')));
  const path='publicEventDeliveries/one';await seed(path,{bookingId:'event',recipient:'private@example.test',status:'failed',attempts:5});
  await assertFails(getDoc(doc(owner,path)));await assertSucceeds(getDoc(doc(admin,path)));
  await assertFails(updateDoc(doc(admin,path),patch));
  await seed('publicBookings/event',{isPublic:true});
  await assertFails(updateDoc(doc(admin,path),{...patch,recipient:'changed@example.test'}));
  await assertSucceeds(updateDoc(doc(admin,path),patch));
 }finally{await env.cleanup();}
});
