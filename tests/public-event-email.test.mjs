import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventStart,notificationDue,publicEventEmail,deliverPublicEvent,deliveryId} from '../mailer/public-event-email.js';
const periods=[{id:'p1',start:'13:00',end:'13:15'}];
const booking={isPublic:true,date:'2026-10-26',periodIds:['p1'],title:'Panel',eventType:'Panel',roomId:'',mode:'online',onlineUrl:'https://example.test/event',description:'Përshkrimi',creatorName:'Organizatori',groupIds:[],teacherIds:[]};
test('notification timing uses Tirane timezone and an elapsed 24 hours across DST',()=>{
 assert.equal(new Date(eventStart('2026-10-26','13:00')).toISOString(),'2026-10-26T12:00:00.000Z');
 assert.equal(new Date(eventStart('2026-07-26','13:00')).toISOString(),'2026-07-26T11:00:00.000Z');
 const start=eventStart(booking.date,'13:00');
 assert.equal(notificationDue(booking,periods,start-86400001),false);
 assert.equal(notificationDue(booking,periods,start-86400000),true);
 assert.equal(notificationDue(booking,periods,start-1),true);
 assert.equal(notificationDue(booking,periods,start),false);
 assert.equal(notificationDue({...booking,isPublic:false},periods,start-1),false);
 const transition={...booking,date:'2026-10-25'};
 assert.equal(notificationDue(transition,periods,Date.parse('2026-10-24T11:59:59Z')),false);
 assert.equal(notificationDue(transition,periods,Date.parse('2026-10-24T12:00:00Z')),true);
});
test('Albanian email includes online link, description, resources and do-not-reply text',()=>{
 const email=publicEventEmail(booking,periods,[],{});
 for(const value of ['Panel','2026-10-26','13:00–13:15','Pa sallë','https://example.test/event','Përshkrimi','Organizatori','mos iu përgjigjni'])assert.ok(email.text.includes(value));
 assert.equal(email.subject,'Njoftim për aktivitet publik');
});
function fixture(){
 const store=new Map([['publicBookings/event',booking]]);let chain=Promise.resolve();
 const sent=[];let fail=false,removeOnClaim=false;
 const db={doc:path=>({path,get:async()=>({exists:store.has(path),data:()=>store.get(path)})}),runTransaction:cb=>{
  const task=chain.then(()=>cb({get:ref=>ref.get(),update:(ref,patch)=>{store.set(ref.path,{...store.get(ref.path),...patch});if(removeOnClaim)store.delete('publicBookings/event');}}));chain=task.catch(()=>{});return task;
 }};
 const deps={db,periods,rooms:[],catalog:{},token:'token',now:()=>eventStart(booking.date,'13:00')-3600000,send:async mail=>{if(fail)throw Error('smtp failure');sent.push(mail);}};
 return {store,sent,deps,setFail:v=>fail=v,setCancel:()=>removeOnClaim=true};
}
test('per-recipient receipts prevent duplicates and retry only unsuccessful recipients',async()=>{
 const f=fixture();
 await deliverPublicEvent('event','a@example.test',f.deps);
 f.setFail(true);await assert.rejects(deliverPublicEvent('event','b@example.test',f.deps));
 f.setFail(false);await deliverPublicEvent('event','a@example.test',f.deps);await deliverPublicEvent('event','b@example.test',f.deps);
 assert.deepEqual(f.sent.map(m=>m.to),['a@example.test','b@example.test']);
 assert.notEqual(deliveryId('event','a@example.test'),deliveryId('event','b@example.test'));
});
test('cancellation before or after claiming prevents sending',async()=>{
 const f=fixture();f.store.delete('publicBookings/event');await deliverPublicEvent('event','a@example.test',f.deps);assert.equal(f.sent.length,0);
 const g=fixture();g.setCancel();await deliverPublicEvent('event','a@example.test',g.deps);assert.equal(g.sent.length,0);
});
test('parallel attempts send only once',async()=>{
 const f=fixture();await Promise.all([deliverPublicEvent('event','a@example.test',f.deps),deliverPublicEvent('event','a@example.test',{...f.deps,token:'second'})]);assert.equal(f.sent.length,1);
});
