import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {test} from 'node:test';
const require=createRequire(`${process.env.TEST_MODULES_DIR}/package.json`);
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,writeBatch,serverTimestamp,getDoc}=require('firebase/firestore');
test('student recipients: atomic creation, domain/count validation and privacy',async()=>{
 const env=await initializeTestEnvironment({projectId:'demo-fet-students',firestore:{rules:readFileSync('firestore.rules','utf8')}});
 const db=env.authenticatedContext('owner',{name:'Owner'}).firestore();
 const seed=(path,data)=>env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),path),data));
 try{
 await seed('users/owner',{active:true,role:'teacher'});
 await seed('settings/control',{bookingOpen:true,slotStorage:'resources-v2',startDate:'2026-09-01',endDate:'2026-12-31',periodOrder:{p1:0},validPeriodRanges:['p1']});
 await seed('calendarDays/2026-11-05',{bookingAllowed:true,fetActive:false});
 await seed('resourceCatalog/current',{rooms:{},groups:{},teachers:{}});
 const booking={title:'Panel',date:'2026-11-05',roomId:'',periodIds:['p1'],groupIds:[],teacherIds:[],eventType:'Panel',isPublic:false,mode:'physical',onlineUrl:'',description:'',creatorName:'Owner',createdAt:serverTimestamp(),ownerUid:'owner'};
 const create=(id,recipients,extra={})=>{
 const batch=writeBatch(db),{ownerUid,...published}=booking;
 batch.set(doc(db,'reservations',id),booking);batch.set(doc(db,'publicBookings',id),published);
 batch.set(doc(db,'studentNotifications',id),{booking,kind:'students',recipients,status:'pending',createdAt:serverTimestamp(),...extra});return batch.commit();
 };
 await assertSucceeds(create('valid',['ana@student.uni-pr.edu']));
 await assertSucceeds(create('hundred',Array.from({length:100},(_,i)=>`s${i}@student.uni-pr.edu`)));
 for(const [id,recipients] of [['domain',['a@uni-pr.edu']],['suffix',['a@student.uni-pr.edu.evil']],['bad',['a..b@student.uni-pr.edu']],['empty',[]],['many',Array.from({length:101},(_,i)=>`s${i}@student.uni-pr.edu`)],['duplicate',['a@student.uni-pr.edu','a@student.uni-pr.edu']]])await assertFails(create(id,recipients));
 await assertFails(create('fake',['a@student.uni-pr.edu'],{booking:{...booking,title:'Forged'}}));
 await assertFails(setDoc(doc(db,'studentNotifications','orphan'),{booking,kind:'students',recipients:['a@student.uni-pr.edu'],status:'pending',createdAt:serverTimestamp()}));

 await seed('users/manager',{active:true,role:'admin',canCancelAll:true});
 await seed('resourceCatalog/current',{rooms:{r_9c3ca97a27ce:'Special'},groups:{},teachers:{}});
 const requestBooking={...booking,roomId:'r_9c3ca97a27ce'};
 const request=writeBatch(db);
 request.set(doc(db,'reservationRequests','approval'),requestBooking);
 request.set(doc(db,'requestNotifications','approval'),{booking:requestBooking,kind:'request-submitted',status:'pending',createdAt:serverTimestamp()});
 request.set(doc(db,'studentNotifications','approval'),{booking:requestBooking,kind:'students',recipients:['ana@student.uni-pr.edu'],status:'awaiting-approval',createdAt:serverTimestamp()});
 await assertSucceeds(request.commit());
 await assertFails(setDoc(doc(db,'studentNotifications','approval'),{status:'pending'},{merge:true}));
 const manager=env.authenticatedContext('manager',{name:'Manager'}).firestore();
 const original=(await getDoc(doc(manager,'reservationRequests','approval'))).data();
 const approval=writeBatch(manager),confirmed={...original,createdAt:serverTimestamp()},{ownerUid,...published}=confirmed;
 approval.set(doc(manager,'reservations','approval'),confirmed);
 approval.set(doc(manager,'publicBookings','approval'),published);
 approval.set(doc(manager,'eventDays',booking.date),{bookings:{r_9c3ca97a27ce__p1:'approval'},changedReservationId:'approval'});
 approval.set(doc(manager,'requestDecisions','approval'),{booking:original,outcome:'approved',reason:'Approved',status:'pending',decidedBy:'manager',deciderName:'Manager',createdAt:serverTimestamp()});
 approval.delete(doc(manager,'reservationRequests','approval'));
 approval.update(doc(manager,'studentNotifications','approval'),{status:'pending'});
 await assertSucceeds(approval.commit());
 await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(),'studentNotifications','valid')));
 await assertSucceeds(getDoc(doc(db,'studentNotifications','valid')));
 }finally{await env.cleanup();}
});
