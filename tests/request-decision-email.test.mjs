import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestDecisionEmail} from '../mailer/request-decision-email.js';
import {deliverCancellation} from '../mailer/cancellation-email.js';
const periods=[{id:'p01',start:'13:00',end:'13:15'},{id:'p02',start:'13:15',end:'13:30'}];
const booking={title:'Paneli',date:'2026-10-30',roomId:'special',periodIds:['p01','p02'],ownerUid:'owner'};
const reason='Arsyeja e vendimit.\nSqarim shtesë.';
for(const outcome of ['approved','rejected']){
 test(`${outcome} email includes the event, reviewer and exact reason in Albanian`,()=>{
  const content=requestDecisionEmail({booking,outcome,reason,deciderName:'Jon Konjufca'},periods,'Salla 127');
  assert.match(content.subject,outcome==='approved'?/miratuar/:/refuzuar/);
  for(const value of [booking.title,booking.date,'13:00–13:30','Salla 127','Jon Konjufca',reason,'mos iu përgjigjni'])assert.ok(content.text.includes(value),value);
  assert.match(content.text,outcome==='approved'?/Miratuar nga: Jon Konjufca/:/Refuzuar nga: Jon Konjufca/);
 });
 test(`${outcome} delivery resolves requester email, retries safely and suppresses sent duplicates`,async()=>{
  let data={booking,outcome,reason,deciderName:'Jon Konjufca',status:'pending'},attempts=0;
  const sent=[],ref={id:'request-1'};
  const deps={
   db:{runTransaction:async cb=>cb({get:async()=>({exists:true,data:()=>data}),update:(_,patch)=>{data={...data,...patch}}}),
    collection:()=>({get:async()=>({docs:periods.map(p=>({id:p.id,data:()=>p}))})}),
    doc:()=>({get:async()=>({data:()=>({name:'Salla 127'})})})},
   auth:{getUser:async uid=>{assert.equal(uid,'owner');return {email:'requester@example.test'}}},
   send:async mail=>{if(++attempts===1)throw Error('temporary-smtp-failure');sent.push(mail)},now:()=>1000,timestamp:ms=>({toMillis:()=>ms}),token:'lease'
  };
  await assert.rejects(deliverCancellation(ref,deps));assert.equal(data.status,'retrying');
  await deliverCancellation(ref,deps);await deliverCancellation(ref,deps);
  assert.equal(data.status,'sent');assert.equal(sent.length,1);assert.equal(sent[0].to,'requester@example.test');
  assert.match(sent[0].messageId,/^<request-decision-[a-f0-9]{64}@filozofiku.github.io>$/);
  assert.match(sent[0].text,outcome==='approved'?/Miratuar nga: Jon Konjufca/:/Refuzuar nga: Jon Konjufca/);
 });
}
test('invalid outcomes do not generate a misleading email',()=>{
 assert.throws(()=>requestDecisionEmail({booking,outcome:'unknown'},periods,'Salla 127'),/invalid-request-decision/);
});
