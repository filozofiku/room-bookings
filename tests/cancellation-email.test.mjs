import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cancellationEmail,deliverCancellation} from '../mailer/cancellation-email.js';
const booking={title:'Paneli',date:'2026-10-26',roomId:'r1',periodIds:['p01','p02'],ownerUid:'owner'};
const periods=[{id:'p01',start:'13:00',end:'13:15'},{id:'p02',start:'13:15',end:'13:30'}];
const reason='Salla nevojitet për provim.\nJu lutemi zgjidhni një orë tjetër.';
function fixture(send=async()=>{}) {
 let data={booking,reason,cancelledBy:'manager',status:'pending'},clock=1000;
 const ref={id:'booking-1'};
 let chain=Promise.resolve();
 const db={
  runTransaction:callback=>{
   const run=chain.then(()=>callback({get:async()=>({exists:true,data:()=>data}),update:(ref,patch)=>{data={...data,...patch}}}));
   chain=run.catch(()=>{});return run;
  },
  collection:()=>({get:async()=>({docs:periods.map(p=>({id:p.id,data:()=>p}))})}),
  doc:()=>({get:async()=>({data:()=>({name:'Salla 014'})})})
 };
 const deps={db,auth:{getUser:async uid=>{assert.equal(uid,'owner');return {email:'owner@example.test'}}},send,now:()=>clock,timestamp:value=>({toMillis:()=>value}),token:'token1'};
 return {run:()=>deliverCancellation(ref,deps),data:()=>data,set:patch=>{data={...data,...patch}},advance:()=>{clock+=300001},deps};
}
test('Albanian notification identifies the cancelled event, time, room and exact reason',()=>{
 const mail=cancellationEmail(booking,reason,periods,'Salla 014');
 assert.equal(mail.subject,'Njoftim për anulimin e rezervimit');
 for(const text of ['rezervimi juaj është anuluar','Paneli','2026-10-26','13:00–13:30','Salla 014',reason])assert.ok(mail.text.includes(text));
 assert.match(cancellationEmail({...booking,roomId:''},reason,periods,'').text,/Pa sallë/);
});
test('recipient is resolved from the owner UID, successful duplicates are suppressed',async()=>{
 const sent=[];const f=fixture(async mail=>sent.push(mail));
 await f.run();await f.run();
 assert.equal(sent.length,1);assert.equal(sent[0].to,'owner@example.test');assert.equal(f.data().status,'sent');
 assert.match(sent[0].messageId,/^<cancellation-[a-f0-9]{64}@filozofiku.github.io>$/);
});
test('concurrent events cannot send twice',async()=>{
 let release;const sent=[];const gate=new Promise(r=>release=r);
 const f=fixture(async mail=>{sent.push(mail);await gate});
 const first=f.run();
 while(!sent.length) await new Promise(r=>setTimeout(r,1));
 await assert.rejects(f.run(),/delivery-in-progress/);
 release();await first;assert.equal(sent.length,1);
});
test('transient failures retry, permanent failures remain visible, stale leases recover',async()=>{
 let attempt=0;const f=fixture(async()=>{if(++attempt===1)throw Object.assign(Error('Unavailable'),{code:'ECONNECTION'})});
 await assert.rejects(f.run(),/cancellation-email-retry/);assert.equal(f.data().status,'retrying');
 await f.run();assert.equal(f.data().status,'sent');
 const missing=fixture();missing.deps.auth.getUser=async()=>{throw Object.assign(Error(),{code:'auth/user-not-found'})};
 await missing.run();assert.equal(missing.data().status,'failed');
 const stale=fixture();stale.set({status:'sending',leaseUntil:{toMillis:()=>1001}});stale.advance();await stale.run();assert.equal(stale.data().status,'sent');
 const repeated=fixture(async()=>{throw Error('Unavailable')});
 for(let i=0;i<4;i++)await assert.rejects(repeated.run());
 await repeated.run();assert.equal(repeated.data().status,'failed');assert.equal(repeated.data().attempts,5);
});
