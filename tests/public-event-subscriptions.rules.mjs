import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,serverTimestamp}=require('firebase/firestore');
test('unsubscribe bearer tokens allow only opting out and keep addresses and tokens private',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-public-subscriptions',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 await env.clearFirestore();
 const anon=env.unauthenticatedContext().firestore(),teacher=env.authenticatedContext('teacher').firestore(),manager=env.authenticatedContext('manager').firestore();
 const worker=env.authenticatedContext('cancellation-mail-worker',{cancellationMailWorker:true}).firestore();
 const seed=(path,value)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),value));
 const token='12345678-1234-1234-1234-123456789012',id='a'.repeat(64),path='publicEventRecipients/'+id;
 const optOut={unsubscribed:true,confirmationToken:token,unsubscribedAt:serverTimestamp()};
 try{
  await seed('users/teacher',{active:true,role:'teacher'});await seed('users/manager',{active:true,role:'admin',canCancelAll:true});
  await seed('mailSettings/publicEvents',{enabled:true,recipients:['private@example.test']});
  await assertSucceeds(setDoc(doc(worker,path),{recipient:'private@example.test',unsubscribeToken:token,unsubscribed:false}));
  for(const db of [anon,teacher]){await assertFails(getDoc(doc(db,path)));await assertFails(getDocs(collection(db,'publicEventRecipients')));await assertFails(setDoc(doc(db,'publicEventRecipients/forged'),{recipient:'attacker@example.test',unsubscribeToken:token,unsubscribed:false}));}
  await assertSucceeds(getDoc(doc(manager,path)));await assertSucceeds(getDoc(doc(worker,path)));
  await assertFails(updateDoc(doc(anon,path),{unsubscribed:true,unsubscribedAt:serverTimestamp()}));
  await assertFails(updateDoc(doc(anon,path),{...optOut,confirmationToken:'wrong-token'}));
  await assertFails(updateDoc(doc(anon,path),{...optOut,recipient:'attacker@example.test'}));
  await assertFails(updateDoc(doc(anon,path),{...optOut,unsubscribeToken:'replacement-token'}));
  await assertFails(updateDoc(doc(anon,path),{...optOut,unsubscribedAt:new Date('2020-01-01')}));
  await assertSucceeds(updateDoc(doc(anon,path),optOut));
  await assertSucceeds(updateDoc(doc(anon,path),optOut));
  await assertFails(updateDoc(doc(anon,path),{...optOut,unsubscribed:false}));
  await assertFails(updateDoc(doc(worker,path),{unsubscribed:false}));
  await assertFails(deleteDoc(doc(anon,path)));
  await assertFails(updateDoc(doc(anon,'publicEventRecipients/missing'),optOut));
  // Exercise the exact unauthenticated REST commit used by the static page,
  // including the server-time transform and field mask.
  const restId='b'.repeat(64),restPath='publicEventRecipients/'+restId;
  await seed(restPath,{recipient:'private@example.test',unsubscribeToken:token,unsubscribed:false});
  const response=await fetch('http://'+process.env.FIRESTORE_EMULATOR_HOST+'/v1/projects/demo-public-subscriptions/databases/(default)/documents:commit',{
   method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({writes:[{
    update:{name:'projects/demo-public-subscriptions/databases/(default)/documents/'+restPath,fields:{confirmationToken:{stringValue:token},unsubscribed:{booleanValue:true}}},
    updateMask:{fieldPaths:['confirmationToken','unsubscribed']},updateTransforms:[{fieldPath:'unsubscribedAt',setToServerValue:'REQUEST_TIME'}],currentDocument:{exists:true}
   }]})
  });
  if(!response.ok)throw Error('Static-page REST unsubscribe failed: '+response.status);
  const saved=await assertSucceeds(getDoc(doc(worker,restPath)));
  if(!saved.data().unsubscribed)throw Error('REST opt-out not saved');

  const week='publicEventWeeks/2026-11-16',snapshot={weekStart:'2026-11-16',bookingIds:['event'],createdAt:serverTimestamp()};
  await assertSucceeds(setDoc(doc(worker,week),snapshot));await assertFails(setDoc(doc(worker,week),{...snapshot,bookingIds:['changed']}));
  await assertFails(getDoc(doc(anon,week)));await assertFails(setDoc(doc(teacher,'publicEventWeeks/forged'),snapshot));
  const receipt='publicEventDeliveries/weekly',data={weekStart:'2026-11-16',bookingIds:['event'],recipient:'private@example.test',status:'sending',attempts:1};
  await assertSucceeds(setDoc(doc(worker,receipt),data));
  await assertFails(setDoc(doc(worker,'publicEventDeliveries/outsider'),{...data,recipient:'other@example.test'}));
  await assertFails(setDoc(doc(worker,'publicEventDeliveries/legacy'),{bookingId:'event',recipient:'private@example.test'}));
  await assertFails(updateDoc(doc(worker,receipt),{recipient:'other@example.test'}));
  await assertSucceeds(updateDoc(doc(worker,receipt),{status:'failed',bookingIds:[]}));
  await assertSucceeds(updateDoc(doc(manager,receipt),{status:'pending',attempts:0,retryRequestedBy:'manager',retryRequestedAt:serverTimestamp()}));
 }finally{await env.cleanup();}
});
